import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Tope de filas que se exportan de una vez. Ver `exportarCsv`. */
const MAX_EXPORT = 50_000;

/**
 * Filas de un resultado de TypeORM.
 *
 * En un SELECT, `query` devuelve el array de filas. En un INSERT o un DELETE
 * —aunque lleven RETURNING— devuelve `[filas, afectadas]`. Sin normalizarlo,
 * `res.length` vale 2 para cualquier INSERT y el conteo de altas sale mal sin
 * que nada falle de forma visible.
 */
function filasDe(res: unknown): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as any[]);
}

export interface Segmento {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  bloqueo: string | null;
  incluyeInactivos: boolean;
}

/**
 * Regla de negocio: un segmento comercial sólo contiene sujetos VIGENTES.
 *
 * No se le vende a una empresa en liquidación ni a un RUC suspendido. Como se
 * cumple SIEMPRE, se aplica aquí y no se copia en la condición de cada
 * segmento: repetida en ocho sitios, se olvidaría al escribir el noveno y ese
 * segmento saldría con muertos dentro sin que nada fallara.
 *
 * Las dos poblaciones no se miden igual:
 *
 * - **Compañías**: manda la situación legal de la Superintendencia. 14.936
 *   compañías siguen ACTIVO en el SRI mientras están en disolución o
 *   liquidación, y ésas no son prospecto. Se cruza además con el padrón, que
 *   descarta otras 3.134 que Supercias da por activas y el SRI tiene
 *   suspendidas.
 * - **Personas y sociedades no supervisadas**: sólo existe el estado del SRI.
 *
 * El `IS NULL` de las compañías no es un descuido: 1.451 compañías activas no
 * cruzaron con el padrón —RUC vacío o duplicado— y excluirlas sería castigarlas
 * por un fallo de enlace, no por estar inactivas.
 */
export const REGLA_VIGENCIA = `
  CASE p.tipo_sujeto
    WHEN 'compania' THEN
      p.situacion_legal = 'ACTIVA' AND (p.estado_sri = 'ACTIVO' OR p.estado_sri IS NULL)
    ELSE p.estado_sri = 'ACTIVO'
  END`;

/**
 * Segmentos de devolución de impuestos y la magnitud de crédito que miran.
 *
 * Su lista de trabajo no se lee por activos sino por el saldo del crédito y su
 * trayectoria, que es lo que el gestor tiene que decir en la llamada. El dato
 * es el mismo del análisis tributario (`balance_magnitud` y
 * `credito_tributario_empresa`): calcularlo aquí aparte daría dos saldos para la
 * misma empresa.
 */
const SEGMENTOS_CREDITO: Record<string, { impuesto: 'iva' | 'ir'; magnitud: string }> = {
  devolucion_iva: { impuesto: 'iva', magnitud: 'creditoIva' },
  devolucion_renta: { impuesto: 'ir', magnitud: 'creditoIr' },
};

/**
 * Capa comercial: segmentos sobre `perfil_comercial`.
 *
 * ## Las condiciones son SQL, y por eso nunca vienen del cliente
 *
 * `segmento.condicion` se interpola en un WHERE. Es deliberado —permite
 * expresar "sus activos cruzaron el medio millón entre su último cierre y el
 * anterior", que ningún constructor de casillas expresa— y es seguro sólo
 * mientras la condición venga de la tabla, que se llena en migraciones
 * revisadas. **Este servicio jamás debe aceptar un fragmento SQL por
 * parámetro.** Del cliente sólo llega el código del segmento, y va como
 * parámetro enlazado.
 */
