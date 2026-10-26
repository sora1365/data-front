import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ComisionesService } from '../tableros/comisiones.service';
import {
  aDesactivar,
  costoHoraDeNomina,
  estadoTrasMovimiento,
  faltaParaFacturar,
  revisarArticulos,
  type ArticuloEntrante,
  type TipoDeMovimiento,
} from './contable.reglas';

export interface PerfilEntrante {
  perfil?: string;
  nombre?: string;
  costo_hora?: number | null;
  sueldo_mes?: number | null;
  carga_pct?: number | null;
  horas_mes?: number | null;
  personas?: number | null;
}

export interface MovimientoEntrante {
  venta?: number;
  /** O el número de proforma, que es lo que el contable tiene a la vista. */
  proforma?: string;
  tipo?: TipoDeMovimiento;
  documento?: string;
  monto?: number;
  fecha?: string;
  nota?: string;
  referencia?: string;
}

@Injectable()
export class ContableService {
  private readonly logger = new Logger('Contable');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly comisiones: ComisionesService,
  ) {}

  // ------------------------------------------------------------------ entra

  /**
   * El catálogo de inventario que manda el contable.
   *
   * Es un **lote completo**, no un diferencial: lo que no viene se desactiva.
   * Con diferenciales hay que acertar con el orden de llegada y basta perder
   * un mensaje para que el CRM se quede con precios viejos para siempre; con
   * el catálogo entero, la siguiente pasada corrige lo que fuera.
   */
  async sincronizarInventario(lote: ArticuloEntrante[]) {
    if (!Array.isArray(lote)) {
      throw new BadRequestException('Se esperaba una lista de artículos.');
    }

    const { validos, rechazos } = revisarArticulos(lote);

    const existentes = await this.dataSource.query(
      `SELECT codigo FROM crm.articulo WHERE activo`,
    );
    const desactivar = aDesactivar(
      existentes.map((f: any) => f.codigo),
      validos.map((a) => a.codigo),
    );

    await this.dataSource.transaction(async (manager) => {
      for (const a of validos) {
        await manager.query(
          `INSERT INTO crm.articulo
             (codigo, nombre, descripcion, unidad, precio, iva, stock, activo, sincronizado_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (codigo) DO UPDATE SET
             nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion,
             unidad = EXCLUDED.unidad, precio = EXCLUDED.precio, iva = EXCLUDED.iva,
             stock = EXCLUDED.stock, activo = EXCLUDED.activo,
             sincronizado_en = now()`,
          [a.codigo, a.nombre, a.descripcion, a.unidad, a.precio, a.iva, a.stock, a.activo],
        );
      }

      if (desactivar.length) {
        await manager.query(
          `UPDATE crm.articulo SET activo = false, sincronizado_en = now()
            WHERE codigo = ANY($1)`,
          [desactivar],
        );
      }
    });

    this.logger.log(
      `Inventario: ${validos.length} artículos, ${desactivar.length} desactivados, ${rechazos.length} rechazados.`,
    );
    return { recibidos: lote.length, guardados: validos.length, desactivados: desactivar.length, rechazos };
  }

  /**
   * El costo del personal, por perfil.
   *
   * Entra el costo por hora ya calculado o el sueldo con su carga y sus horas;
   * el CRM guarda **sólo el costo del perfil**, nunca sueldos nominales: un
   * CRM con la nómina dentro acaba enseñando sueldos a quien no debería.
   */
  async sincronizarNomina(lote: PerfilEntrante[]) {
    if (!Array.isArray(lote)) throw new BadRequestException('Se esperaba una lista de perfiles.');

    const rechazos: { perfil: string | null; motivo: string }[] = [];
    let guardados = 0;

    for (const entrada of lote) {
      const perfil = String(entrada?.perfil ?? '').trim();
      if (!perfil) {
        rechazos.push({ perfil: null, motivo: 'Sin código de perfil.' });
        continue;
      }

      const costo = costoHoraDeNomina(entrada);
      if (costo === null) {
        rechazos.push({
          perfil,
          motivo: 'Hace falta el costo por hora, o el sueldo con las horas al mes.',
        });
        continue;
      }

      await this.dataSource.query(
        `INSERT INTO crm.costo_personal
           (perfil, nombre, costo_hora, sueldo_mes, carga_pct, horas_mes, personas, sincronizado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (perfil) DO UPDATE SET
           nombre = EXCLUDED.nombre, costo_hora = EXCLUDED.costo_hora,
           sueldo_mes = EXCLUDED.sueldo_mes, carga_pct = EXCLUDED.carga_pct,
           horas_mes = EXCLUDED.horas_mes, personas = EXCLUDED.personas,
           sincronizado_en = now()`,
        [
          perfil,
          entrada.nombre?.trim() || perfil,
          costo,
          entrada.sueldo_mes ?? null,
          entrada.carga_pct ?? null,
          entrada.horas_mes ?? null,
          entrada.personas ?? null,
        ],
      );
      guardados += 1;
    }

    return { recibidos: lote.length, guardados, rechazos };
  }

  /**
   * Lo que el contable contesta sobre una venta: facturada, cobrada, anulada.
   *
   * Cada aviso se guarda como movimiento **y además** se refleja en el estado
   * de la venta. La `referencia` lo hace repetible sin consecuencias: el
   * contable reintenta cuando no recibe respuesta, y sin eso un cobro
   * reenviado contaría dos veces en las comisiones del mes.
   */
  async registrarMovimientos(lote: MovimientoEntrante[]) {
    if (!Array.isArray(lote)) throw new BadRequestException('Se esperaba una lista de avisos.');

    const aplicados: any[] = [];
    const rechazos: { referencia: string | null; motivo: string }[] = [];

    for (const aviso of lote) {
      const tipo = aviso?.tipo;
      if (!tipo || !['facturada', 'cobrada', 'anulada'].includes(tipo)) {
        rechazos.push({ referencia: aviso?.referencia ?? null, motivo: 'Tipo de aviso no válido.' });
        continue;
      }

      const venta = await this.buscarVenta(aviso);
      if (!venta) {
        rechazos.push({
          referencia: aviso?.referencia ?? null,
          motivo: 'No se encontró la venta ni por id ni por número de proforma.',
        });
        continue;
      }

      if (aviso.referencia) {
        const ya = await this.dataSource.query(
          `SELECT 1 FROM crm.venta_movimiento WHERE referencia = $1`,
          [aviso.referencia],
        );
        if (ya.length) {
          aplicados.push({ venta: venta.id, tipo, repetido: true });
          continue;
        }
      }

      const ocurrido = aviso.fecha ? new Date(aviso.fecha) : new Date();
      if (Number.isNaN(ocurrido.getTime())) {
        rechazos.push({ referencia: aviso.referencia ?? null, motivo: 'La fecha no se entiende.' });
        continue;
      }

      const nuevoEstado = estadoTrasMovimiento(venta.estado, tipo);

      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO crm.venta_movimiento
             (venta, tipo, documento, monto, ocurrido_en, nota, referencia)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            venta.id,
            tipo,
            aviso.documento ?? null,
            aviso.monto ?? null,
            ocurrido,
            aviso.nota ?? null,
            aviso.referencia ?? null,
          ],
        );

        if (nuevoEstado) {
          // Las fechas se escriben con la del aviso, no con `now()`: una
          // factura de ayer registrada hoy pertenece a ayer, y con `now()`
          // una venta de fin de mes se pasa al mes siguiente, donde cambia
          // de periodo la comisión.
          await manager.query(
            `UPDATE crm.venta
                SET estado = $2,
                    documento = coalesce($3, documento),
                    facturada_en = CASE WHEN $2 = 'facturada' THEN $4 ELSE facturada_en END,
                    cobrada_en = CASE WHEN $2 = 'cobrada' THEN $4 ELSE cobrada_en END,
                    anulada_en = CASE WHEN $2 = 'anulada' THEN $4 ELSE anulada_en END
              WHERE id = $1`,
            [venta.id, nuevoEstado, aviso.documento ?? null, ocurrido],
          );
        }
      });

      aplicados.push({ venta: venta.id, tipo, estado: nuevoEstado ?? venta.estado });
    }

    return { recibidos: lote.length, aplicados, rechazos };
  }

  private async buscarVenta(aviso: MovimientoEntrante) {
    if (aviso?.venta) {
      const filas = await this.dataSource.query(
        `SELECT id, estado FROM crm.venta WHERE id = $1`,
        [Number(aviso.venta)],
      );
      return filas[0] ?? null;
    }
    if (aviso?.proforma) {
      const filas = await this.dataSource.query(
        `SELECT v.id, v.estado
           FROM crm.venta v JOIN crm.proforma p ON p.id = v.proforma
          WHERE p.numero = $1`,
        [aviso.proforma],
      );
      return filas[0] ?? null;
    }
    return null;
  }

  // ------------------------------------------------------------------- sale

  /**
   * Las ventas que el contable tiene pendientes, con sus líneas.
   *
   * Cada una dice **qué le falta para poder facturarse**. Una empresa creada a
   * mano en el CRM puede no tener RUC, y entregarla con el campo en nulo hace
   * que el fallo aparezca del otro lado, donde nadie sabe de qué venta se
   * trata. No se esconde: la venta ocurrió y se entrega marcada.
   */
  async ventasPendientes(desde?: string) {
    const params: any[] = [];
    let filtro = `v.estado = 'pendiente_facturacion' AND v.anulada_en IS NULL`;
    if (desde) {
      params.push(desde);
      filtro += ` AND v.ganada_en >= $${params.length}`;
    }

    const filas = await this.dataSource.query(
      `SELECT v.id, v.oportunidad, v.marca, v.producto, v.monto::float8 AS monto,
              v.comercial, v.ruc, v.razon_social, v.direccion, v.estado,
              v.ganada_en, v.documento,
              p.numero AS proforma, p.total::float8 AS proforma_total,
              p.aceptada_por, p.cerrada_en AS aceptada_en,
              coalesce(
                (SELECT json_agg(json_build_object(
                          'orden', l.orden, 'producto', l.producto, 'articulo', l.articulo,
                          'descripcion', l.descripcion,
                          'cantidad', l.cantidad::float8,
                          'precio_unitario', l.precio_unitario::float8,
                          'descuento_pct', l.descuento_pct::float8,
                          'iva_pct', l.iva_pct::float8)
                        ORDER BY l.orden)
                   FROM crm.proforma_linea l WHERE l.proforma = p.id),
                '[]'::json
              ) AS lineas
         FROM crm.venta v
         LEFT JOIN crm.proforma p ON p.id = v.proforma
        WHERE ${filtro}
        ORDER BY v.ganada_en`,
      params,
    );

    return filas.map((v: any) => ({ ...v, falta_para_facturar: faltaParaFacturar(v) }));
  }

  /**
   * Las cotizaciones aceptadas.
   *
   * Es la misma venta vista desde el documento: el contable que factura por
   * proforma pregunta por el número que tiene el cliente, no por un id
   * interno del CRM.
   */
  async cotizacionesAceptadas(desde?: string) {
    const params: any[] = [];
    let filtro = `p.estado = 'aceptada'`;
    if (desde) {
      params.push(desde);
      filtro += ` AND p.cerrada_en >= $${params.length}`;
    }

    return this.dataSource.query(
      `SELECT p.numero, p.razon_social, p.ruc, p.direccion, p.correo,
              p.subtotal::float8 AS subtotal, p.descuento::float8 AS descuento,
              p.iva::float8 AS iva, p.total::float8 AS total,
              p.aceptada_por, p.cerrada_en AS aceptada_en,
              v.id AS venta, v.estado AS venta_estado, v.documento,
              o.id AS oportunidad, o.comercial,
              coalesce(
                (SELECT json_agg(json_build_object(
                          'orden', l.orden, 'producto', l.producto, 'articulo', l.articulo,
                          'descripcion', l.descripcion,
                          'cantidad', l.cantidad::float8,
                          'precio_unitario', l.precio_unitario::float8,
                          'descuento_pct', l.descuento_pct::float8,
                          'iva_pct', l.iva_pct::float8,
                          'cotizacion', l.cotizacion)
                        ORDER BY l.orden)
                   FROM crm.proforma_linea l WHERE l.proforma = p.id),
                '[]'::json
              ) AS lineas
         FROM crm.proforma p
         JOIN crm.oportunidad o ON o.id = p.oportunidad
         LEFT JOIN crm.venta v ON v.proforma = p.id
        WHERE ${filtro}
        ORDER BY p.cerrada_en DESC`,
      params,
    );
  }

  /**
   * Lo que hay que pagar de comisiones, por comercial y mes.
   *
   * Se calcula con las mismas reglas que enseña el tablero —sobre lo cobrado,
   * con el umbral de cada regla— para que no haya dos cifras de comisión en la
   * empresa. Devuelve también el correo del comercial, que es lo que el
   * contable necesita para el rol de pagos.
   */
  async comisionesDelMes(anio: number, mes: number) {
    const filas = await this.comisiones.delMes(anio, mes);
    const correos = await this.dataSource.query(
      `SELECT usuario, email, first_name, last_name FROM crm.comercial`,
    );
    const porUsuario = new Map(correos.map((c: any) => [c.usuario, c]));

    return {
      anio,
      mes,
      base: 'ventas cobradas en el mes',
      comerciales: filas.map((f: any) => ({
        ...f,
        correo: (porUsuario.get(f.comercial) as any)?.email ?? null,
      })),
      total: Math.round(filas.reduce((s: number, f: any) => s + f.comision, 0) * 100) / 100,
    };
  }

  // ------------------------------------------------- lo que el CRM consulta

  /** Los artículos del inventario, para elegirlos al cotizar. */
  articulos(busqueda?: string) {
    const params: any[] = [];
    let filtro = 'activo';
    if (busqueda?.trim()) {
      params.push(`%${busqueda.trim().toLowerCase()}%`);
      filtro += ` AND (lower(nombre) LIKE $1 OR lower(codigo) LIKE $1)`;
    }
    return this.dataSource.query(
      `SELECT codigo, nombre, unidad, precio::float8 AS precio, iva::float8 AS iva,
              stock::float8 AS stock, sincronizado_en
         FROM crm.articulo
        WHERE ${filtro}
        ORDER BY nombre
        LIMIT 100`,
      params,
    );
  }

  perfiles() {
    return this.dataSource.query(
      `SELECT perfil, nombre, costo_hora::float8 AS costo_hora, personas, sincronizado_en
         FROM crm.costo_personal ORDER BY nombre`,
    );
  }

  /** Qué tan al día está cada cosa que llega del contable. */
  async estado() {
    const [articulos, perfiles, movimientos] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS total, max(sincronizado_en) AS ultima FROM crm.articulo WHERE activo`,
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS total, max(sincronizado_en) AS ultima FROM crm.costo_personal`,
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS total, max(recibido_en) AS ultima FROM crm.venta_movimiento`,
      ),
    ]);

    return {
      conectado: Boolean(process.env.CONTABLE_API_KEY?.trim()),
      inventario: articulos[0],
      nomina: perfiles[0],
      movimientos: movimientos[0],
    };
  }

  async movimientosDe(venta: number) {
    const filas = await this.dataSource.query(
      `SELECT id, tipo, documento, monto::float8 AS monto, ocurrido_en, nota, recibido_en
         FROM crm.venta_movimiento WHERE venta = $1 ORDER BY ocurrido_en`,
      [venta],
    );
    if (filas.length === 0) {
      const existe = await this.dataSource.query(`SELECT 1 FROM crm.venta WHERE id = $1`, [venta]);
      if (existe.length === 0) throw new NotFoundException(`No existe la venta ${venta}`);
    }
    return filas;
  }
}
