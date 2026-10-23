import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { diaLocal } from '../agenda/agenda.reglas';
import { CorreoConector } from '../campanias/correo.conector';
import { CrmService } from '../crm.service';
import {
  calcularTotales,
  estadoVisible,
  numeroDeProforma,
  problemasParaEnviar,
  sePuedeEditar,
  sePuedeEnviar,
  sePuedeResponder,
  type EstadoProforma,
  type LineaDeProforma,
} from './proformas.reglas';

export interface LineaEntrante extends Partial<LineaDeProforma> {
  producto?: string | null;
}

@Injectable()
export class ProformasService {
  private readonly logger = new Logger(ProformasService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly correo: CorreoConector,
    private readonly crm: CrmService,
  ) {}

  // ------------------------------------------------------- lista de precios

  precios() {
    return this.dataSource.query(
      `SELECT p.codigo, p.nombre, pr.precio::float8 AS precio, pr.iva::float8 AS iva,
              pr.nota, pr.actualizado_por, pr.actualizado_en
         FROM producto p
         LEFT JOIN crm.precio pr ON pr.producto = p.codigo
        WHERE p.activo
        ORDER BY p.nombre`,
    );
  }

  async ponerPrecio(
    datos: { producto: string; precio: number; iva?: number; nota?: string },
    usuario: string,
  ) {
    if (!(datos.precio >= 0)) throw new BadRequestException('El precio no puede ser negativo.');
    const filas = await this.dataSource.query(
      `INSERT INTO crm.precio (producto, precio, iva, nota, actualizado_por)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (producto) DO UPDATE SET
         precio = EXCLUDED.precio, iva = EXCLUDED.iva, nota = EXCLUDED.nota,
         actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
       RETURNING *`,
      [datos.producto, datos.precio, datos.iva ?? 15, datos.nota ?? null, usuario],
    );
    return filas[0];
  }

  // ---------------------------------------------------------------- lectura

  async deOportunidad(oportunidad: number) {
    const filas = await this.dataSource.query(
      `SELECT * FROM crm.proforma WHERE oportunidad = $1 ORDER BY creada_en DESC`,
      [oportunidad],
    );
    const hoy = diaLocal();
    return Promise.all(
      filas.map(async (p: any) => ({
        ...this.conEstadoVisible(p, hoy),
        lineas: await this.lineas(Number(p.id)),
      })),
    );
  }

  async obtener(id: number) {
    const filas = await this.dataSource.query(
      `SELECT p.*, o.name AS oportunidad_nombre, o.marca, emp.name AS empresa
         FROM crm.proforma p
         JOIN crm.oportunidad o ON o.id = p.oportunidad
         JOIN crm.empresa emp ON emp.id = o.company_id
        WHERE p.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe la proforma ${id}`);
    return {
      ...this.conEstadoVisible(filas[0], diaLocal()),
      lineas: await this.lineas(id),
    };
  }

  /** Lo que ve el cliente al abrir su enlace. Sin el token no hay nada. */
  async porToken(token: string) {
    const filas = await this.dataSource.query(
      `SELECT p.*, m.nombre AS marca_nombre
         FROM crm.proforma p
         JOIN crm.oportunidad o ON o.id = p.oportunidad
         LEFT JOIN crm.marca m ON m.codigo = o.marca
        WHERE p.token = $1`,
      [token],
    );
    if (!filas[0]) throw new NotFoundException('Ese enlace no corresponde a ninguna proforma.');

    // La primera vez que se abre queda registrado. Saber si la miró es la
    // diferencia entre «no contesta» y «no le llegó».
    if (!filas[0].vista_en && filas[0].estado === 'enviada') {
      await this.dataSource.query(
        `UPDATE crm.proforma SET vista_en = now() WHERE id = $1 AND vista_en IS NULL`,
        [filas[0].id],
      );
    }

    return {
      ...this.conEstadoVisible(filas[0], diaLocal()),
      lineas: await this.lineas(Number(filas[0].id)),
    };
  }

