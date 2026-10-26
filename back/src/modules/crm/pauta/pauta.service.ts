import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Cifras,
  DiaDeGasto,
  claveUtm,
  dentroDelPeriodo,
  esPlataforma,
  indicadores,
  leerInformeDeGasto,
  ritmo,
} from './pauta.reglas';

function filasDe(res: unknown): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as any[]);
}

function textoONulo(valor: unknown, max = 500): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === '' ? null : limpio.slice(0, max);
}

/**
 * Hoy en Ecuador, como `YYYY-MM-DD`.
 *
 * El ritmo de gasto compara contra los días transcurridos, y a las ocho de la
 * noche de Guayaquil ya es mañana en UTC: con la fecha del servidor, la
 * campaña parecería llevar un día más y saldría «por debajo» cada noche.
 */
function hoyEnEcuador(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
}

const esFecha = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Las cifras de cada campaña, en una sola consulta.
 *
 * El enlace con los leads es por `utm_campaign` sin mayúsculas, al consultar:
 * un lead que llegó antes de dar de alta la campaña cuenta igual. Los
 * ingresos siguen venta → oportunidad (`origen_lead`) → lead, y dejan fuera
 * las ventas anuladas: una venta deshecha no es retorno.
 *
 * Las fechas salen con `to_char`. Una columna `date` que el driver convierte
 * a `Date` de JavaScript llega como medianoche UTC, que en Ecuador es el día
 * anterior.
 */
const SQL_CIFRAS = `
  WITH gasto AS (
    SELECT pauta, sum(gasto)::float8 AS gasto,
           coalesce(sum(impresiones), 0)::int AS impresiones,
           coalesce(sum(clics), 0)::int AS clics,
           max(dia) AS ultimo_dia
      FROM crm.pauta_gasto GROUP BY pauta
  ),
  leads AS (
    SELECT p.id AS pauta, count(*)::int AS leads
      FROM crm.pauta p
      JOIN crm.lead l ON lower(l.origen_campania) = lower(p.utm_campaign)
     GROUP BY p.id
  ),
  oport AS (
    SELECT p.id AS pauta, count(DISTINCT o.id)::int AS oportunidades
      FROM crm.pauta p
      JOIN crm.lead l ON lower(l.origen_campania) = lower(p.utm_campaign)
      JOIN crm.oportunidad o ON o.origen_lead = l.id
     GROUP BY p.id
  ),
  ventas AS (
    SELECT p.id AS pauta,
           count(DISTINCT v.id)::int AS ventas,
           count(DISTINCT coalesce(v.company_id::text, v.tipo_sujeto || ':' || v.clave))::int AS clientes,
           coalesce(sum(v.monto), 0)::float8 AS ingresos,
           coalesce(sum(v.monto) FILTER (WHERE v.estado = 'cobrada'), 0)::float8 AS cobrado
      FROM crm.pauta p
      JOIN crm.lead l ON lower(l.origen_campania) = lower(p.utm_campaign)
      JOIN crm.oportunidad o ON o.origen_lead = l.id
      JOIN crm.venta v ON v.oportunidad = o.id AND v.estado <> 'anulada'
     GROUP BY p.id
  )
  SELECT p.id, p.nombre, p.marca, m.nombre AS marca_nombre, p.plataforma, p.producto,
         pr.nombre AS producto_nombre, p.utm_campaign, p.utm_source,
         p.presupuesto::float8 AS presupuesto,
         to_char(p.desde, 'YYYY-MM-DD') AS desde, to_char(p.hasta, 'YYYY-MM-DD') AS hasta,
         p.activa, p.nota, p.creada_por,
         coalesce(g.gasto, 0) AS gasto, coalesce(g.impresiones, 0) AS impresiones,
         coalesce(g.clics, 0) AS clics, to_char(g.ultimo_dia, 'YYYY-MM-DD') AS ultimo_dia_cargado,
         coalesce(l.leads, 0) AS leads, coalesce(op.oportunidades, 0) AS oportunidades,
         coalesce(v.ventas, 0) AS ventas, coalesce(v.clientes, 0) AS clientes,
         coalesce(v.ingresos, 0) AS ingresos, coalesce(v.cobrado, 0) AS cobrado
    FROM crm.pauta p
    JOIN crm.marca m ON m.codigo = p.marca
    LEFT JOIN producto pr ON pr.codigo = p.producto
    LEFT JOIN gasto g ON g.pauta = p.id
    LEFT JOIN leads l ON l.pauta = p.id
    LEFT JOIN oport op ON op.pauta = p.id
    LEFT JOIN ventas v ON v.pauta = p.id
`;

