import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { diaLocal } from '../agenda/agenda.reglas';
import { CorreoConector } from '../campanias/correo.conector';
import { ProformasService } from '../proformas/proformas.service';
import {
  alertas,
  cuelloDeBotella,
  DIAS_PARA_ESTANCADA,
  DIMENSIONES,
  esCorreo,
  METRICAS,
  mesDe,
  periodoAnterior,
  probabilidadObservada,
  pronostico,
  sumarMeses,
  tasaDeFila,
  tiemposPorEtapa,
  validarDefinicion,
  variacion,
  type DefinicionDeReporte,
  type Dimension,
  type Frecuencia,
  type Metrica,
} from './analitica.reglas';

/** Los filtros que entienden todas las vistas. */
export interface Filtros {
  marca?: string;
  comercial?: string;
  /** Un supervisor: él y todos los que cuelgan de él, a cualquier profundidad. */
  equipo?: string;
}

/**
 * Los comerciales de un equipo, como subconsulta.
 *
 * Recursiva: el equipo de una gerente incluye a los supervisores que
 * responden a ella **y a su gente**. Con un solo nivel, el tablero de
 * dirección enseñaría sólo a los jefes, que son los que menos venden.
 */
export function sqlEquipo(parametro: number): string {
  return `(WITH RECURSIVE eq AS (
             SELECT usuario FROM crm.comercial WHERE usuario = $${parametro}
             UNION
             SELECT c.usuario FROM crm.comercial c JOIN eq ON c.supervisor = eq.usuario
           ) SELECT usuario FROM eq)`;
}

/** Cada cuánto se mira si toca mandar algún reporte. */
const VUELTA_DE_REPORTES_MS = 10 * 60 * 1000;

/**
 * La analítica que mira hacia delante y la que se arma a medida.
 *
 * `TablerosService` cuenta lo que pasó en un periodo; esto añade lo que viene
 * (pronóstico), dónde se atasca (pipeline), quién mueve qué (productividad),
 * cómo va respecto a antes (tendencia), qué hay que mirar hoy (alertas) y los
 * reportes que cada quien se arma.
 */
