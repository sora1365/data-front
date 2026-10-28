import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { sqlEquipo } from './analitica.service';
import { conResto, embudo, tasaDeCierre } from './tableros.reglas';

export interface Periodo {
  desde: string;
  hasta: string;
  marca?: string;
  comercial?: string;
  /** Un supervisor: él y todos los que cuelgan de él. */
  equipo?: string;
}

/**
 * Los números del CRM.
 *
 * Todo se mide sobre un periodo y sobre **cuándo ocurrió cada cosa**, no sobre
 * el estado de hoy: «cuánto se vendió en septiembre» no se contesta mirando
 * qué oportunidades están ganadas ahora, porque eso cambia cada vez que
 * alguien mueve una tarjeta vieja.
 *
 * El embudo se calcula sobre las oportunidades **abiertas en el periodo**, no
 * sobre los movimientos del periodo. Contar movimientos mezcla recorridos: una
 * venta de hace un año que se cierra hoy sumaría en «propuesta» de este mes sin
 * haber entrado nunca por arriba, y la conversión saldría por encima del 100 %.
 */
@Injectable()
export class TablerosService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resumen(periodo: Periodo) {
    const [etapas, pasos, cierres, aperturas, ventas] = await Promise.all([
      this.etapas(),
      this.pasosDeLasAbiertasEn(periodo),
      this.cierres(periodo),
      this.aperturas(periodo),
      this.ventasDe(periodo),
    ]);