@Injectable()
export class PautaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ------------------------------------------------------------- consultar

  /**
   * Todas las campañas con sus indicadores, más el total.
   *
   * El total se calcula sumando cifras, no promediando indicadores: el CPL de
   * dos campañas juntas no es la media de sus CPL, y promediarlos le daría a
   * una campaña de diez dólares el mismo peso que a una de diez mil.
   */
  async listar(filtros: { marca?: string; plataforma?: string; activas?: boolean } = {}) {
    const where: string[] = [];
    const params: any[] = [];
    if (filtros.marca) {
      params.push(filtros.marca);
      where.push(`p.marca = $${params.length}`);
    }
    if (filtros.plataforma) {
      params.push(filtros.plataforma);
      where.push(`p.plataforma = $${params.length}`);
    }
    if (filtros.activas) where.push('p.activa');

    const filas = await this.dataSource.query(
      `${SQL_CIFRAS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.activa DESC, p.desde DESC, p.id DESC`,
      params,
    );
    const hoy = hoyEnEcuador();
    const pautas = filas.map((f: any) => this.conIndicadores(f, hoy));

    const suma = (k: keyof Cifras) => pautas.reduce((t: number, p: any) => t + Number(p[k] ?? 0), 0);
    const total: Cifras = {
      presupuesto: suma('presupuesto'),
      desde: '',
      hasta: '',
      gasto: suma('gasto'),
      impresiones: suma('impresiones'),
      clics: suma('clics'),
      leads: suma('leads'),
      oportunidades: suma('oportunidades'),
      ventas: suma('ventas'),
      clientes: suma('clientes'),
      ingresos: suma('ingresos'),
      cobrado: suma('cobrado'),
    };

    // El período no tiene sentido sumado: cada campaña tiene el suyo.
    const { desde: _d, hasta: _h, ...cifrasTotales } = total;
    return { pautas, total: { ...cifrasTotales, indicadores: indicadores(total) }, hoy };
  }

  /** Una campaña con su gasto y sus leads día a día. */
  async obtener(id: number) {
    const filas = await this.dataSource.query(`${SQL_CIFRAS} WHERE p.id = $1`, [id]);
    if (!filas[0]) throw new NotFoundException(`No existe la campaña ${id}`);
    const pauta = this.conIndicadores(filas[0], hoyEnEcuador());

    const [gasto, leads] = await Promise.all([
      this.dataSource.query(
        `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, gasto::float8 AS gasto, impresiones, clics,
                origen, cargado_por
           FROM crm.pauta_gasto WHERE pauta = $1 ORDER BY dia`,
        [id],
      ),
      // Los leads se agrupan por día de Ecuador por la misma razón que `hoy`.
      this.dataSource.query(
        `SELECT to_char(timezone('America/Guayaquil', l.recibido_en), 'YYYY-MM-DD') AS dia,
                count(*)::int AS leads,
                count(*) FILTER (WHERE l.estado = 'convertido')::int AS convertidos
           FROM crm.lead l
           JOIN crm.pauta p ON lower(l.origen_campania) = lower(p.utm_campaign)
          WHERE p.id = $1
          GROUP BY 1 ORDER BY 1`,
        [id],
      ),
    ]);
    return { ...pauta, gasto_diario: gasto, leads_diarios: leads };
  }

  /**
   * Las campañas que traen leads y no están dadas de alta.
   *
   * Es la fuga típica: alguien lanza un anuncio, etiqueta bien el enlace y no
   * registra la campaña. Sus leads llegan, pero su gasto no está en ningún
   * sitio y el retorno global sale mejor de lo que es.
   */
  async sinPauta() {
    return this.dataSource.query(
      `SELECT l.origen_campania AS utm_campaign,
              min(l.origen_fuente) AS utm_source,
              count(*)::int AS leads,
              to_char(max(l.recibido_en), 'YYYY-MM-DD') AS ultimo
         FROM crm.lead l
        WHERE l.origen_campania IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM crm.pauta p WHERE lower(p.utm_campaign) = lower(l.origen_campania))
        GROUP BY l.origen_campania
        ORDER BY count(*) DESC
        LIMIT 50`,
    );
  }

  // --------------------------------------------------------------- escribir

  async crear(datos: Record<string, any>, usuario: string) {
    const c = await this.validar(datos);
    try {
      const res = await this.dataSource.query(
        `INSERT INTO crm.pauta
           (nombre, marca, plataforma, producto, utm_campaign, utm_source, presupuesto,
            desde, hasta, activa, nota, creada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [c.nombre, c.marca, c.plataforma, c.producto, c.utm_campaign, c.utm_source,
         c.presupuesto, c.desde, c.hasta, c.activa, c.nota, usuario],
      );
      return this.obtener(Number(filasDe(res)[0].id));
    } catch (e) {
      throw this.traducir(e, c.utm_campaign);
    }
  }

  async editar(id: number, datos: Record<string, any>) {
    const actual = await this.obtener(id);
    const c = await this.validar({ ...actual, ...datos });
    try {
      await this.dataSource.query(
        `UPDATE crm.pauta
            SET nombre = $2, marca = $3, plataforma = $4, producto = $5, utm_campaign = $6,
                utm_source = $7, presupuesto = $8, desde = $9, hasta = $10, activa = $11, nota = $12
          WHERE id = $1`,
        [id, c.nombre, c.marca, c.plataforma, c.producto, c.utm_campaign, c.utm_source,
         c.presupuesto, c.desde, c.hasta, c.activa, c.nota],
      );
    } catch (e) {
      throw this.traducir(e, c.utm_campaign);
    }
    return this.obtener(id);
  }

  /**
   * Anota el gasto de un día a mano. Si el día ya tenía cifra, la reemplaza:
   * es una corrección, no un gasto adicional.
   */
  async anotarGasto(id: number, datos: Record<string, any>, usuario: string) {
    const pauta = await this.obtener(id);
    const dia = textoONulo(datos.dia, 10);
    if (!esFecha(dia)) throw new BadRequestException('Indica el día como AAAA-MM-DD.');
    if (dia < pauta.desde || dia > pauta.hasta) {
      throw new BadRequestException(
        `El ${dia} está fuera de la campaña (${pauta.desde} a ${pauta.hasta}).`,
      );
    }
    const gasto = Number(datos.gasto);
    if (!Number.isFinite(gasto) || gasto < 0) throw new BadRequestException('El gasto no es un número válido.');
    const entero = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new BadRequestException('Impresiones y clics van en números enteros.');
      return n;
    };

    await this.guardarDias(
      id,
      [{ dia, gasto: Math.round(gasto * 100) / 100, impresiones: entero(datos.impresiones), clics: entero(datos.clics) }],
      'manual',
      usuario,
    );
    return this.obtener(id);
  }

  async borrarGasto(id: number, dia: string) {
    await this.dataSource.query(`DELETE FROM crm.pauta_gasto WHERE pauta = $1 AND dia = $2`, [id, dia]);
    return this.obtener(id);
  }

  /**
   * Sube el informe de gasto que exporta la plataforma.
   *
   * Los días que trae reemplazan a los que ya estaban, así que subir dos veces
   * el mismo informe —o uno más largo que lo incluye— no duplica nada. Los
   * días fuera del período de la campaña no se guardan: suelen ser de otra
   * campaña que se coló en la exportación, y se devuelven para que se vea.
   */
  async importarInforme(id: number, buffer: Buffer | undefined, usuario: string) {
    if (!buffer?.length) throw new BadRequestException('No llegó ningún archivo.');
    const pauta = await this.obtener(id);
    const { dias, avisos, encoding } = leerInformeDeGasto(buffer);
    const { dentro, fuera } = dentroDelPeriodo(dias, pauta.desde, pauta.hasta);

    if (dentro.length) await this.guardarDias(id, dentro, 'archivo', usuario);

    return {
      cargados: dentro.length,
      gasto: Math.round(dentro.reduce((t, d) => t + d.gasto, 0) * 100) / 100,
      fuera: fuera.map((d) => d.dia),
      avisos,
      encoding,
      pauta: await this.obtener(id),
    };
  }

  // ---------------------------------------------------------------- privado

  private async guardarDias(id: number, dias: DiaDeGasto[], origen: string, usuario: string) {
    // Un solo INSERT con todos los días: o entra el informe entero o nada,
    // sin quedar a medias si falla una fila.
    const valores: any[] = [];
    const filas = dias.map((d, i) => {
      valores.push(id, d.dia, d.gasto, d.impresiones, d.clics, origen, usuario);
      const b = i * 7;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await this.dataSource.query(
      `INSERT INTO crm.pauta_gasto (pauta, dia, gasto, impresiones, clics, origen, cargado_por)
       VALUES ${filas.join(', ')}
       ON CONFLICT (pauta, dia) DO UPDATE
         SET gasto = EXCLUDED.gasto, impresiones = EXCLUDED.impresiones, clics = EXCLUDED.clics,
             origen = EXCLUDED.origen, cargado_por = EXCLUDED.cargado_por, cargado_en = now()`,
      valores,
    );
  }

  private conIndicadores(f: any, hoy: string) {
    const cifras: Cifras = {
      presupuesto: Number(f.presupuesto),
      desde: f.desde,
      hasta: f.hasta,
      gasto: Number(f.gasto),
      impresiones: Number(f.impresiones),
      clics: Number(f.clics),
      leads: Number(f.leads),
      oportunidades: Number(f.oportunidades),
      ventas: Number(f.ventas),
      clientes: Number(f.clientes),
      ingresos: Number(f.ingresos),
      cobrado: Number(f.cobrado),
    };
    return {
      ...f,
      ...cifras,
      indicadores: indicadores(cifras),
      ritmo: ritmo(cifras, hoy),
    };
  }

  private async validar(datos: Record<string, any>) {
    const nombre = textoONulo(datos.nombre, 200);
    if (!nombre) throw new BadRequestException('Falta el nombre de la campaña.');

    const marca = textoONulo(datos.marca);
    const existeMarca = marca
      ? await this.dataSource.query(`SELECT 1 FROM crm.marca WHERE codigo = $1`, [marca])
      : [];
    if (!existeMarca.length) throw new BadRequestException('Elige una marca que exista.');

    if (!esPlataforma(datos.plataforma)) {
      throw new BadRequestException('La plataforma tiene que ser Meta, Google, TikTok, LinkedIn u otra.');
    }

    const producto = textoONulo(datos.producto);
    if (producto) {
      const existe = await this.dataSource.query(`SELECT 1 FROM producto WHERE codigo = $1`, [producto]);
      if (!existe.length) throw new BadRequestException(`El producto «${producto}» no existe.`);
    }

    // Se guarda tal como se escribió —es la que se pega en el anuncio— pero
    // se valida sobre su clave: sin espacios dentro, porque un enlace con
    // espacios llega codificado (%20) y deja de coincidir.
    const utmCampaign = textoONulo(datos.utm_campaign, 200);
    if (!claveUtm(utmCampaign)) {
      throw new BadRequestException('Falta la utm_campaign: es la etiqueta con la que se reconocen sus leads.');
    }
    if (/\s/.test(utmCampaign!)) {
      throw new BadRequestException('La utm_campaign no puede llevar espacios: usa guiones («auditoria-octubre»).');
    }

    const presupuesto = Number(datos.presupuesto);
    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      throw new BadRequestException('El presupuesto tiene que ser un número mayor o igual a cero.');
    }

    const desde = textoONulo(datos.desde, 10);
    const hasta = textoONulo(datos.hasta, 10);
    if (!esFecha(desde) || !esFecha(hasta)) throw new BadRequestException('Indica desde y hasta como AAAA-MM-DD.');
    if (hasta < desde) throw new BadRequestException('La campaña termina antes de empezar.');

    return {
      nombre,
      marca: marca!,
      plataforma: datos.plataforma,
      producto,
      utm_campaign: utmCampaign!,
      utm_source: textoONulo(datos.utm_source, 100),
      presupuesto: Math.round(presupuesto * 100) / 100,
      desde,
      hasta,
      activa: datos.activa !== false,
      nota: textoONulo(datos.nota, 2000),
    };
  }

  private traducir(e: any, utm: string) {
    if (e?.code === '23505') {
      return new ConflictException(
        `Ya hay una campaña con la utm_campaign «${utm}». Si dos campañas la compartieran, cada lead contaría en las dos.`,
      );
    }
    return e;
  }
}