  private lineas(proforma: number) {
    return this.dataSource.query(
      `SELECT id, orden, producto, descripcion,
              cantidad::float8 AS cantidad,
              precio_unitario::float8 AS precio_unitario,
              descuento_pct::float8 AS descuento_pct,
              iva_pct::float8 AS iva_pct
         FROM crm.proforma_linea WHERE proforma = $1 ORDER BY orden`,
      [proforma],
    );
  }

  /**
   * El estado que lee una persona, que no es sólo la columna: una enviada
   * cuya fecha pasó se lee «vencida» aunque la tabla siga diciendo «enviada».
   */
  private conEstadoVisible(p: any, hoy: string) {
    return {
      ...p,
      subtotal: Number(p.subtotal),
      descuento: Number(p.descuento),
      iva: Number(p.iva),
      total: Number(p.total),
      valida_hasta: typeof p.valida_hasta === 'string'
        ? p.valida_hasta
        : new Date(p.valida_hasta).toISOString().slice(0, 10),
      estado_visible: estadoVisible(
        p.estado,
        typeof p.valida_hasta === 'string'
          ? p.valida_hasta
          : new Date(p.valida_hasta).toISOString().slice(0, 10),
        hoy,
      ),
    };
  }

  // --------------------------------------------------------------- escritura