    return {
      periodo,
      embudo: embudo(etapas, pasos),
      abiertas: aperturas.total,
      ganadas: cierres.ganadas,
      perdidas: cierres.perdidas,
      tasaDeCierre: tasaDeCierre(cierres.ganadas, cierres.perdidas),
      diasHastaGanar: cierres.diasHastaGanar,
      vendido: ventas.total,
      ventas: ventas.cuenta,
      // Sobre las ventas del periodo y no sobre las oportunidades ganadas: es
      // lo que se facturó, y una venta anulada no es un ticket.
      ticketPromedio: ventas.cuenta ? Math.round((ventas.total / ventas.cuenta) * 100) / 100 : null,
      porProducto: conResto(await this.porProducto(periodo)),
      porMarca: conResto(await this.porMarca(periodo)),
      porOrigen: conResto(await this.porOrigen(periodo)),
      porComercial: conResto(await this.porComercial(periodo)),
    };
  }

  private etapas() {
    return this.dataSource.query(
      `SELECT codigo, nombre, orden, es_ganada, es_perdida FROM crm.etapa ORDER BY orden`,
    );
  }

  /** Dónde estuvo cada oportunidad abierta en el periodo, toda su vida. */
  private pasosDeLasAbiertasEn(p: Periodo) {
    const { where, params } = this.filtro(p, 'o.creada_en');
    return this.dataSource.query(
      `SELECT h.oportunidad, h.hasta, h.ocurrido_en
         FROM crm.oportunidad_etapa h
         JOIN crm.oportunidad o ON o.id = h.oportunidad
        WHERE ${where}
        ORDER BY h.ocurrido_en`,
      params,
    );
  }

  private async aperturas(p: Periodo) {
    const { where, params } = this.filtro(p, 'o.creada_en');
    const filas = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM crm.oportunidad o WHERE ${where}`,
      params,
    );
    return filas[0] ?? { total: 0 };
  }

  /**
   * Lo cerrado en el periodo, por la fecha en que se cerró.
   *
   * Una ganada se fecha por su asiento en el historial y no por
   * `actualizada_en`: esa columna se mueve cada vez que alguien corrige el
   * importe, y con ella la venta cambiaría de mes al editarla.
   */
  private async cierres(p: Periodo) {
    const { where, params } = this.filtro(p, 'h.ocurrido_en');
    const filas = await this.dataSource.query(
      // Oportunidades distintas y no asientos: una tarjeta que sale de
      // «ganada» y vuelve a entrar deja dos asientos, y contando filas el
      // tablero enseñaba más ganadas que ventas.
      `SELECT
         count(DISTINCT h.oportunidad) FILTER (WHERE e.es_ganada)::int AS ganadas,
         count(DISTINCT h.oportunidad) FILTER (WHERE e.es_perdida)::int AS perdidas,
         avg(extract(epoch FROM h.ocurrido_en - o.creada_en) / 86400)
           FILTER (WHERE e.es_ganada) AS dias
         FROM crm.oportunidad_etapa h
         JOIN crm.oportunidad o ON o.id = h.oportunidad
         JOIN crm.etapa e ON e.codigo = h.hasta
        WHERE (e.es_ganada OR e.es_perdida) AND ${where}`,
      params,
    );
    const fila = filas[0] ?? {};
    return {
      ganadas: fila.ganadas ?? 0,
      perdidas: fila.perdidas ?? 0,
      diasHastaGanar: fila.dias == null ? null : Math.round(Number(fila.dias)),
    };
  }

  private async ventasDe(p: Periodo) {
    const params: any[] = [p.desde, p.hasta];
    let extra = '';
    if (p.marca) {
      params.push(p.marca);
      extra += ` AND v.marca = $${params.length}`;
    }
    if (p.comercial) {
      params.push(p.comercial);
      extra += ` AND v.comercial = $${params.length}`;
    }
    if (p.equipo) {
      params.push(p.equipo);
      extra += ` AND v.comercial IN ${sqlEquipo(params.length)}`;
    }
    const filas = await this.dataSource.query(
      `SELECT coalesce(sum(v.monto), 0)::float8 AS total, count(*)::int AS cuenta
         FROM crm.venta v
        WHERE v.ganada_en >= $1 AND v.ganada_en < $2 AND v.anulada_en IS NULL ${extra}`,
      params,
    );
    return filas[0] ?? { total: 0, cuenta: 0 };
  }

  private porProducto(p: Periodo) {
    return this.desglose(p, 'pr.nombre', 'JOIN producto pr ON pr.codigo = o.producto');
  }

  private porMarca(p: Periodo) {
    return this.desglose(p, 'm.nombre', 'JOIN crm.marca m ON m.codigo = o.marca');
  }

  /**
   * De dónde salió la oportunidad.
   *
   * Es la pregunta que el gestor comercial no podía contestar: qué segmento
   * convierte. Lo abierto a mano no tiene origen y se agrupa como tal, en vez
   * de desaparecer del desglose y descuadrar los totales.
   */
  private porOrigen(p: Periodo) {
    return this.desglose(
      p,
      `coalesce(s.nombre, 'Sin segmento (abierta a mano)')`,
      'LEFT JOIN segmento s ON s.codigo = o.origen_segmento',
    );
  }

  private porComercial(p: Periodo) {
    return this.desglose(
      p,
      `coalesce(nullif(trim(c.first_name || ' ' || coalesce(c.last_name, '')), ''), o.comercial)`,
      'LEFT JOIN crm.comercial c ON c.usuario = o.comercial',
    );
  }

  /**
   * El desglose de siempre, con la etiqueta cambiada.
   *
   * Las cuatro tablas de abajo son la misma consulta: cuántas se abrieron,
   * cuántas se ganaron y cuánto suman, agrupado por algo. Escribirlas cuatro
   * veces las desincroniza en cuanto se corrige un detalle en una.
   *
   * `etiqueta` y el `JOIN` son SQL fijo escrito aquí, nunca algo que llegue
   * del cliente: el periodo y los filtros van como parámetros.
   */
  private desglose(p: Periodo, etiqueta: string, join: string) {
    const { where, params } = this.filtro(p, 'o.creada_en');
    return this.dataSource.query(
      `SELECT ${etiqueta} AS etiqueta,
              count(*)::int AS cuenta,
              count(*) FILTER (WHERE e.es_ganada)::int AS ganadas,
              coalesce(sum(o.monto) FILTER (WHERE e.es_ganada), 0)::float8 AS monto
         FROM crm.oportunidad o
         ${join}
         JOIN crm.etapa e ON e.codigo = o.etapa
        WHERE ${where}
        GROUP BY 1
        ORDER BY monto DESC, cuenta DESC`,
      params,
    );
  }

  /** El periodo y los filtros comunes, siempre como parámetros. */
  private filtro(p: Periodo, columnaFecha: string) {
    const params: any[] = [p.desde, p.hasta];
    const partes = [`${columnaFecha} >= $1`, `${columnaFecha} < $2`];
    if (p.marca) {
      params.push(p.marca);
      partes.push(`o.marca = $${params.length}`);
    }
    if (p.comercial) {
      params.push(p.comercial);
      partes.push(`o.comercial = $${params.length}`);
    }
    if (p.equipo) {
      params.push(p.equipo);
      partes.push(`o.comercial IN ${sqlEquipo(params.length)}`);
    }
    // Las archivadas se quedan fuera: se archiva lo que se abrió por error o
    // por duplicado, y contarlo hundiría la conversión con ventas que nunca
    // existieron.
    partes.push('o.archivada_en IS NULL');
    return { where: partes.join(' AND '), params };
  }
}