@Injectable()
export class AnaliticaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnaliticaService.name);
  private reloj: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly correo: CorreoConector,
    private readonly proformas: ProformasService,
  ) {}

  onModuleInit() {
    // En las pruebas no corre: un reloj vivo mantiene abierto el proceso de
    // Jest y, peor, mandaría correos de verdad desde una base de prueba.
    if (process.env.NODE_ENV === 'test' || process.env.REPORTES_PROGRAMADOS === 'no') return;
    this.reloj = setInterval(() => {
      this.enviarProgramados().catch((e) =>
        this.logger.error('Falló la vuelta de reportes programados', e as Error),
      );
    }, VUELTA_DE_REPORTES_MS);
    this.reloj.unref();
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
  }

  /**
   * Los filtros comunes sobre una tabla con `marca` y `comercial`.
   *
   * `alias` es SQL fijo escrito en este archivo; los valores van siempre como
   * parámetros, empezando por el `inicio` que diga quien llama.
   */
  private filtro(f: Filtros, alias: string, params: any[]): string {
    const partes: string[] = [];
    if (f.marca) {
      params.push(f.marca);
      partes.push(`${alias}.marca = $${params.length}`);
    }
    if (f.comercial) {
      params.push(f.comercial);
      partes.push(`${alias}.comercial = $${params.length}`);
    }
    if (f.equipo) {
      params.push(f.equipo);
      partes.push(`${alias}.comercial IN ${sqlEquipo(params.length)}`);
    }
    return partes.length ? ` AND ${partes.join(' AND ')}` : '';
  }

  private etapas() {
    return this.dataSource.query(
      `SELECT codigo, nombre, orden, es_ganada, es_perdida, probabilidad
         FROM crm.etapa ORDER BY orden`,
    );
  }

  // -------------------------------------------------------------- pronóstico

  /**
   * Lo que viene: el pipeline abierto repartido por mes de cierre.
   *
   * La probabilidad observada se calcula con lo **cerrado en el último año**:
   * más atrás, el equipo, los precios y el producto eran otros, y una tasa de
   * hace tres años describe una empresa que ya no existe.
   */
  async pronostico(f: Filtros, meses = 3) {
    const hoy = diaLocal();
    const [etapas, abiertas, pasos, ganadoMes, metas] = await Promise.all([
      this.etapas(),
      this.abiertas(f),
      this.pasosDelAnio(f),
      this.vendido(f, `${mesDe(hoy)}-01`, `${sumarMeses(mesDe(hoy), 1)}-01`),
      this.metaDelMes(f, hoy),
    ]);

    const observada = probabilidadObservada(etapas, pasos);
    const pron = pronostico(
      abiertas,
      new Map(observada.map((o) => [o.codigo, o.probabilidad])),
      hoy,
      Math.min(Math.max(meses, 1), 12),
    );

    // Por comercial, sólo el mes en curso: es la conversación de los lunes.
    const porComercial = new Map<string, { comercial: string; nombre: string; abierto: number; ponderado: number }>();
    for (const o of abiertas) {
      if (!o.cierre_estimado || o.cierre_estimado < hoy || mesDe(o.cierre_estimado) !== mesDe(hoy)) continue;
      const fila = porComercial.get(o.comercial) ?? {
        comercial: o.comercial,
        nombre: o.nombre_comercial,
        abierto: 0,
        ponderado: 0,
      };
      fila.abierto += Number(o.monto ?? 0);
      fila.ponderado += (Number(o.monto ?? 0) * o.probabilidad) / 100;
      porComercial.set(o.comercial, fila);
    }

    return {
      ...pron,
      etapas: etapas
        .filter((e: any) => !e.es_ganada && !e.es_perdida)
        .map((e: any) => ({
          codigo: e.codigo,
          nombre: e.nombre,
          declarada: e.probabilidad,
          ...observada.find((o) => o.codigo === e.codigo),
        })),
      mesActual: {
        meta: metas,
        ganado: ganadoMes.total,
        // Lo que se espera terminar el mes: lo ganado más lo ponderado que
        // dice cerrar en lo que queda.
        esperado: ganadoMes.total + (pron.meses[0]?.ponderado ?? 0),
      },
      porComercial: [...porComercial.values()]
        .map((c) => ({ ...c, abierto: Math.round(c.abierto), ponderado: Math.round(c.ponderado) }))
        .sort((a, b) => b.ponderado - a.ponderado),
    };
  }

  private async abiertas(f: Filtros) {
    const params: any[] = [];
    const extra = this.filtro(f, 'o', params);
    const filas = await this.dataSource.query(
      `SELECT o.id, o.name, o.monto::float8 AS monto, o.etapa, e.probabilidad,
              to_char(o.cierre_estimado, 'YYYY-MM-DD') AS cierre_estimado,
              o.comercial,
              coalesce(nullif(trim(c.first_name || ' ' || coalesce(c.last_name, '')), ''), o.comercial)
                AS nombre_comercial
         FROM crm.oportunidad o
         JOIN crm.etapa e ON e.codigo = o.etapa
         LEFT JOIN crm.comercial c ON c.usuario = o.comercial
        WHERE o.archivada_en IS NULL AND NOT e.es_ganada AND NOT e.es_perdida ${extra}`,
      params,
    );
    return filas.map((o: any) => ({ ...o, probabilidad: Number(o.probabilidad) }));
  }

  /** Los pasos de las oportunidades que se cerraron en el último año. */
  private pasosDelAnio(f: Filtros) {
    const params: any[] = [];
    const extra = this.filtro(f, 'o', params);
    return this.dataSource.query(
      `SELECT h.oportunidad, h.hasta, h.ocurrido_en
         FROM crm.oportunidad_etapa h
         JOIN crm.oportunidad o ON o.id = h.oportunidad
        WHERE o.archivada_en IS NULL
          AND o.id IN (SELECT h2.oportunidad FROM crm.oportunidad_etapa h2
                         JOIN crm.etapa e2 ON e2.codigo = h2.hasta
                        WHERE (e2.es_ganada OR e2.es_perdida)
                          AND h2.ocurrido_en >= now() - interval '1 year')
          ${extra}
        ORDER BY h.ocurrido_en`,
      params,
    );
  }

  private async vendido(f: Filtros, desde: string, hasta: string) {
    const params: any[] = [desde, hasta];
    const extra = this.filtro(f, 'v', params);
    const filas = await this.dataSource.query(
      `SELECT coalesce(sum(v.monto), 0)::float8 AS total, count(*)::int AS cuenta
         FROM crm.venta v
        WHERE v.ganada_en >= $1 AND v.ganada_en < $2 AND v.anulada_en IS NULL ${extra}`,
      params,
    );
    return { total: Number(filas[0]?.total ?? 0), cuenta: Number(filas[0]?.cuenta ?? 0) };
  }

  /**
   * La meta del mes de quienes entran en el filtro.
   *
   * Con filtro de marca se suman sólo las metas de esa marca: sumarle las
   * generales compararía las ventas de una marca con la meta de todas.
   */
  private async metaDelMes(f: Filtros, hoy: string): Promise<number | null> {
    const [anio, mes] = hoy.split('-').map(Number);
    const params: any[] = [anio, mes];
    const partes: string[] = [];
    if (f.marca) {
      params.push(f.marca);
      partes.push(`m.marca = $${params.length}`);
    }
    if (f.comercial) {
      params.push(f.comercial);
      partes.push(`m.comercial = $${params.length}`);
    }
    if (f.equipo) {
      params.push(f.equipo);
      partes.push(`m.comercial IN ${sqlEquipo(params.length)}`);
    }
    const filas = await this.dataSource.query(
      `SELECT sum(m.monto)::float8 AS meta FROM crm.meta m
        WHERE m.anio = $1 AND m.mes = $2 ${partes.length ? `AND ${partes.join(' AND ')}` : ''}`,
      params,
    );
    return filas[0]?.meta === null || filas[0]?.meta === undefined ? null : Number(filas[0].meta);
  }

  // ---------------------------------------------------------------- pipeline

  /**
   * Dónde está el dinero abierto y dónde se atasca.
   *
   * «Sin movimiento» es sin cambio de etapa **y** sin ninguna conversación
   * anotada. Mirar sólo la etapa marca como parada una venta en la que se
   * habla con el cliente cada semana; mirar sólo las conversaciones esconde
   * las que nadie toca desde que se abrieron.
   */
  async pipeline(f: Filtros) {
    const params: any[] = [];
    const extra = this.filtro(f, 'o', params);
    const [etapas, abiertas, pasos] = await Promise.all([
      this.etapas(),
      this.dataSource.query(
        `SELECT o.id, o.name, o.etapa, o.monto::float8 AS monto, e.probabilidad, o.comercial,
                emp.name AS empresa,
                extract(epoch FROM now() - o.creada_en) / 86400 AS edad,
                extract(epoch FROM now() - coalesce(ult.cambio, o.creada_en)) / 86400 AS en_etapa,
                extract(epoch FROM now() - greatest(
                  coalesce(ult.cambio, o.creada_en), coalesce(conv.ultima, o.creada_en)
                )) / 86400 AS sin_movimiento
           FROM crm.oportunidad o
           JOIN crm.etapa e ON e.codigo = o.etapa
           LEFT JOIN crm.empresa emp ON emp.id = o.company_id
           LEFT JOIN LATERAL (
             SELECT max(h.ocurrido_en) AS cambio FROM crm.oportunidad_etapa h WHERE h.oportunidad = o.id
           ) ult ON true
           LEFT JOIN LATERAL (
             SELECT max(i.ocurrido_en) AS ultima FROM crm.interaccion i
              WHERE i.oportunidad = o.id AND i.canal <> 'sistema'
           ) conv ON true
          WHERE o.archivada_en IS NULL AND NOT e.es_ganada AND NOT e.es_perdida ${extra}`,
        params,
      ),
      this.pasosParaTiempos(f),
    ]);

    const porEtapa = etapas
      .filter((e: any) => !e.es_ganada && !e.es_perdida)
      .map((e: any) => {
        const aqui = abiertas.filter((o: any) => o.etapa === e.codigo);
        const valor = aqui.reduce((s: number, o: any) => s + Number(o.monto ?? 0), 0);
        return {
          codigo: e.codigo,
          nombre: e.nombre,
          probabilidad: e.probabilidad,
          cuenta: aqui.length,
          valor: Math.round(valor),
          ponderado: Math.round((valor * e.probabilidad) / 100),
          diasEnEtapa: aqui.length
            ? Math.round(aqui.reduce((s: number, o: any) => s + Number(o.en_etapa), 0) / aqui.length)
            : null,
          estancadas: aqui.filter((o: any) => Number(o.sin_movimiento) > DIAS_PARA_ESTANCADA).length,
        };
      });

    const tiempos = tiemposPorEtapa(pasos, etapas);
    const nombreDe = new Map(etapas.map((e: any) => [e.codigo, e.nombre]));
    const cuello = cuelloDeBotella(tiempos);

    const estancadas = abiertas
      .filter((o: any) => Number(o.sin_movimiento) > DIAS_PARA_ESTANCADA)
      .sort((a: any, b: any) => Number(b.monto ?? 0) - Number(a.monto ?? 0))
      .slice(0, 25)
      .map((o: any) => ({
        id: Number(o.id),
        nombre: o.name,
        empresa: o.empresa,
        comercial: o.comercial,
        etapa: nombreDe.get(o.etapa) ?? o.etapa,
        monto: Number(o.monto ?? 0),
        diasSinMovimiento: Math.floor(Number(o.sin_movimiento)),
      }));

    const valor = abiertas.reduce((s: number, o: any) => s + Number(o.monto ?? 0), 0);
    return {
      abiertas: abiertas.length,
      valor: Math.round(valor),
      ponderado: porEtapa.reduce((s: number, e: any) => s + e.ponderado, 0),
      edadMedia: abiertas.length
        ? Math.round(abiertas.reduce((s: number, o: any) => s + Number(o.edad), 0) / abiertas.length)
        : null,
      totalEstancadas: abiertas.filter((o: any) => Number(o.sin_movimiento) > DIAS_PARA_ESTANCADA).length,
      diasParaEstancada: DIAS_PARA_ESTANCADA,
      porEtapa,
      tiempos: tiempos.map((t) => ({ ...t, nombre: nombreDe.get(t.codigo) ?? t.codigo })),
      cuello: cuello ? { ...cuello, nombre: nombreDe.get(cuello.codigo) ?? cuello.codigo } : null,
      estancadas,
    };
  }

  /** Los pasos del último año, para medir cuánto dura cada etapa. */
  private pasosParaTiempos(f: Filtros) {
    const params: any[] = [];
    const extra = this.filtro(f, 'o', params);
    return this.dataSource.query(
      `SELECT h.oportunidad, h.hasta, h.ocurrido_en
         FROM crm.oportunidad_etapa h
         JOIN crm.oportunidad o ON o.id = h.oportunidad
        WHERE o.archivada_en IS NULL AND o.creada_en >= now() - interval '1 year' ${extra}`,
      params,
    );
  }

  // ----------------------------------------------------------- productividad

  /**
   * Qué hizo cada comercial en el periodo.
   *
   * Entran todos los activos aunque no hayan hecho nada: la fila en ceros es
   * la que hay que ver. Las actividades se atribuyen a quien las firmó, no al
   * dueño de la oportunidad: si una compañera llama por ti, la llamada es
   * suya.
   */
  async productividad(desde: string, hasta: string, f: Filtros) {
    const params: any[] = [desde, hasta];
    const partes: string[] = ['NOT c.disabled'];
    if (f.comercial) {
      params.push(f.comercial);
      partes.push(`c.usuario = $${params.length}`);
    }
    if (f.equipo) {
      params.push(f.equipo);
      partes.push(`c.usuario IN ${sqlEquipo(params.length)}`);
    }
    // La marca filtra lo que tiene marca —oportunidades, ventas, proformas—;
    // llamadas y tareas no la tienen y se cuentan enteras.
    let marca = '';
    if (f.marca) {
      params.push(f.marca);
      marca = ` AND o.marca = $${params.length}`;
    }

    return this.dataSource.query(
      `SELECT c.usuario AS comercial,
              coalesce(nullif(trim(c.first_name || ' ' || coalesce(c.last_name, '')), ''), c.usuario) AS nombre,
              c.supervisor,
              (SELECT count(*) FROM crm.interaccion i
                WHERE i.autor = c.usuario AND i.canal <> 'sistema'
                  AND i.ocurrido_en >= $1 AND i.ocurrido_en < $2)::int AS interacciones,
              (SELECT count(*) FROM crm.interaccion i
                WHERE i.autor = c.usuario AND i.canal = 'llamada'
                  AND i.ocurrido_en >= $1 AND i.ocurrido_en < $2)::int AS llamadas,
              (SELECT count(*) FROM crm.evento ev
                WHERE ev.creado_por = c.usuario AND ev.inicio >= $1 AND ev.inicio < $2)::int AS reuniones,
              (SELECT count(*) FROM crm.evento ev
                WHERE ev.creado_por = c.usuario AND ev.asistio
                  AND ev.inicio >= $1 AND ev.inicio < $2)::int AS reuniones_realizadas,
              (SELECT count(*) FROM crm.tarea t
                WHERE t.sales_id = c.usuario AND t.done_date >= $1 AND t.done_date < $2)::int AS tareas_hechas,
              (SELECT count(*) FROM crm.tarea t
                WHERE t.sales_id = c.usuario AND t.done_date IS NULL
                  AND t.due_date < current_date)::int AS tareas_vencidas,
              (SELECT count(*) FROM crm.oportunidad o
                WHERE o.comercial = c.usuario AND o.archivada_en IS NULL
                  AND o.creada_en >= $1 AND o.creada_en < $2 ${marca})::int AS abiertas,
              (SELECT count(*) FROM crm.proforma p JOIN crm.oportunidad o ON o.id = p.oportunidad
                WHERE o.comercial = c.usuario AND p.enviada_en >= $1 AND p.enviada_en < $2 ${marca})::int
                AS propuestas,
              (SELECT count(*) FROM crm.venta v LEFT JOIN crm.oportunidad o ON o.id = v.oportunidad
                WHERE v.comercial = c.usuario AND v.anulada_en IS NULL
                  AND v.ganada_en >= $1 AND v.ganada_en < $2 ${marca.replace('o.marca', 'v.marca')})::int
                AS ganadas,
              (SELECT coalesce(sum(v.monto), 0) FROM crm.venta v
                WHERE v.comercial = c.usuario AND v.anulada_en IS NULL
                  AND v.ganada_en >= $1 AND v.ganada_en < $2 ${marca.replace('o.marca', 'v.marca')})::float8
                AS vendido
         FROM crm.comercial c
        WHERE ${partes.join(' AND ')}
        ORDER BY vendido DESC, nombre`,
      params,
    );
  }

  // --------------------------------------------------------------- tendencia

  /**
   * Mes a mes, con el mismo mes del año anterior al lado.
   *
   * El año anterior y no el mes anterior: comparar diciembre con noviembre
   * mide la Navidad, no al equipo.
   */
  async tendencia(f: Filtros, meses = 12) {
    const n = Math.min(Math.max(meses, 3), 36);
    const hoy = diaLocal();
    const ultimo = mesDe(hoy);
    const primero = sumarMeses(ultimo, -(n - 1));
    const desde = `${primero}-01`;
    const hasta = `${sumarMeses(ultimo, 1)}-01`;
    const desdeAnterior = `${sumarMeses(primero, -12)}-01`;

    const pVentas: any[] = [desdeAnterior, hasta];
    const fVentas = this.filtro(f, 'v', pVentas);
    const pOps: any[] = [desde, hasta];
    const fOps = this.filtro(f, 'o', pOps);
    const pPerd: any[] = [desde, hasta];
    const fPerd = this.filtro(f, 'o', pPerd);

    const [ventas, abiertas, perdidas] = await Promise.all([
      this.dataSource.query(
        `SELECT to_char(v.ganada_en, 'YYYY-MM') AS mes, count(*)::int AS ganadas,
                sum(v.monto)::float8 AS vendido
           FROM crm.venta v
          WHERE v.anulada_en IS NULL AND v.ganada_en >= $1 AND v.ganada_en < $2 ${fVentas}
          GROUP BY 1`,
        pVentas,
      ),
      this.dataSource.query(
        `SELECT to_char(o.creada_en, 'YYYY-MM') AS mes, count(*)::int AS abiertas
           FROM crm.oportunidad o
          WHERE o.archivada_en IS NULL AND o.creada_en >= $1 AND o.creada_en < $2 ${fOps}
          GROUP BY 1`,
        pOps,
      ),
      this.dataSource.query(
        `SELECT to_char(h.ocurrido_en, 'YYYY-MM') AS mes, count(DISTINCT h.oportunidad)::int AS perdidas
           FROM crm.oportunidad_etapa h
           JOIN crm.etapa e ON e.codigo = h.hasta AND e.es_perdida
           JOIN crm.oportunidad o ON o.id = h.oportunidad
          WHERE o.archivada_en IS NULL AND h.ocurrido_en >= $1 AND h.ocurrido_en < $2 ${fPerd}
          GROUP BY 1`,
        pPerd,
      ),
    ]);

    const de = <T extends { mes: string }>(filas: T[]) => new Map(filas.map((x) => [x.mes, x]));
    const v = de(ventas);
    const a = de(abiertas);
    const p = de(perdidas);

    return Array.from({ length: n }, (_, i) => {
      const mes = sumarMeses(primero, i);
      const anterior = sumarMeses(mes, -12);
      const vendido = Number((v.get(mes) as any)?.vendido ?? 0);
      const vendidoAnterior = Number((v.get(anterior) as any)?.vendido ?? 0);
      const ganadas = Number((v.get(mes) as any)?.ganadas ?? 0);
      const perd = Number((p.get(mes) as any)?.perdidas ?? 0);
      return {
        mes,
        abiertas: Number((a.get(mes) as any)?.abiertas ?? 0),
        ganadas,
        perdidas: perd,
        tasaDeCierre: tasaDeFila(ganadas, perd),
        vendido,
        ticketPromedio: ganadas ? Math.round(vendido / ganadas) : null,
        vendidoAnioAnterior: vendidoAnterior,
        variacionAnual: variacion(vendido, vendidoAnterior),
        enCurso: mes === ultimo,
      };
    });
  }

  // ----------------------------------------------------------------- alertas

  async alertas(f: Filtros) {
    const hoy = diaLocal();
    const mes = mesDe(hoy);
    const inicioMes = `${mes}-01`;
    const manana = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return diaLocal(d);
    })();
    // El mismo tramo hace un año: del 1 al mismo día, no el mes entero, o
    // cada mes en curso perdería contra un mes completo.
    const [anio] = hoy.split('-').map(Number);
    const haceUnAnio = (fecha: string) => `${anio - 1}${fecha.slice(4)}`;

    const pSinAbrir: any[] = [];
    const fSinAbrir = this.filtro(f, 'o', pSinAbrir);

    const [meta, vendidoMes, vendidoAnterior, pron, pipe, serie, sinAbrir, aprobaciones] =
      await Promise.all([
        this.metaDelMes(f, hoy),
        this.vendido(f, inicioMes, manana),
        this.vendido(f, haceUnAnio(inicioMes), haceUnAnio(manana)),
        this.pronostico(f, 1),
        this.pipeline(f),
        this.tendencia(f, 13),
        this.dataSource.query(
          `SELECT count(*)::int AS n FROM crm.proforma p JOIN crm.oportunidad o ON o.id = p.oportunidad
            WHERE p.estado = 'enviada' AND p.vista_en IS NULL
              AND p.enviada_en < now() - interval '3 days' ${fSinAbrir}`,
          pSinAbrir,
        ),
        this.proformas.listado({ estado: 'borrador', marca: f.marca, comercial: f.comercial }),
      ]);

    const lista = alertas({
      hoy,
      meta,
      vendidoMes: vendidoMes.total,
      vendidoAnioAnterior: vendidoAnterior.total,
      ponderadoRestante: pron.meses[0]?.ponderado ?? 0,
      abiertas: pipe.abiertas,
      estancadas: pipe.totalEstancadas,
      atrasadas: pron.atrasadas.cuenta,
      proformasSinAbrir: Number(sinAbrir[0]?.n ?? 0),
      aprobacionesPendientes: aprobaciones.filter((p: any) => p.aprobacion.pendiente).length,
      // Los meses cerrados: el en curso es justo el que se compara.
      serieMensual: serie.filter((m) => !m.enCurso).map((m) => m.vendido),
    });

    return {
      hoy,
      meta,
      vendidoMes: vendidoMes.total,
      esperado: pron.mesActual.esperado,
      alertas: lista,
    };
  }

  // ----------------------------------------------------------------- equipos

  equipos() {
    return this.dataSource.query(
      `SELECT usuario,
              coalesce(nullif(trim(first_name || ' ' || coalesce(last_name, '')), ''), usuario) AS nombre,
              supervisor
         FROM crm.comercial
        WHERE NOT disabled
        ORDER BY nombre`,
    );
  }

  /**
   * Pone a alguien bajo un supervisor.
   *
   * Se rechaza lo que cerraría un círculo: si A supervisa a B y B a A, la
   * cadena de firmas de descuentos no tiene cima y nadie puede aprobar nada.
   */
  async ponerSupervisor(usuario: string, supervisor: string | null) {
    if (supervisor) {
      // ¿Está el nuevo supervisor dentro del equipo de quien va a supervisar?
      const ciclo = await this.dataSource.query(
        `SELECT 1 FROM crm.comercial WHERE usuario = $2 AND usuario IN ${sqlEquipo(1)}`,
        [usuario, supervisor],
      );
      if (ciclo.length) {
        throw new BadRequestException(
          `${supervisor} ya depende de ${usuario}: ponerlo de su supervisor cerraría un círculo.`,
        );
      }
    }
    const filas = await this.dataSource.query(
      `UPDATE crm.comercial SET supervisor = $2 WHERE usuario = $1 RETURNING usuario, supervisor`,
      [usuario, supervisor || null],
    );
    if (!filas[0]) throw new NotFoundException(`No existe el comercial ${usuario}.`);
    return filas[0];
  }

  // ---------------------------------------------------------------- reportes

  catalogo() {
    return {
      dimensiones: Object.entries(DIMENSIONES).map(([codigo, nombre]) => ({ codigo, nombre })),
      metricas: Object.entries(METRICAS).map(([codigo, m]) => ({
        codigo,
        nombre: m.nombre,
        formato: m.formato,
      })),
    };
  }

  /**
   * Ejecuta un reporte.
   *
   * Cada métrica es su propia consulta con su propia fecha, y se juntan aquí
   * por la etiqueta de la dimensión. Una sola consulta con todos los `JOIN`
   * multiplicaría filas —una oportunidad con dos proformas contaría dos
   * veces— y obligaría a fechar todo por la misma columna.
   */
  async ejecutar(def: DefinicionDeReporte) {
    const metricas = new Set<Metrica>(def.metricas);
    // La tasa se deriva de ganadas y perdidas: se piden aunque no se enseñen.
    const calcular = new Set<Metrica>(metricas);
    if (metricas.has('tasa_cierre')) {
      calcular.add('ganadas');
      calcular.add('perdidas');
    }
    calcular.delete('tasa_cierre');

    const filas = new Map<string, Record<string, any>>();
    await Promise.all(
      [...calcular].map(async (m) => {
        for (const r of await this.metrica(m, def)) {
          const fila = filas.get(r.etiqueta) ?? { etiqueta: r.etiqueta };
          fila[m] = Number(r.valor ?? 0);
          filas.set(r.etiqueta, fila);
        }
      }),
    );

    let resultado = [...filas.values()].map((f) => {
      const fila: Record<string, any> = { etiqueta: f.etiqueta };
      for (const m of def.metricas) {
        fila[m] =
          m === 'tasa_cierre'
            ? tasaDeFila(Number(f.ganadas ?? 0), Number(f.perdidas ?? 0))
            : Number(f[m] ?? 0);
      }
      return fila;
    });

    const primera = def.metricas[0];
    resultado =
      def.dimension === 'mes'
        ? resultado.sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta)))
        : resultado.sort((a, b) => Number(b[primera] ?? 0) - Number(a[primera] ?? 0));

    const totales: Record<string, any> = { etiqueta: 'Total' };
    for (const m of def.metricas) {
      const formato = METRICAS[m].formato;
      if (m === 'tasa_cierre') {
        const g = [...filas.values()].reduce((s, f) => s + Number(f.ganadas ?? 0), 0);
        const p = [...filas.values()].reduce((s, f) => s + Number(f.perdidas ?? 0), 0);
        totales[m] = tasaDeFila(g, p);
      } else if (m === 'ticket_promedio') {
        // Un promedio no se suma: se rehace con el total.
        const r = await this.metrica('vendido', { ...def, dimension: 'marca' });
        const c = await this.metrica('ganadas', { ...def, dimension: 'marca' });
        const sv = r.reduce((s, x) => s + Number(x.valor ?? 0), 0);
        const sc = c.reduce((s, x) => s + Number(x.valor ?? 0), 0);
        totales[m] = sc ? Math.round((sv / sc) * 100) / 100 : 0;
      } else {
        totales[m] = resultado.reduce((s, f) => s + Number(f[m] ?? 0), 0);
        if (formato === 'dinero') totales[m] = Math.round(totales[m] * 100) / 100;
      }
    }

    return {
      definicion: def,
      columnas: [
        { codigo: 'etiqueta', nombre: DIMENSIONES[def.dimension], formato: 'texto' },
        ...def.metricas.map((m) => ({ codigo: m, nombre: METRICAS[m].nombre, formato: METRICAS[m].formato })),
      ],
      filas: resultado.slice(0, 500),
      totales,
      recortado: resultado.length > 500,
    };
  }

  /**
   * Una métrica agrupada por la dimensión del reporte.
   *
   * Todo lo que se interpola sale de los `switch` de abajo, escritos aquí; lo
   * único que llega de fuera son valores, y van como parámetros.
   */
  private async metrica(m: Metrica, def: DefinicionDeReporte): Promise<{ etiqueta: string; valor: number }[]> {
    const fuente = METRICAS[m].fuente;
    // `x` es la tabla que lleva marca, comercial y producto en cada fuente.
    const x = fuente === 'venta' || fuente === 'cobro' ? 'v' : 'o';
    const fecha =
      fuente === 'venta' ? 'v.ganada_en'
      : fuente === 'cobro' ? 'v.cobrada_en'
      : fuente === 'perdida' ? 'h.ocurrido_en'
      : fuente === 'pipeline' ? 'o.cierre_estimado'
      : 'o.creada_en';

    const { etiqueta, joins } = this.dimension(def.dimension, x, fecha);

    const params: any[] = [];
    const where: string[] = [];
    if (fuente === 'pipeline') {
      // El pipeline es una foto de ahora: el periodo no lo recorta. Lo que sí
      // hace es repartirlo por mes de cierre cuando se agrupa por mes.
      where.push('o.archivada_en IS NULL', 'NOT e.es_ganada', 'NOT e.es_perdida');
    } else {
      if (def.desde && def.hasta) {
        params.push(def.desde, def.hasta);
        where.push(`${fecha} >= $${params.length - 1}`, `${fecha} < $${params.length}`);
      }
      if (x === 'v') where.push('v.anulada_en IS NULL');
      else where.push('o.archivada_en IS NULL');
    }
    if (def.marca) {
      params.push(def.marca);
      where.push(`${x}.marca = $${params.length}`);
    }
    if (def.comercial) {
      params.push(def.comercial);
      where.push(`${x}.comercial = $${params.length}`);
    }
    if (def.equipo) {
      params.push(def.equipo);
      where.push(`${x}.comercial IN ${sqlEquipo(params.length)}`);
    }
    if (def.producto) {
      params.push(def.producto);
      where.push(`${x}.producto = $${params.length}`);
    }

    const valor =
      m === 'abiertas' || m === 'ganadas' ? 'count(*)'
      : m === 'perdidas' ? 'count(DISTINCT h.oportunidad)'
      : m === 'vendido' || m === 'cobrado' ? 'coalesce(sum(v.monto), 0)'
      : m === 'ticket_promedio' ? 'coalesce(avg(v.monto), 0)'
      : m === 'pipeline' ? 'coalesce(sum(o.monto), 0)'
      : m === 'ponderado' ? 'coalesce(sum(o.monto * e.probabilidad / 100.0), 0)'
      : null;
    if (!valor) throw new BadRequestException(`La métrica ${m} no se calcula así.`);

    const desde =
      x === 'v'
        ? `FROM crm.venta v
           LEFT JOIN crm.oportunidad o ON o.id = v.oportunidad
           LEFT JOIN crm.etapa e ON e.codigo = o.etapa
           LEFT JOIN crm.empresa emp ON emp.id = v.company_id`
        : fuente === 'perdida'
          ? `FROM crm.oportunidad_etapa h
             JOIN crm.etapa eh ON eh.codigo = h.hasta AND eh.es_perdida
             JOIN crm.oportunidad o ON o.id = h.oportunidad
             JOIN crm.etapa e ON e.codigo = o.etapa
             LEFT JOIN crm.empresa emp ON emp.id = o.company_id`
          : `FROM crm.oportunidad o
             JOIN crm.etapa e ON e.codigo = o.etapa
             LEFT JOIN crm.empresa emp ON emp.id = o.company_id`;

    if (m === 'cobrado') where.push('v.cobrada_en IS NOT NULL');

    const filas = await this.dataSource.query(
      `SELECT ${etiqueta} AS etiqueta, (${valor})::float8 AS valor
         ${desde}
         ${joins}
        WHERE ${where.length ? where.join(' AND ') : 'true'}
        GROUP BY 1`,
      params,
    );
    return filas.map((f: any) => ({ etiqueta: f.etiqueta ?? '—', valor: Number(f.valor ?? 0) }));
  }

  private dimension(d: Dimension, x: string, fecha: string): { etiqueta: string; joins: string } {
    const nombreDe = (alias: string) =>
      `coalesce(nullif(trim(${alias}.first_name || ' ' || coalesce(${alias}.last_name, '')), ''), ${alias}.usuario)`;
    switch (d) {
      case 'mes':
        return { etiqueta: `coalesce(to_char(${fecha}, 'YYYY-MM'), 'Sin fecha')`, joins: '' };
      case 'producto':
        return {
          etiqueta: `coalesce(pr.nombre, ${x}.producto, 'Sin producto')`,
          joins: `LEFT JOIN producto pr ON pr.codigo = ${x}.producto`,
        };
      case 'marca':
        return {
          etiqueta: `coalesce(m.nombre, 'Sin marca')`,
          joins: `LEFT JOIN crm.marca m ON m.codigo = ${x}.marca`,
        };
      case 'comercial':
        return {
          etiqueta: `coalesce(${nombreDe('c')}, ${x}.comercial, 'Sin asignar')`,
          joins: `LEFT JOIN crm.comercial c ON c.usuario = ${x}.comercial`,
        };
      case 'equipo':
        // El equipo de alguien es el de su supervisor; quien no tiene
        // supervisor encabeza el suyo.
        return {
          etiqueta: `coalesce(${nombreDe('sup')}, ${nombreDe('c')}, 'Sin equipo')`,
          joins: `LEFT JOIN crm.comercial c ON c.usuario = ${x}.comercial
                  LEFT JOIN crm.comercial sup ON sup.usuario = c.supervisor`,
        };
      case 'origen':
        return {
          etiqueta: `coalesce(s.nombre, 'Sin segmento (abierta a mano)')`,
          joins: `LEFT JOIN segmento s ON s.codigo = o.origen_segmento`,
        };
      case 'etapa':
        return { etiqueta: `coalesce(e.nombre, 'Sin oportunidad')`, joins: '' };
      case 'cliente':
        return { etiqueta: `coalesce(emp.name, 'Sin cliente')`, joins: '' };
    }
  }

  /** El reporte como hoja de cálculo, con los formatos puestos. */
  async excel(resultado: Awaited<ReturnType<AnaliticaService['ejecutar']>>, titulo: string) {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'FRIDAY CRM';
    const hoja = libro.addWorksheet('Reporte');
    const def = resultado.definicion;

    hoja.addRow([titulo]).font = { bold: true, size: 13 };
    hoja.addRow([
      def.desde && def.hasta ? `Del ${def.desde} al ${def.hasta} (fin exclusivo)` : 'Pipeline abierto a hoy',
    ]);
    const filtros = [
      def.marca && `marca ${def.marca}`,
      def.comercial && `comercial ${def.comercial}`,
      def.equipo && `equipo de ${def.equipo}`,
      def.producto && `producto ${def.producto}`,
    ].filter(Boolean);
    if (filtros.length) hoja.addRow([`Filtros: ${filtros.join(', ')}`]);
    hoja.addRow([]);

    const cabecera = hoja.addRow(resultado.columnas.map((c) => c.nombre));
    cabecera.font = { bold: true };
    for (const fila of resultado.filas) hoja.addRow(resultado.columnas.map((c) => fila[c.codigo]));
    const total = hoja.addRow(resultado.columnas.map((c) => resultado.totales[c.codigo]));
    total.font = { bold: true };

    resultado.columnas.forEach((c, i) => {
      const col = hoja.getColumn(i + 1);
      col.width = i === 0 ? 36 : 18;
      if (c.formato === 'dinero') col.numFmt = '"$"#,##0.00';
      if (c.formato === 'porcentaje') col.numFmt = '0.0"%"';
    });

    return Buffer.from(await libro.xlsx.writeBuffer());
  }

  reportes() {
    return this.dataSource.query(
      `SELECT id, nombre, definicion, frecuencia, destinatarios, proximo_envio, ultimo_envio,
              ultimo_error, creado_por, creado_en
         FROM crm.reporte ORDER BY nombre`,
    );
  }

  async guardarReporte(datos: Record<string, any>, usuario: string) {
    const nombre = String(datos.nombre ?? '').trim();
    if (!nombre) throw new BadRequestException('Ponle un nombre al reporte.');

    // Un reporte guardado no lleva periodo fijo si se programa: el periodo es
    // el anterior a cada envío.
    const frecuencia: Frecuencia | null =
      datos.frecuencia === 'semanal' || datos.frecuencia === 'mensual' ? datos.frecuencia : null;
    const { definicion, errores } = validarDefinicion(datos.definicion, { exigirPeriodo: false });
    if (!definicion) throw new BadRequestException(errores.join(' '));

    const destinatarios: string[] = (Array.isArray(datos.destinatarios) ? datos.destinatarios : [])
      .map((d: unknown) => String(d).trim())
      .filter(Boolean);
    const malos = destinatarios.filter((d) => !esCorreo(d));
    if (malos.length) throw new BadRequestException(`No parecen correos: ${malos.join(', ')}.`);
    if (frecuencia && destinatarios.length === 0) {
      throw new BadRequestException('Un reporte programado necesita a quién mandárselo.');
    }

    const params = [nombre, JSON.stringify(definicion), frecuencia, destinatarios, usuario];
    const proximo = frecuencia ? this.sqlProximoEnvio('$3') : 'NULL';
    const filas = datos.id
      ? await this.dataSource.query(
          `UPDATE crm.reporte
              SET nombre = $1, definicion = $2::jsonb, frecuencia = $3, destinatarios = $4,
                  proximo_envio = ${proximo}
            WHERE id = $6
           RETURNING *`,
          [...params, Number(datos.id)],
        )
      : await this.dataSource.query(
          `INSERT INTO crm.reporte (nombre, definicion, frecuencia, destinatarios, creado_por, proximo_envio)
           VALUES ($1, $2::jsonb, $3, $4, $5, ${proximo})
           RETURNING *`,
          params,
        );
    if (!filas[0]) throw new NotFoundException(`No existe el reporte ${datos.id}.`);
    return filas[0];
  }

  async borrarReporte(id: number) {
    const filas = await this.dataSource.query(`DELETE FROM crm.reporte WHERE id = $1 RETURNING id`, [id]);
    if (!filas[0]) throw new NotFoundException(`No existe el reporte ${id}.`);
    return { borrado: id };
  }

  /**
   * El siguiente envío: lunes o día 1, a las siete de la mañana en Ecuador.
   *
   * Se calcula en Postgres con la zona explícita y no con la hora del
   * servidor, que en un contenedor está en UTC: el reporte «de las siete»
   * llegaría a las dos de la mañana.
   */
  private sqlProximoEnvio(frecuencia: string): string {
    return `(CASE ${frecuencia}
               WHEN 'semanal' THEN date_trunc('week', now() AT TIME ZONE 'America/Guayaquil') + interval '7 days 7 hours'
               WHEN 'mensual' THEN date_trunc('month', now() AT TIME ZONE 'America/Guayaquil') + interval '1 month 7 hours'
             END) AT TIME ZONE 'America/Guayaquil'`;
  }

  /**
   * Manda un reporte guardado ahora, con el periodo anterior completo.
   *
   * Lo usa el reloj y también el botón «mandar ahora», que es como alguien
   * comprueba que llega antes de esperar al lunes.
   */
  async enviarReporte(reporte: any) {
    const frecuencia: Frecuencia = reporte.frecuencia ?? 'mensual';
    const periodo = periodoAnterior(frecuencia, diaLocal());
    const { definicion, errores } = validarDefinicion({ ...reporte.definicion, ...periodo });
    if (!definicion) throw new BadRequestException(errores.join(' '));

    const resultado = await this.ejecutar(definicion);
    const libro = await this.excel(resultado, reporte.nombre);

    const carpeta = mkdtempSync(join(tmpdir(), 'friday-reporte-'));
    const archivo = join(carpeta, `${nombreDeArchivo(reporte.nombre)}-${periodo.desde}.xlsx`);
    try {
      writeFileSync(archivo, libro);
      for (const para of reporte.destinatarios ?? []) {
        await this.correo.enviar({
          para,
          asunto: `${reporte.nombre} · ${periodo.desde} a ${periodo.hasta}`,
          cuerpo:
            `<p>Adjunto el reporte «${escapar(reporte.nombre)}» del ${periodo.desde} ` +
            `al ${periodo.hasta} (sin incluir ese día).</p>` +
            `<p>${resultado.filas.length} fila(s).</p>`,
          adjuntos: [{ nombre: archivo.split(/[\\/]/).pop()!, ruta: archivo }],
        });
      }
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
    await this.dataSource.query(
      `UPDATE crm.reporte SET ultimo_envio = now(), ultimo_error = NULL WHERE id = $1`,
      [reporte.id],
    );
    return { enviado: true, periodo, filas: resultado.filas.length };
  }

  async enviarAhora(id: number) {
    const filas = await this.dataSource.query(`SELECT * FROM crm.reporte WHERE id = $1`, [id]);
    if (!filas[0]) throw new NotFoundException(`No existe el reporte ${id}.`);
    if (!filas[0].destinatarios?.length) {
      throw new BadRequestException('Este reporte no tiene a quién mandárselo.');
    }
    return this.enviarReporte(filas[0]);
  }

  /**
   * Los que tocan, reservados antes de mandarlos.
   *
   * El `UPDATE … RETURNING` mueve la fecha y devuelve las filas en un solo
   * paso: con dos procesos del back levantados, cada reporte lo reserva uno
   * y no salen dos correos iguales.
   */
  async enviarProgramados() {
    const tocan = await this.dataSource.query(
      `UPDATE crm.reporte SET proximo_envio = ${this.sqlProximoEnvio('frecuencia')}
        WHERE frecuencia IS NOT NULL AND proximo_envio <= now()
       RETURNING *`,
    );
    for (const reporte of tocan) {
      try {
        await this.enviarReporte(reporte);
        this.logger.log(`Reporte «${reporte.nombre}» enviado`);
      } catch (e: any) {
        this.logger.error(`No se pudo mandar el reporte «${reporte.nombre}»`, e);
        await this.dataSource.query(`UPDATE crm.reporte SET ultimo_error = $2 WHERE id = $1`, [
          reporte.id,
          String(e?.message ?? e).slice(0, 500),
        ]);
      }
    }
  }
}

function nombreDeArchivo(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'reporte'
  );
}

function escapar(texto: string): string {
  return String(texto).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