  /**
   * Crea la proforma de una oportunidad, con el producto que se está
   * vendiendo ya puesto como primera línea.
   *
   * Los datos del cliente se copian aquí y no se leen después: la ficha de la
   * empresa puede cambiar, y el documento que recibió el cliente decía lo que
   * decía.
   */
  async crear(oportunidad: number, usuario: string, diasDeValidez = 15) {
    const op = (
      await this.dataSource.query(
        `SELECT o.id, o.producto, o.monto::float8 AS monto, o.name,
                emp.name AS razon_social, emp.tax_identifier AS ruc, emp.address AS direccion
           FROM crm.oportunidad o
           JOIN crm.empresa emp ON emp.id = o.company_id
          WHERE o.id = $1`,
        [oportunidad],
      )
    )[0];
    if (!op) throw new NotFoundException(`No existe la oportunidad ${oportunidad}`);

    const contacto = (
      await this.dataSource.query(
        `SELECT c.first_name, c.last_name, c.email_jsonb
           FROM crm.contacto c
           JOIN crm.oportunidad o ON o.company_id = c.company_id
          WHERE o.id = $1
          ORDER BY c.principal DESC NULLS LAST, c.id
          LIMIT 1`,
        [oportunidad],
      )
    )[0];

    const precio = (
      await this.dataSource.query(
        `SELECT precio::float8 AS precio, iva::float8 AS iva FROM crm.precio WHERE producto = $1`,
        [op.producto],
      )
    )[0];

    const numero = await this.siguienteNumero();
    const valida = new Date();
    valida.setDate(valida.getDate() + diasDeValidez);

    const creada = (
      await this.dataSource.query(
        `INSERT INTO crm.proforma
           (numero, oportunidad, valida_hasta, razon_social, ruc, direccion,
            contacto, correo, creada_por)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          numero,
          oportunidad,
          diaLocal(valida),
          op.razon_social,
          op.ruc,
          op.direccion,
          contacto ? [contacto.first_name, contacto.last_name].filter(Boolean).join(' ') : null,
          primerCorreo(contacto?.email_jsonb),
          usuario,
        ],
      )
    )[0];

    // La primera línea es lo que ya se estaba vendiendo. El importe de la
    // oportunidad manda sobre la lista de precios: si alguien acordó otro
    // número con el cliente, es ese el que hay que cotizar.
    await this.dataSource.query(
      `INSERT INTO crm.proforma_linea
         (proforma, orden, producto, descripcion, cantidad, precio_unitario, iva_pct)
       SELECT $1, 1, $2, pr.nombre, 1, $3, $4 FROM producto pr WHERE pr.codigo = $2`,
      [creada.id, op.producto, op.monto ?? precio?.precio ?? 0, precio?.iva ?? 15],
    );

    await this.recalcular(Number(creada.id));
    return this.obtener(Number(creada.id));
  }

  /**
   * El correlativo del año.
   *
   * Se saca del máximo guardado y no de un contador aparte: con dos contadores
   * —uno en una tabla y otro implícito en los números ya puestos— basta una
   * restauración de copia de seguridad para que empiecen a repetirse.
   */
  private async siguienteNumero(): Promise<string> {
    const anio = new Date().getFullYear();
    const filas = await this.dataSource.query(
      `SELECT coalesce(max(substring(numero from '\\d+$')::int), 0) + 1 AS siguiente
         FROM crm.proforma WHERE numero LIKE $1`,
      [`P-${anio}-%`],
    );
    return numeroDeProforma(anio, Number(filas[0].siguiente));
  }

  async editar(id: number, datos: Record<string, any>) {
    const actual = await this.obtener(id);
    if (!sePuedeEditar(actual.estado as EstadoProforma)) {
      throw new ConflictException(
        'Una proforma enviada no se edita: el cliente tiene ese documento. Haz otra.',
      );
    }

    const campos = ['razon_social', 'ruc', 'direccion', 'contacto', 'correo', 'notas', 'condiciones'];
    const sets: string[] = [];
    const params: any[] = [id];
    for (const campo of campos) {
      if (datos[campo] !== undefined) {
        params.push(datos[campo] || null);
        sets.push(`${campo} = $${params.length}`);
      }
    }
    if (datos.valida_hasta) {
      params.push(datos.valida_hasta);
      sets.push(`valida_hasta = $${params.length}::date`);
    }
    if (sets.length) {
      await this.dataSource.query(
        `UPDATE crm.proforma SET ${sets.join(', ')} WHERE id = $1`,
        params,
      );
    }

    if (Array.isArray(datos.lineas)) await this.reemplazarLineas(id, datos.lineas);
    await this.recalcular(id);
    return this.obtener(id);
  }

  /**
   * Las líneas se reemplazan enteras, no se parchean una a una.
   *
   * Es un borrador que se edita en una tabla de la pantalla: mandar altas,
   * bajas y cambios por separado obliga a las dos partes a llevar la cuenta de
   * qué fila es cuál, y basta un fallo de red en medio para dejar media
   * proforma guardada.
   */
  private async reemplazarLineas(proforma: number, lineas: LineaEntrante[]) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM crm.proforma_linea WHERE proforma = $1`, [proforma]);
      let orden = 0;
      for (const linea of lineas) {
        if (!linea?.descripcion?.trim()) continue;
        orden += 1;
        await manager.query(
          `INSERT INTO crm.proforma_linea
             (proforma, orden, producto, descripcion, cantidad, precio_unitario,
              descuento_pct, iva_pct)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            proforma,
            orden,
            linea.producto || null,
            linea.descripcion.trim(),
            Number(linea.cantidad ?? 1),
            Number(linea.precio_unitario ?? 0),
            Number(linea.descuento_pct ?? 0),
            Number(linea.iva_pct ?? 15),
          ],
        );
      }
    });
  }

  /** Vuelve a cuadrar los totales guardados con sus líneas. */
  private async recalcular(id: number) {
    const lineas = await this.lineas(id);
    const totales = calcularTotales(lineas);
    await this.dataSource.query(
      `UPDATE crm.proforma SET subtotal = $2, descuento = $3, iva = $4, total = $5
        WHERE id = $1`,
      [id, totales.subtotal, totales.descuento, totales.iva, totales.total],
    );
    return totales;
  }

  // ----------------------------------------------------------------- enviar

  async enviar(id: number, enlaceBase: string) {
    const proforma = await this.obtener(id);
    if (!sePuedeEnviar(proforma.estado as EstadoProforma)) {
      throw new ConflictException(`Una proforma ${proforma.estado} ya no se manda.`);
    }

    const problemas = problemasParaEnviar(
      {
        correo: proforma.correo,
        lineas: proforma.lineas,
        total: proforma.total,
        valida_hasta: proforma.valida_hasta,
      },
      diaLocal(),
    );
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const enlace = `${enlaceBase}/crm/proformas/ver/${proforma.token}`;
    const resultado = await this.correo.enviar({
      para: proforma.correo!,
      asunto: `Proforma ${proforma.numero} · ${proforma.razon_social}`,
      cuerpo: this.cuerpoDelCorreo(proforma, enlace),
    });

    await this.dataSource.query(
      `UPDATE crm.proforma SET estado = 'enviada', enviada_en = coalesce(enviada_en, now())
        WHERE id = $1`,
      [id],
    );

    this.logger.log(`Proforma ${proforma.numero} enviada (${resultado.mensajeId})`);
    return { ...(await this.obtener(id)), enlace, simulado: resultado.simulado };
  }

  private cuerpoDelCorreo(proforma: any, enlace: string): string {
    return [
      `<p>Estimados ${escapar(proforma.razon_social)}:</p>`,
      `<p>Adjuntamos la proforma <strong>${escapar(proforma.numero)}</strong>,`,
      `por un total de <strong>$${proforma.total.toFixed(2)}</strong>,`,
      `válida hasta el ${escapar(proforma.valida_hasta)}.</p>`,
      `<p><a href="${enlace}">Ver la proforma y aceptarla</a></p>`,
      proforma.condiciones ? `<p>${escapar(proforma.condiciones)}</p>` : '',
    ].join('\n');
  }

  // --------------------------------------------------------------- respuesta

  /**
   * El cliente acepta desde su enlace.
   *
   * Aceptar **gana la oportunidad**, con todo lo que eso arrastra: entrega la
   * venta al contable, corta el seguimiento y marca al sujeto como cliente. Es
   * el sentido de tener aceptación en línea; si el «sí» del cliente no moviera
   * nada, habría que volver a teclearlo a mano y la mitad de las veces no se
   * haría.
   */
  async aceptar(token: string, quien: string) {
    const proforma = await this.porToken(token);
    if (!sePuedeResponder(proforma.estado as EstadoProforma)) {
      throw new ConflictException('Esta proforma ya no admite respuesta.');
    }
    if (proforma.estado_visible === 'vencida') {
      throw new ConflictException(
        'Esta proforma ya venció. Pídele a tu contacto una nueva: los precios pueden haber cambiado.',
      );
    }

    await this.dataSource.query(
      `UPDATE crm.proforma
          SET estado = 'aceptada', cerrada_en = now(), aceptada_por = $2
        WHERE id = $1`,
      [proforma.id, quien],
    );

    const ganada = await this.dataSource.query(
      `SELECT codigo FROM crm.etapa WHERE es_ganada ORDER BY orden LIMIT 1`,
    );
    if (ganada[0]) {
      try {
        await this.crm.moverEtapa(
          Number(proforma.oportunidad),
          ganada[0].codigo,
          null,
          `proforma ${proforma.numero}`,
        );
      } catch (e) {
        // La aceptación del cliente ya está guardada y es lo que no se puede
        // perder. Que la tarjeta no se moviera —porque alguien la archivó, o
        // porque la venta estaba bloqueada— se arregla a mano mirando esto.
        this.logger.error(`La proforma ${proforma.numero} se aceptó pero no movió la tarjeta`, e as Error);
      }
    }

    return this.porToken(token);
  }

  async rechazar(token: string, quien: string, motivo?: string) {
    const proforma = await this.porToken(token);
    if (!sePuedeResponder(proforma.estado as EstadoProforma)) {
      throw new ConflictException('Esta proforma ya no admite respuesta.');
    }
    await this.dataSource.query(
      `UPDATE crm.proforma
          SET estado = 'rechazada', cerrada_en = now(), aceptada_por = $2, motivo = $3
        WHERE id = $1`,
      [proforma.id, quien, motivo ?? null],
    );
    return this.porToken(token);
  }

  /** Anular una proforma propia: se equivocó quien la hizo, no el cliente. */
  async anular(id: number, motivo: string) {
    const proforma = await this.obtener(id);
    if (proforma.estado === 'aceptada') {
      throw new ConflictException('Una proforma aceptada no se anula: el cliente ya dijo que sí.');
    }
    await this.dataSource.query(
      `UPDATE crm.proforma SET estado = 'anulada', cerrada_en = now(), motivo = $2 WHERE id = $1`,
      [id, motivo],
    );
    return this.obtener(id);
  }
}

/** El primer correo de la lista que guarda el contacto, si tiene alguno. */
function primerCorreo(correos: unknown): string | null {
  if (!Array.isArray(correos)) return null;
  const primero = correos.find((c: any) => c?.email);
  return primero?.email ?? null;
}

function escapar(texto: string): string {
  return String(texto).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