@Injectable()
export class SegmentosService {
  private readonly logger = new Logger(SegmentosService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Reconstruye el perfil desde las tablas de origen.
   *
   * `CONCURRENTLY` no es un lujo: el refresco tarda ~30 s sobre 7,1 M de
   * sujetos y sin él la vista queda bloqueada todo ese rato, justo después de
   * una importación, que es cuando alguien está mirando.
   */
  async refrescarPerfil(): Promise<{ filas: number; ms: number }> {
    const t0 = Date.now();
    await this.dataSource.query('REFRESH MATERIALIZED VIEW CONCURRENTLY perfil_comercial');
    const [r] = await this.dataSource.query('SELECT count(*)::bigint AS n FROM perfil_comercial');
    const ms = Date.now() - t0;
    this.logger.log(`Perfil comercial refrescado: ${r.n} filas en ${(ms / 1000).toFixed(1)}s`);
    return { filas: Number(r.n), ms };
  }

  /** Segmentos con su tamaño actual, su última corrida y qué productos alimentan. */
  async listar() {
    return this.dataSource.query(`
      SELECT s.codigo, s.nombre, s.descripcion, s.activo, s.bloqueo,
             s.incluye_inactivos,
             (SELECT count(*)::int FROM segmento_miembro m WHERE m.segmento = s.codigo) AS miembros,
             c.ejecutado_en AS ultima_corrida,
             c.altas AS ultimas_altas,
             c.bajas AS ultimas_bajas,
             (SELECT count(*)::int FROM segmento_evento e
               WHERE e.segmento = s.codigo AND e.tipo = 'alta'
                 AND e.ocurrido_en > now() - interval '30 days') AS altas_30d,
             (SELECT coalesce(json_agg(json_build_object(
                       'codigo', p.codigo, 'nombre', p.nombre,
                       'unidad', u.nombre, 'prioridad', ps.prioridad)
                     ORDER BY ps.prioridad), '[]'::json)
                FROM producto_segmento ps
                JOIN producto p ON p.codigo = ps.producto
                JOIN unidad_negocio u ON u.codigo = p.unidad
               WHERE ps.segmento = s.codigo) AS productos
      FROM segmento s
      LEFT JOIN LATERAL (
        SELECT * FROM segmento_corrida sc
         WHERE sc.segmento = s.codigo
         ORDER BY sc.ejecutado_en DESC LIMIT 1
      ) c ON true
      ORDER BY s.activo DESC, s.nombre
    `);
  }

  private async buscar(codigo: string): Promise<Segmento> {
    const [s] = await this.dataSource.query(
      `SELECT codigo, nombre, descripcion, condicion, activo, bloqueo, incluye_inactivos
         FROM segmento WHERE codigo = $1`,
      [codigo],
    );
    if (!s) throw new NotFoundException(`No existe el segmento "${codigo}"`);
    return s;
  }

  /**
   * Recalcula la pertenencia y anota las entradas y salidas.
   *
   * Se hace en una transacción sobre UNA conexión porque usa tablas
   * temporales: partir esto en varias consultas del pool daría "relation does
   * not exist" en la segunda.
   *
   * El valor de la herramienta no es la lista —esa se mira una vez— sino las
   * altas: quién entró desde la corrida anterior. Por eso el diff se guarda.
   */
  async correr(codigo: string): Promise<{ total: number; altas: number; bajas: number; ms: number }> {
    const seg = await this.buscar(codigo);
    if (!seg.activo) {
      throw new NotFoundException(
        `El segmento "${codigo}" está inactivo: ${seg.bloqueo ?? 'faltan datos'}`,
      );
    }

    const t0 = Date.now();
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // `condicion` viene de la tabla, no del cliente. Ver la nota de la clase.
      //
      // La condición va entre paréntesis: sin ellos, un `OR` dentro de la
      // definición se comería el AND de la regla de vigencia y el segmento
      // saldría con inactivos, en silencio.
      const vigencia = (seg as any).incluye_inactivos ? 'true' : REGLA_VIGENCIA;
      await runner.query(`
        CREATE TEMP TABLE nuevo ON COMMIT DROP AS
        SELECT p.tipo_sujeto, p.clave
          FROM perfil_comercial p
         WHERE (${(seg as any).condicion}) AND (${vigencia})
      `);
      await runner.query('CREATE UNIQUE INDEX ON nuevo (tipo_sujeto, clave)');
      await runner.query('ANALYZE nuevo');

      const altas = filasDe(
        await runner.query(
          `INSERT INTO segmento_miembro (segmento, tipo_sujeto, clave)
           SELECT $1, n.tipo_sujeto, n.clave FROM nuevo n
           ON CONFLICT (segmento, tipo_sujeto, clave) DO NOTHING
           RETURNING tipo_sujeto, clave`,
          [codigo],
        ),
      );

      const bajas = filasDe(
        await runner.query(
          `DELETE FROM segmento_miembro m
            WHERE m.segmento = $1
              AND NOT EXISTS (
                SELECT 1 FROM nuevo n
                 WHERE n.tipo_sujeto = m.tipo_sujeto AND n.clave = m.clave)
           RETURNING m.tipo_sujeto, m.clave`,
          [codigo],
        ),
      );

      const [{ n: total }] = await runner.query('SELECT count(*)::int AS n FROM nuevo');
      const ms = Date.now() - t0;

      const [corrida] = filasDe(
        await runner.query(
          `INSERT INTO segmento_corrida (segmento, total, altas, bajas, duracion_ms)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [codigo, total, altas.length, bajas.length, ms],
        ),
      );

      // La primera corrida de un segmento nuevo daría un evento de alta por
      // cada miembro: son decenas de miles de "novedades" que no lo son. Se
      // registra el conteo en la corrida y no se generan eventos.
      const esPrimera = bajas.length === 0 && altas.length === total;
      if (!esPrimera) {
        for (const [tipo, filas] of [
          ['alta', altas],
          ['baja', bajas],
        ] as const) {
          if (filas.length === 0) continue;
          await runner.query(
            `INSERT INTO segmento_evento (segmento, tipo_sujeto, clave, tipo, corrida)
             SELECT $1, t.tipo_sujeto, t.clave, $2, $3
               FROM unnest($4::text[], $5::text[]) AS t(tipo_sujeto, clave)`,
            [
              codigo,
              tipo,
              corrida.id,
              filas.map((f: any) => f.tipo_sujeto),
              filas.map((f: any) => f.clave),
            ],
          );
        }
      }

      await runner.commitTransaction();
      this.logger.log(
        `Segmento ${codigo}: ${total} miembros (+${altas.length} / -${bajas.length}) en ${ms} ms`,
      );
      return { total, altas: altas.length, bajas: bajas.length, ms };
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  }

  /** Corre todos los segmentos activos, uno detrás de otro. */
  async correrTodos() {
    const activos = await this.dataSource.query(
      `SELECT codigo FROM segmento WHERE activo ORDER BY codigo`,
    );
    const out: Record<string, unknown>[] = [];
    for (const { codigo } of activos) {
      try {
        out.push({ codigo, ...(await this.correr(codigo)) });
      } catch (err) {
        out.push({ codigo, error: (err as Error).message });
      }
    }
    return out;
  }

  /**
   * Lista de trabajo de un segmento.
   *
   * `soloNovedades` devuelve únicamente las altas recientes, que es como se usa
   * a diario; el listado completo es para la primera pasada y para exportar.
   * Los sujetos marcados como cliente, en gestión o "no contactar" se excluyen
   * aquí y NO en el segmento: los conteos tienen que seguir diciendo la verdad
   * sobre el mercado.
   */
  async miembros(
    codigo: string,
    opciones: {
      limit?: number;
      offset?: number;
      soloNovedades?: boolean;
      dias?: number;
      soloConContacto?: boolean;
      provincia?: string;
      incluirGestionados?: boolean;
      /** Tope de filas por página. Sólo la exportación lo sube. */
      tope?: number;
    } = {},
  ) {
    await this.buscar(codigo);
    const limit = Math.min(opciones.limit ?? 50, opciones.tope ?? 500);
    const offset = opciones.offset ?? 0;
    const dias = opciones.dias ?? 30;

    const where: string[] = ['m.segmento = $1'];
    const params: unknown[] = [codigo];

    if (opciones.soloNovedades) {
      params.push(dias);
      where.push(`EXISTS (
        SELECT 1 FROM segmento_evento e
         WHERE e.segmento = m.segmento AND e.tipo_sujeto = m.tipo_sujeto
           AND e.clave = m.clave AND e.tipo = 'alta'
           AND e.ocurrido_en > now() - ($${params.length}::int * interval '1 day'))`);
    }
    if (opciones.soloConContacto) {
      where.push('(p.correo IS NOT NULL OR p.telefono IS NOT NULL)');
    }
    if (opciones.provincia) {
      params.push(opciones.provincia);
      where.push(`p.provincia = $${params.length}`);
    }
    if (!opciones.incluirGestionados) {
      where.push('ec.estado IS NULL');
    }

    // En los de devolución se ordena por el saldo del último ejercicio: la
    // primera página tiene que ser la de las devoluciones más grandes. La
    // magnitud sale de la constante, no del cliente.
    const credito = SEGMENTOS_CREDITO[codigo];
    const joinCredito = credito
      ? `LEFT JOIN balance_magnitud bm
           ON bm.anio = p.anio_ult AND bm.expediente = p.expediente`
      : '';
    const orden = credito
      ? `m.desde DESC, (bm.magnitudes->>'${credito.magnitud}')::numeric DESC NULLS LAST, p.nombre`
      : 'm.desde DESC, p.nombre';

    params.push(limit, offset);

    const datos = await this.dataSource.query(
      // Todo lo que el perfil sabe del sujeto. La pantalla decide qué enseña,
      // pero el API no puede ser la que recorte: es el mismo criterio que sigue
      // el listado del padrón, y es lo que evita que un dato ya cargado
      // desaparezca por el camino.
      `SELECT p.tipo_sujeto, p.clave, p.ruc, p.expediente, p.nombre, p.nombre_comercial,
              p.ciiu6, p.actividad, p.provincia, p.canton, p.parroquia, p.direccion,
              p.situacion_legal, p.tipo_compania, p.fecha_constitucion,
              p.capital_suscrito, p.representante, p.cargo,
              p.estado_sri, p.clase_sri, p.jurisdiccion,
              p.obligado_contabilidad, p.agente_retencion, p.contribuyente_especial,
              p.fecha_inicio_actividades, p.fecha_suspension_definitiva,
              p.fecha_reinicio_actividades, p.num_establecimientos,
              p.telefono, p.correo, p.sitio_web,
              p.anio_ult, p.activos_ult, p.ingresos_ult, p.patrimonio_ult, p.utilidad_ult,
              p.anio_prev, p.activos_prev, p.ingresos_prev,
              p.turismo_registros, p.turismo_ratificado,
              p.exportador_bienes_ir_anios, p.exportador_bienes_iva_anios,
              p.exportador_servicios_iva_anios,
              m.desde, ec.estado AS estado_comercial
         FROM segmento_miembro m
         JOIN perfil_comercial p
           ON p.tipo_sujeto = m.tipo_sujeto AND p.clave = m.clave
         LEFT JOIN sujeto_estado_comercial ec
           ON ec.tipo_sujeto = m.tipo_sujeto AND ec.clave = m.clave
         ${joinCredito}
        WHERE ${where.join(' AND ')}
        ORDER BY ${orden}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    if (credito) await this.adjuntarCredito(datos, credito.impuesto);

    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n
         FROM segmento_miembro m
         JOIN perfil_comercial p
           ON p.tipo_sujeto = m.tipo_sujeto AND p.clave = m.clave
         LEFT JOIN sujeto_estado_comercial ec
           ON ec.tipo_sujeto = m.tipo_sujeto AND ec.clave = m.clave
        WHERE ${where.join(' AND ')}`,
      params.slice(0, params.length - 2),
    );

    return { total: n, datos, impuesto: credito?.impuesto ?? null };
  }

  /**
   * Añade a cada fila el saldo del impuesto año por año y su diagnóstico.
   *
   * Va en una segunda consulta, sólo para los expedientes de la página: unida
   * al listado, la vista del diagnóstico se calcularía entera para cada página.
   * Con `= ANY` el filtro baja hasta la ventana de la vista y tarda decenas de
   * milisegundos.
   */
  private async adjuntarCredito(datos: any[], impuesto: 'iva' | 'ir') {
    const expedientes = datos.map(d => d.expediente).filter(Boolean);
    if (!expedientes.length) return;

    const magnitud = impuesto === 'iva' ? 'creditoIva' : 'creditoIr';
    const series = await this.dataSource.query(
      `SELECT expediente,
              jsonb_object_agg(anio, (magnitudes->>'${magnitud}')::numeric) AS por_anio
         FROM balance_magnitud
        WHERE expediente = ANY($1)
        GROUP BY expediente`,
      [expedientes],
    );
    const diagnosticos = await this.dataSource.query(
      `SELECT expediente, ultimo_anio,
              ${impuesto}_ini AS inicial, ${impuesto}_ult AS ultimo, ${impuesto}_max AS maximo,
              ${impuesto}_sube AS sube, ${impuesto}_baja AS baja,
              diagnostico_${impuesto} AS diagnostico
         FROM credito_tributario_empresa
        WHERE expediente = ANY($1)`,
      [expedientes],
    );

    const serie = new Map<string, Record<string, number>>(
      series.map((s: any) => [s.expediente, s.por_anio]),
    );
    const diag = new Map<string, Record<string, unknown>>(
      diagnosticos.map((d: any) => [d.expediente, d]),
    );
    for (const fila of datos) {
      fila.credito = { porAnio: serie.get(fila.expediente) ?? {}, ...(diag.get(fila.expediente) ?? {}) };
    }
  }

  /**
   * Exportación a CSV para trabajar la lista fuera.
   *
   * Se acota a `MAX_EXPORT` filas y se dice cuántas quedaron fuera: un
   * segmento como el de contadores pasa de 49.000 sujetos, y devolver eso en
   * una sola cadena es la forma más fácil de tumbar el proceso.
   */
  async exportarCsv(codigo: string, incluirGestionados = false): Promise<string> {
    const { datos, total, impuesto } = await this.miembros(codigo, {
      limit: MAX_EXPORT,
      tope: MAX_EXPORT,
      incluirGestionados,
    });

    // El CSV lleva TODAS las columnas del perfil. Quien exporta lo hace para
    // trabajar la lista fuera, y ahí no puede volver a pedir el dato que se
    // quedó en el servidor.
    const columnas = [
      'tipo_sujeto', 'ruc', 'expediente', 'nombre', 'nombre_comercial',
      'ciiu6', 'actividad', 'provincia', 'canton', 'parroquia', 'direccion',
      'situacion_legal', 'tipo_compania', 'fecha_constitucion', 'capital_suscrito',
      'representante', 'cargo',
      'estado_sri', 'clase_sri', 'jurisdiccion',
      'obligado_contabilidad', 'agente_retencion', 'contribuyente_especial',
      'fecha_inicio_actividades', 'fecha_suspension_definitiva', 'fecha_reinicio_actividades',
      'num_establecimientos',
      'telefono', 'correo', 'sitio_web',
      'anio_ult', 'activos_ult', 'ingresos_ult', 'patrimonio_ult', 'utilidad_ult',
      'anio_prev', 'activos_prev', 'ingresos_prev',
      'turismo_registros', 'turismo_ratificado',
      'exportador_bienes_ir_anios', 'exportador_bienes_iva_anios',
      'exportador_servicios_iva_anios',
    ];

    const escapar = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      // El driver entrega las fechas como Date, y `String(fecha)` da
      // "Thu May 18 2017 00:00:00 GMT-0500 (hora de Ecuador)" — ilegible en una
      // hoja de cálculo y distinto según la zona horaria del servidor.
      const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // En los de devolución, el saldo de cada ejercicio y el diagnóstico: es la
    // razón por la que la empresa está en la lista.
    const anios = impuesto
      ? [...new Set<string>(datos.flatMap((f: any) => Object.keys(f.credito?.porAnio ?? {})))].sort()
      : [];
    const cabecera = impuesto
      ? [...columnas, ...anios.map(a => `credito_${impuesto}_${a}`), `diagnostico_${impuesto}`]
      : columnas;

    const lineas = [cabecera.join(';')];
    for (const fila of datos) {
      const valores = columnas.map((c) => escapar((fila as any)[c]));
      if (impuesto) {
        const cr = (fila as any).credito ?? {};
        valores.push(...anios.map(a => escapar(cr.porAnio?.[a])), escapar(cr.diagnostico));
      }
      lineas.push(valores.join(';'));
    }
    if (total > datos.length) {
      lineas.push(`# ${total - datos.length} filas más no se exportaron (tope ${MAX_EXPORT})`);
    }
    return lineas.join('\n');
  }

  /**
   * Qué ofrecerle a un sujeto concreto.
   *
   * Es la vuelta al revés del segmento y la consulta que usa quien tiene la
   * ficha delante: en qué segmentos cae y, por tanto, qué productos tocan y en
   * qué orden.
   */
  async productosPara(tipoSujeto: string, clave: string) {
    return this.dataSource.query(
      `SELECT p.codigo, p.nombre, u.nombre AS unidad, ps.prioridad,
              s.codigo AS segmento, s.nombre AS segmento_nombre
         FROM segmento_miembro m
         JOIN producto_segmento ps ON ps.segmento = m.segmento
         JOIN producto p ON p.codigo = ps.producto AND p.activo
         JOIN unidad_negocio u ON u.codigo = p.unidad
         JOIN segmento s ON s.codigo = m.segmento
        WHERE m.tipo_sujeto = $1 AND m.clave = $2
        ORDER BY ps.prioridad, u.orden`,
      [tipoSujeto, clave],
    );
  }

  /** Marca el estado comercial de un sujeto para que deje de aparecer. */
  async marcarEstado(tipoSujeto: string, clave: string, estado: string, nota?: string) {
    await this.dataSource.query(
      `INSERT INTO sujeto_estado_comercial (tipo_sujeto, clave, estado, nota)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tipo_sujeto, clave) DO UPDATE
         SET estado = EXCLUDED.estado, nota = EXCLUDED.nota, actualizado_en = now()`,
      [tipoSujeto, clave, estado, nota ?? null],
    );
    return { tipoSujeto, clave, estado };
  }

  /** Catálogo de unidades y productos, con los segmentos que alimentan a cada uno. */
  async catalogo() {
    return this.dataSource.query(`
      SELECT u.codigo, u.nombre, u.descripcion,
             coalesce(json_agg(json_build_object(
               'codigo', p.codigo, 'nombre', p.nombre,
               'segmentos', (
                 SELECT coalesce(json_agg(json_build_object(
                          'codigo', s.codigo, 'nombre', s.nombre, 'activo', s.activo,
                          'miembros', (SELECT count(*)::int FROM segmento_miembro m
                                        WHERE m.segmento = s.codigo))
                        ORDER BY ps.prioridad), '[]'::json)
                   FROM producto_segmento ps
                   JOIN segmento s ON s.codigo = ps.segmento
                  WHERE ps.producto = p.codigo))
             ORDER BY p.nombre) FILTER (WHERE p.codigo IS NOT NULL) AS productos
        FROM unidad_negocio u
        LEFT JOIN producto p ON p.unidad = u.codigo AND p.activo
       GROUP BY u.codigo, u.nombre, u.descripcion, u.orden
       ORDER BY u.orden
    `);
  }
}
