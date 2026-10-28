import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  cadenaDeSupervisores,
  calcularTotales,
  descuentoMayor,
  esMotivoDeRechazo,
  estadoVisible,
  firmaVigente,
  MOTIVOS_DE_RECHAZO,
  nivelRequerido,
  NOMBRE_DE_NIVEL,
  numeroDeProforma,
  numeroDeVersion,
  problemasParaEnviar,
  puedeAprobar,
  sePuedeEditar,
  sePuedeEnviar,
  sePuedeResponder,
  sePuedeVersionar,
  telefonoParaWhatsapp,
  type CanalDeEnvio,
  type EstadoProforma,
  type LineaDeProforma,
  type NivelDeDescuento,
} from './proformas.reglas';

export interface LineaEntrante extends Partial<LineaDeProforma> {
  producto?: string | null;
}

/** Lo que se sabe de la firma del descuento de una proforma. */
export interface Aprobacion {
  descuento_pct: number;
  nivel: NivelDeDescuento;
  /** El nivel que falta firmar, o nulo si no falta nada. */
  pendiente: NivelDeDescuento | null;
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

  // ------------------------------------------------------------- plantillas

  plantillas() {
    return this.dataSource.query(
      `SELECT * FROM crm.proforma_plantilla ORDER BY activa DESC, nombre`,
    );
  }

  async ponerPlantilla(datos: Record<string, any>, usuario: string) {
    const codigo = String(datos.codigo ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(codigo)) {
      throw new BadRequestException('El código va en minúsculas, sin espacios: «auditoria-anual».');
    }
    if (!String(datos.nombre ?? '').trim()) throw new BadRequestException('Falta el nombre.');
    const dias = Number(datos.dias_validez ?? 15);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      throw new BadRequestException('La validez va de 1 a 365 días.');
    }
    const filas = await this.dataSource.query(
      `INSERT INTO crm.proforma_plantilla
         (codigo, nombre, marca, dias_validez, notas, condiciones, condiciones_pago, activa, actualizada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (codigo) DO UPDATE SET
         nombre = EXCLUDED.nombre, marca = EXCLUDED.marca, dias_validez = EXCLUDED.dias_validez,
         notas = EXCLUDED.notas, condiciones = EXCLUDED.condiciones,
         condiciones_pago = EXCLUDED.condiciones_pago, activa = EXCLUDED.activa,
         actualizada_por = EXCLUDED.actualizada_por, actualizada_en = now()
       RETURNING *`,
      [
        codigo,
        String(datos.nombre).trim(),
        datos.marca || null,
        dias,
        datos.notas || null,
        datos.condiciones || null,
        datos.condiciones_pago || null,
        datos.activa ?? true,
        usuario,
      ],
    );
    return filas[0];
  }

  // ------------------------------------------------ política de descuentos

  topes(): Promise<{ nivel: NivelDeDescuento; hasta_pct: number }[]> {
    return this.dataSource.query(
      `SELECT nivel, hasta_pct::float8 AS hasta_pct, actualizado_por, actualizado_en
         FROM crm.descuento_nivel
        ORDER BY hasta_pct`,
    );
  }

  async ponerTope(nivel: string, hastaPct: number, usuario: string) {
    if (nivel !== 'libre' && nivel !== 'supervisor') {
      // Dirección no tiene tope: es quien decide por encima de los demás.
      throw new BadRequestException('Sólo se ajustan los topes «libre» y «supervisor».');
    }
    if (!(hastaPct >= 0 && hastaPct <= 100)) {
      throw new BadRequestException('El tope es un porcentaje entre 0 y 100.');
    }
    const actuales = await this.topes();
    const otro = actuales.find((t) => t.nivel === (nivel === 'libre' ? 'supervisor' : 'libre'));
    // Si el tope libre pasara al del supervisor, el supervisor no firmaría
    // nunca nada y nadie notaría que el circuito dejó de existir.
    if (otro && (nivel === 'libre' ? hastaPct > otro.hasta_pct : hastaPct < otro.hasta_pct)) {
      throw new BadRequestException('El tope libre no puede quedar por encima del de supervisor.');
    }
    await this.dataSource.query(
      `UPDATE crm.descuento_nivel SET hasta_pct = $2, actualizado_por = $3, actualizado_en = now()
        WHERE nivel = $1`,
      [nivel, hastaPct, usuario],
    );
    return this.topes();
  }

  // ---------------------------------------------------------------- lectura

  async deOportunidad(oportunidad: number) {
    const filas = await this.dataSource.query(
      `SELECT * FROM crm.proforma WHERE oportunidad = $1 ORDER BY creada_en DESC`,
      [oportunidad],
    );
    const hoy = diaLocal();
    const topes = await this.topes();
    return Promise.all(
      filas.map(async (p: any) => {
        const lineas = await this.lineas(Number(p.id));
        return {
          ...this.conEstadoVisible(p, hoy),
          lineas,
          aprobacion: this.aprobacionDe(p, lineas, topes),
        };
      }),
    );
  }

  async obtener(id: number) {
    const filas = await this.dataSource.query(
      `SELECT p.*, o.name AS oportunidad_nombre, o.marca, o.comercial, emp.name AS empresa
         FROM crm.proforma p
         JOIN crm.oportunidad o ON o.id = p.oportunidad
         JOIN crm.empresa emp ON emp.id = o.company_id
        WHERE p.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe la proforma ${id}`);
    const lineas = await this.lineas(id);
    return {
      ...this.conEstadoVisible(filas[0], diaLocal()),
      lineas,
      aprobacion: this.aprobacionDe(filas[0], lineas, await this.topes()),
    };
  }

  /**
   * Todas las propuestas, para seguirlas desde una sola pantalla.
   *
   * Filtra por el estado **visible** y no por la columna: «vencidas» es lo
   * que se quiere ver y en la tabla no existe. Por eso el filtro de estado se
   * aplica después de calcularlo, sobre un máximo razonable de filas.
   */
  async listado(filtros: { estado?: string; comercial?: string; marca?: string }) {
    const params: any[] = [];
    const partes = ['true'];
    if (filtros.comercial) {
      params.push(filtros.comercial);
      partes.push(`o.comercial = $${params.length}`);
    }
    if (filtros.marca) {
      params.push(filtros.marca);
      partes.push(`o.marca = $${params.length}`);
    }
    const filas = await this.dataSource.query(
      `SELECT p.id, p.numero, p.version, p.estado, p.valida_hasta, p.razon_social, p.total::float8 AS total,
              p.subtotal, p.descuento, p.iva,
              p.enviada_en, p.vista_en, p.cerrada_en, p.canal_envio, p.motivo_rechazo, p.motivo,
              p.creada_por, p.creada_en, p.aprobada_por, p.aprobacion_pedida_en,
              p.descuento_aprobado_pct, p.oportunidad,
              o.name AS oportunidad_nombre, o.comercial, o.marca,
              coalesce(max(l.descuento_pct), 0)::float8 AS descuento_mayor
         FROM crm.proforma p
         JOIN crm.oportunidad o ON o.id = p.oportunidad
         LEFT JOIN crm.proforma_linea l ON l.proforma = p.id
        WHERE ${partes.join(' AND ')}
        GROUP BY p.id, o.id
        ORDER BY p.creada_en DESC
        LIMIT 500`,
      params,
    );
    const hoy = diaLocal();
    const topes = await this.topes();
    const todas = filas.map((p: any) => ({
      ...this.conEstadoVisible(p, hoy),
      aprobacion: this.aprobacionDe(p, [{ descuento_pct: Number(p.descuento_mayor) }], topes),
    }));
    return filtros.estado ? todas.filter((p: any) => p.estado_visible === filtros.estado) : todas;
  }

  /**
   * Lo que espera firma, y si quien pregunta puede firmarlo.
   *
   * Se dice por proforma quién puede, porque la pregunta de quien abre esta
   * lista es «¿qué me toca a mí?», no «¿qué está parado?».
   */
  async pendientesDeAprobar(usuario: string) {
    const borradores = (await this.listado({ estado: 'borrador' })).filter(
      (p: any) => p.aprobacion.pendiente,
    );
    const supervisorDe = await this.supervisores();
    return borradores.map((p: any) => {
      const veredicto = puedeAprobar(
        p.aprobacion.pendiente,
        p.creada_por,
        usuario,
        cadenaDeSupervisores(p.creada_por, supervisorDe),
      );
      return { ...p, puedes_aprobar: veredicto.permitido, motivo: veredicto.motivo ?? null };
    });
  }

  eventos(id: number) {
    return this.dataSource.query(
      `SELECT id, tipo, detalle, autor, ocurrido_en
         FROM crm.proforma_evento WHERE proforma = $1 ORDER BY ocurrido_en, id`,
      [id],
    );
  }

  /** Lo que ve el cliente al abrir su enlace. Sin el token no hay nada. */
  async porToken(token: string) {
    const filas = await this.dataSource.query(
      `SELECT p.*, m.nombre AS marca_nombre,
              (SELECT n.numero FROM crm.proforma n
                WHERE n.version_de = p.id AND n.estado <> 'anulada'
                ORDER BY n.version DESC LIMIT 1) AS reemplazada_por
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
      const marcadas = await this.dataSource.query(
        `UPDATE crm.proforma SET vista_en = now() WHERE id = $1 AND vista_en IS NULL RETURNING id`,
        [filas[0].id],
      );
      if (marcadas.length) await this.anotar(Number(filas[0].id), 'vista', null, 'cliente');
    }

    return {
      ...this.conEstadoVisible(filas[0], diaLocal()),
      lineas: await this.lineas(Number(filas[0].id)),
    };
  }

  private lineas(proforma: number) {
    return this.dataSource.query(
      `SELECT id, orden, producto, descripcion, cotizacion, opcional, incluida,
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
    const validaHasta =
      typeof p.valida_hasta === 'string'
        ? p.valida_hasta
        : new Date(p.valida_hasta).toISOString().slice(0, 10);
    return {
      ...p,
      subtotal: Number(p.subtotal),
      descuento: Number(p.descuento),
      iva: Number(p.iva),
      total: Number(p.total),
      descuento_aprobado_pct:
        p.descuento_aprobado_pct === null || p.descuento_aprobado_pct === undefined
          ? null
          : Number(p.descuento_aprobado_pct),
      valida_hasta: validaHasta,
      estado_visible: estadoVisible(p.estado, validaHasta, hoy),
    };
  }

  /**
   * Qué firma necesita el descuento y si ya la tiene.
   *
   * Se calcula al leer y no se guarda: depende de las líneas de ahora y de
   * los topes de ahora, y una columna `necesita_aprobacion` quedaría
   * mintiendo en cuanto alguien cambiara cualquiera de los dos.
   */
  private aprobacionDe(
    p: { descuento_aprobado_pct?: number | string | null },
    lineas: { descuento_pct: number }[],
    topes: { nivel: NivelDeDescuento; hasta_pct: number }[],
  ): Aprobacion {
    const pct = descuentoMayor(lineas);
    const nivel = nivelRequerido(pct, topes);
    const aprobado =
      p.descuento_aprobado_pct === null || p.descuento_aprobado_pct === undefined
        ? null
        : Number(p.descuento_aprobado_pct);
    return {
      descuento_pct: pct,
      nivel,
      pendiente: nivel === 'libre' || firmaVigente(pct, aprobado) ? null : nivel,
    };
  }

  private async supervisores(): Promise<Map<string, string | null>> {
    const filas = await this.dataSource.query(`SELECT usuario, supervisor FROM crm.comercial`);
    return new Map(filas.map((f: any) => [f.usuario, f.supervisor]));
  }

  /** Deja escrito un paso de la negociación. */
  private anotar(proforma: number, tipo: string, detalle: string | null, autor: string) {
    return this.dataSource.query(
      `INSERT INTO crm.proforma_evento (proforma, tipo, detalle, autor) VALUES ($1,$2,$3,$4)`,
      [proforma, tipo, detalle, autor],
    );
  }

  // --------------------------------------------------------------- escritura

  /**
   * Crea la proforma de una oportunidad, con el producto que se está
   * vendiendo ya puesto como primera línea.
   *
   * Los datos del cliente se copian aquí y no se leen después: la ficha de la
   * empresa puede cambiar, y el documento que recibió el cliente decía lo que
   * decía. Lo mismo con la plantilla: se copia su texto, no se enlaza.
   */
  async crear(
    oportunidad: number,
    usuario: string,
    opciones: { diasDeValidez?: number; plantilla?: string } = {},
  ) {
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

    const plantilla = opciones.plantilla
      ? (
          await this.dataSource.query(
            `SELECT * FROM crm.proforma_plantilla WHERE codigo = $1 AND activa`,
            [opciones.plantilla],
          )
        )[0]
      : null;
    if (opciones.plantilla && !plantilla) {
      throw new BadRequestException(`La plantilla «${opciones.plantilla}» no existe o está inactiva.`);
    }

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
    const dias = opciones.diasDeValidez ?? plantilla?.dias_validez ?? 15;
    const valida = new Date();
    valida.setDate(valida.getDate() + Number(dias));

    const creada = (
      await this.dataSource.query(
        `INSERT INTO crm.proforma
           (numero, oportunidad, valida_hasta, razon_social, ruc, direccion,
            contacto, correo, creada_por, plantilla, notas, condiciones, condiciones_pago)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
          plantilla?.codigo ?? null,
          plantilla?.notas ?? null,
          plantilla?.condiciones ?? null,
          plantilla?.condiciones_pago ?? null,
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
    await this.anotar(
      Number(creada.id),
      'creada',
      plantilla ? `con la plantilla «${plantilla.nombre}»` : null,
      usuario,
    );
    return this.obtener(Number(creada.id));
  }

  /**
   * El correlativo del año.
   *
   * Se saca del máximo guardado y no de un contador aparte: con dos contadores
   * —uno en una tabla y otro implícito en los números ya puestos— basta una
   * restauración de copia de seguridad para que empiecen a repetirse.
   *
   * El grupo captura el correlativo de en medio y no los últimos dígitos: en
   * `P-2026-0007-v2` los últimos son el 2 de la versión.
   */
  private async siguienteNumero(): Promise<string> {
    const anio = new Date().getFullYear();
    const filas = await this.dataSource.query(
      `SELECT coalesce(max(substring(numero from '^P-\\d{4}-(\\d+)')::int), 0) + 1 AS siguiente
         FROM crm.proforma WHERE numero LIKE $1`,
      [`P-${anio}-%`],
    );
    return numeroDeProforma(anio, Number(filas[0].siguiente));
  }

  async editar(id: number, datos: Record<string, any>, usuario: string) {
    const actual = await this.obtener(id);
    if (!sePuedeEditar(actual.estado as EstadoProforma)) {
      throw new ConflictException(
        'Una proforma enviada no se edita: el cliente tiene ese documento. Haz una versión nueva.',
      );
    }

    const campos = [
      'razon_social',
      'ruc',
      'direccion',
      'contacto',
      'correo',
      'notas',
      'condiciones',
      'condiciones_pago',
    ];
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
    const totales = await this.recalcular(id);

    // Se anota sólo cuando cambia lo que importa en una negociación —el
    // total o el descuento—, no cada vez que alguien guarda: un historial
    // con cuarenta «editada» seguidas no lo lee nadie.
    const descuentoAntes = actual.aprobacion.descuento_pct;
    const descuentoAhora = descuentoMayor(await this.lineas(id));
    if (totales.total !== actual.total || descuentoAhora !== descuentoAntes) {
      await this.anotar(
        id,
        'editada',
        `total ${dinero(actual.total)} → ${dinero(totales.total)}` +
          (descuentoAhora !== descuentoAntes
            ? `; descuento mayor ${descuentoAntes}% → ${descuentoAhora}%`
            : ''),
        usuario,
      );
    }
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
              descuento_pct, iva_pct, cotizacion, opcional)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            proforma,
            orden,
            linea.producto || null,
            linea.descripcion.trim(),
            Number(linea.cantidad ?? 1),
            Number(linea.precio_unitario ?? 0),
            Number(linea.descuento_pct ?? 0),
            Number(linea.iva_pct ?? 15),
            // De qué cotización salió la línea, cuando salió de una: es lo
            // que permite contestar «¿por qué paga esto?» abriendo el
            // documento, sin rehacer la cuenta de memoria.
            (linea as any).cotizacion ? Number((linea as any).cotizacion) : null,
            Boolean(linea.opcional),
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

  // ---------------------------------------------------------------- versiones

  /**
   * Una versión nueva de lo que el cliente ya tiene.
   *
   * Nace como borrador con las mismas líneas, para cambiar lo que se esté
   * negociando. La anterior **sigue valiendo hasta que se manda la nueva**:
   * si la versión se queda a medias, el cliente no debe encontrarse con un
   * enlace muerto.
   *
   * La firma del descuento se copia: se aprobó un porcentaje para esta
   * negociación, y subirlo en la versión nueva la invalida sola.
   */
  async nuevaVersion(id: number, usuario: string) {
    const origen = await this.obtener(id);
    if (!sePuedeVersionar(origen.estado as EstadoProforma)) {
      throw new ConflictException(
        origen.estado === 'borrador'
          ? 'Un borrador se edita, no se versiona.'
          : `Una proforma ${origen.estado} no se versiona.`,
      );
    }

    const borrador = await this.dataSource.query(
      `SELECT numero FROM crm.proforma WHERE oportunidad = $1 AND estado = 'borrador'`,
      [origen.oportunidad],
    );
    if (borrador.length) {
      throw new ConflictException(
        `Ya hay un borrador abierto en esta venta (${borrador[0].numero}): termina ese.`,
      );
    }

    const base = numeroDeVersion(origen.numero, 1);
    const ultima = (
      await this.dataSource.query(
        `SELECT max(version)::int AS version FROM crm.proforma
          WHERE numero = $1 OR numero LIKE $1 || '-v%'`,
        [base],
      )
    )[0];
    const version = Number(ultima?.version ?? origen.version ?? 1) + 1;

    // Una versión nueva de una vencida tiene que salir con fecha viva, o
    // nacería imposible de enviar.
    const hoy = diaLocal();
    let valida = origen.valida_hasta;
    if (valida < hoy) {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      valida = diaLocal(d);
    }

    const nueva = await this.dataSource.transaction(async (manager) => {
      const fila = (
        await manager.query(
          `INSERT INTO crm.proforma
             (numero, oportunidad, valida_hasta, razon_social, ruc, direccion, contacto, correo,
              notas, condiciones, condiciones_pago, plantilla, creada_por, version, version_de,
              descuento_aprobado_pct, aprobada_por, aprobada_en)
           SELECT $2, oportunidad, $3::date, razon_social, ruc, direccion, contacto, correo,
                  notas, condiciones, condiciones_pago, plantilla, $4, $5, id,
                  descuento_aprobado_pct, aprobada_por, aprobada_en
             FROM crm.proforma WHERE id = $1
           RETURNING id`,
          [id, numeroDeVersion(base, version), valida, usuario, version],
        )
      )[0];
      await manager.query(
        `INSERT INTO crm.proforma_linea
           (proforma, orden, producto, descripcion, cantidad, precio_unitario,
            descuento_pct, iva_pct, cotizacion, opcional)
         SELECT $2, orden, producto, descripcion, cantidad, precio_unitario,
                descuento_pct, iva_pct, cotizacion, opcional
           FROM crm.proforma_linea WHERE proforma = $1`,
        [id, fila.id],
      );
      return Number(fila.id);
    });

    await this.recalcular(nueva);
    await this.anotar(nueva, 'version', `versión ${version}, a partir de ${origen.numero}`, usuario);
    return this.obtener(nueva);
  }

  // ------------------------------------------------------------- aprobación

  async pedirAprobacion(id: number, usuario: string) {
    const proforma = await this.obtener(id);
    if (!proforma.aprobacion.pendiente) {
      throw new BadRequestException('Este descuento no necesita firma.');
    }
    await this.dataSource.query(
      `UPDATE crm.proforma SET aprobacion_pedida_en = now() WHERE id = $1`,
      [id],
    );
    await this.anotar(
      id,
      'aprobacion_pedida',
      `${proforma.aprobacion.descuento_pct}% · lo firma ${NOMBRE_DE_NIVEL[proforma.aprobacion.pendiente]}`,
      usuario,
    );
    return this.obtener(id);
  }

  /**
   * Firma el descuento de ahora.
   *
   * Se firma el porcentaje y no la proforma: lo que se guarda es hasta dónde
   * llega la firma, y si alguien sube el descuento después, vuelve a pedirla.
   */
  async aprobar(id: number, usuario: string) {
    const proforma = await this.obtener(id);
    if (!sePuedeEditar(proforma.estado as EstadoProforma)) {
      throw new ConflictException('Sólo se firma el descuento de un borrador.');
    }
    const nivel = proforma.aprobacion.pendiente;
    if (!nivel) throw new BadRequestException('Este descuento no necesita firma.');

    const cadena = cadenaDeSupervisores(proforma.creada_por, await this.supervisores());
    const veredicto = puedeAprobar(nivel, proforma.creada_por, usuario, cadena);
    if (!veredicto.permitido) throw new ForbiddenException(veredicto.motivo);

    await this.dataSource.query(
      `UPDATE crm.proforma
          SET descuento_aprobado_pct = $2, aprobada_por = $3, aprobada_en = now()
        WHERE id = $1`,
      [id, proforma.aprobacion.descuento_pct, usuario],
    );
    await this.anotar(id, 'aprobada', `descuento de hasta ${proforma.aprobacion.descuento_pct}%`, usuario);
    return this.obtener(id);
  }

  // ----------------------------------------------------------------- enviar

  /**
   * Manda la proforma por correo o deja listo el mensaje de WhatsApp.
   *
   * Por WhatsApp no sale sola: devuelve un enlace `wa.me` que abre el
   * comercial con el texto puesto. Mandarla por la API de Meta exigiría una
   * plantilla aprobada —la conversación con un cliente al que se cotiza casi
   * nunca está dentro de la ventana de 24 horas—, y una proforma por plantilla
   * genérica se lee como publicidad.
   *
   * Mandar una versión deja reemplazadas las anteriores que seguían vivas: el
   * cliente no puede aceptar el precio de la versión 1 cuando ya negoció la 2.
   */
  async enviar(id: number, enlaceBase: string, usuario: string, canal: CanalDeEnvio = 'correo') {
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
        aprobacion_pendiente: proforma.aprobacion.pendiente,
      },
      diaLocal(),
      canal,
    );

    let telefono: string | null = null;
    if (canal === 'whatsapp') {
      telefono = await this.telefonoDelCliente(Number(proforma.oportunidad));
      if (!telefono) problemas.push('El contacto no tiene un teléfono al que escribir.');
    }
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const enlace = `${enlaceBase}/crm/proformas/ver/${proforma.token}`;
    let simulado = false;
    let enlaceWhatsapp: string | null = null;

    if (canal === 'correo') {
      const resultado = await this.correo.enviar({
        para: proforma.correo!,
        asunto: `Proforma ${proforma.numero} · ${proforma.razon_social}`,
        cuerpo: this.cuerpoDelCorreo(proforma, enlace),
      });
      simulado = resultado.simulado;
      this.logger.log(`Proforma ${proforma.numero} enviada (${resultado.mensajeId})`);
    } else {
      const texto =
        `Hola, le comparto la proforma ${proforma.numero} por ${dinero(proforma.total)}, ` +
        `válida hasta el ${proforma.valida_hasta}. Puede verla y aceptarla aquí: ${enlace}`;
      enlaceWhatsapp = `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE crm.proforma
            SET estado = 'enviada', enviada_en = coalesce(enviada_en, now()), canal_envio = $2
          WHERE id = $1`,
        [id, canal],
      );
      await manager.query(
        `UPDATE crm.proforma SET estado = 'reemplazada', cerrada_en = now()
          WHERE id <> $1 AND estado = 'enviada' AND (numero = $2 OR numero LIKE $2 || '-v%')`,
        [id, numeroDeVersion(proforma.numero, 1)],
      );
    });
    await this.anotar(id, 'enviada', canal === 'correo' ? `por correo a ${proforma.correo}` : 'por WhatsApp', usuario);

    return { ...(await this.obtener(id)), enlace, enlace_whatsapp: enlaceWhatsapp, simulado };
  }

  private async telefonoDelCliente(oportunidad: number): Promise<string | null> {
    const filas = await this.dataSource.query(
      `SELECT c.phone_jsonb
         FROM crm.contacto c
         JOIN crm.oportunidad o ON o.company_id = c.company_id
        WHERE o.id = $1
        ORDER BY c.principal DESC NULLS LAST, c.id`,
      [oportunidad],
    );
    for (const fila of filas) {
      for (const tel of Array.isArray(fila.phone_jsonb) ? fila.phone_jsonb : []) {
        const numero = telefonoParaWhatsapp(tel?.number ?? tel?.numero ?? tel);
        if (numero) return numero;
      }
    }
    return null;
  }

  private cuerpoDelCorreo(proforma: any, enlace: string): string {
    return [
      `<p>Estimados ${escapar(proforma.razon_social)}:</p>`,
      `<p>Adjuntamos la proforma <strong>${escapar(proforma.numero)}</strong>,`,
      `por un total de <strong>${dinero(proforma.total)}</strong>,`,
      `válida hasta el ${escapar(proforma.valida_hasta)}.</p>`,
      `<p><a href="${enlace}">Ver la proforma y aceptarla</a></p>`,
      proforma.condiciones_pago ? `<p>Forma de pago: ${escapar(proforma.condiciones_pago)}</p>` : '',
      proforma.condiciones ? `<p>${escapar(proforma.condiciones)}</p>` : '',
    ].join('\n');
  }

  // --------------------------------------------------------------- respuesta

  /**
   * El cliente acepta desde su enlace, con las opciones que eligió.
   *
   * Aceptar **gana la oportunidad**, con todo lo que eso arrastra: entrega la
   * venta al contable, corta el seguimiento y marca al sujeto como cliente. Es
   * el sentido de tener aceptación en línea; si el «sí» del cliente no moviera
   * nada, habría que volver a teclearlo a mano y la mitad de las veces no se
   * haría.
   *
   * Las opciones se guardan **antes** de ganar: la venta toma su importe de
   * los totales de la proforma aceptada, y tienen que incluir lo que eligió.
   */
  async aceptar(token: string, quien: string, opciones: number[] = []) {
    const proforma = await this.porToken(token);
    if (!sePuedeResponder(proforma.estado as EstadoProforma)) {
      throw new ConflictException(
        proforma.estado === 'reemplazada'
          ? 'Esta proforma fue reemplazada por una versión más reciente: pídele el enlace nuevo a tu contacto.'
          : 'Esta proforma ya no admite respuesta.',
      );
    }
    if (proforma.estado_visible === 'vencida') {
      throw new ConflictException(
        'Esta proforma ya venció. Pídele a tu contacto una nueva: los precios pueden haber cambiado.',
      );
    }

    const elegidas = new Set(opciones.map(Number));
    const id = Number(proforma.id);
    await this.dataSource.query(
      `UPDATE crm.proforma_linea SET incluida = (id = ANY($2::bigint[]))
        WHERE proforma = $1 AND opcional`,
      [id, [...elegidas]],
    );
    const totales = await this.recalcular(id);

    await this.dataSource.query(
      `UPDATE crm.proforma
          SET estado = 'aceptada', cerrada_en = now(), aceptada_por = $2
        WHERE id = $1`,
      [id, quien],
    );
    const nombres = proforma.lineas
      .filter((l: any) => l.opcional && elegidas.has(Number(l.id)))
      .map((l: any) => l.descripcion);
    await this.anotar(
      id,
      'aceptada',
      `por ${dinero(totales.total)}` + (nombres.length ? `, con ${nombres.join(', ')}` : ''),
      quien,
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

  async rechazar(token: string, quien: string, motivoRechazo?: string, texto?: string) {
    const proforma = await this.porToken(token);
    if (!sePuedeResponder(proforma.estado as EstadoProforma)) {
      throw new ConflictException('Esta proforma ya no admite respuesta.');
    }
    // Un motivo que no está en la lista entra como «otro» en vez de fallar:
    // el cliente ya decidió que no, y perder su respuesta por un código mal
    // puesto es peor que clasificarla de más.
    const codigo = esMotivoDeRechazo(motivoRechazo) ? motivoRechazo : 'otro';
    await this.dataSource.query(
      `UPDATE crm.proforma
          SET estado = 'rechazada', cerrada_en = now(), aceptada_por = $2,
              motivo_rechazo = $3, motivo = $4
        WHERE id = $1`,
      [proforma.id, quien, codigo, texto?.trim() || null],
    );
    await this.anotar(
      Number(proforma.id),
      'rechazada',
      MOTIVOS_DE_RECHAZO[codigo] + (texto?.trim() ? `: ${texto.trim()}` : ''),
      quien,
    );
    return this.porToken(token);
  }

  /** Anular una proforma propia: se equivocó quien la hizo, no el cliente. */
  async anular(id: number, motivo: string, usuario: string) {
    const proforma = await this.obtener(id);
    if (proforma.estado === 'aceptada') {
      throw new ConflictException('Una proforma aceptada no se anula: el cliente ya dijo que sí.');
    }
    await this.dataSource.query(
      `UPDATE crm.proforma SET estado = 'anulada', cerrada_en = now(), motivo = $2 WHERE id = $1`,
      [id, motivo],
    );
    await this.anotar(id, 'anulada', motivo, usuario);
    return this.obtener(id);
  }
}

/** El primer correo de la lista que guarda el contacto, si tiene alguno. */
function primerCorreo(correos: unknown): string | null {
  if (!Array.isArray(correos)) return null;
  const primero = correos.find((c: any) => c?.email);
  return primero?.email ?? null;
}

function dinero(valor: number): string {
  return `$${Number(valor ?? 0).toFixed(2)}`;
}

function escapar(texto: string): string {
  return String(texto).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
