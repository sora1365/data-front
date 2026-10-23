import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resumenDeComercial, type ReglaDeComision } from './comisiones.reglas';

@Injectable()
export class ComisionesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Metas, cumplimiento y comisión de cada comercial en un mes.
   *
   * Entran **todos los comerciales activos**, tengan meta o no y hayan
   * vendido o no. Un cuadro que sólo enseña a quien vendió esconde justo el
   * caso que hay que mirar: el mes que alguien no vendió nada.
   */
  async delMes(anio: number, mes: number) {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta =
      mes === 12
        ? `${anio + 1}-01-01`
        : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;

    const [comerciales, metas, ventas, reglas] = await Promise.all([
      this.dataSource.query(
        `SELECT usuario,
                coalesce(nullif(trim(first_name || ' ' || coalesce(last_name, '')), ''), usuario)
                  AS nombre
           FROM crm.comercial
          WHERE NOT disabled
          ORDER BY nombre`,
      ),
      this.dataSource.query(
        `SELECT comercial, sum(monto)::float8 AS monto
           FROM crm.meta
          WHERE anio = $1 AND mes = $2
          GROUP BY comercial`,
        [anio, mes],
      ),
      /**
       * Las ventas del mes, por la fecha que corresponde a cada estado: lo
       * cobrado se fecha por el cobro y lo pendiente por la fecha en que se
       * ganó. Fechar todo por `ganada_en` metería en enero una venta de
       * diciembre cobrada en enero, que es justo el mes en que se paga.
       */
      this.dataSource.query(
        `SELECT v.comercial, v.producto, v.marca, v.monto::float8 AS monto,
                v.estado
           FROM crm.venta v
          WHERE v.anulada_en IS NULL
            AND (
              (v.estado = 'cobrada' AND v.cobrada_en >= $1 AND v.cobrada_en < $2)
              OR (v.estado <> 'cobrada' AND v.ganada_en >= $1 AND v.ganada_en < $2)
            )`,
        [desde, hasta],
      ),
      this.reglas(),
    ]);

    const metaDe = new Map<string, number>(
      metas.map((m: any) => [String(m.comercial), Number(m.monto)] as [string, number]),
    );

    return comerciales.map((c: any) => {
      const suyas = ventas.filter((v: any) => v.comercial === c.usuario);
      const resumen = resumenDeComercial(
        c.usuario,
        metaDe.get(c.usuario) ?? null,
        suyas.filter((v: any) => v.estado === 'cobrada'),
        suyas.filter((v: any) => v.estado !== 'cobrada'),
        reglas,
      );
      return { ...resumen, nombre: c.nombre };
    });
  }

  reglas(): Promise<ReglaDeComision[]> {
    return this.dataSource.query(
      `SELECT codigo, nombre, producto, marca,
              porcentaje::float8 AS porcentaje, desde_cumplimiento
         FROM crm.comision_regla
        WHERE activa
        ORDER BY producto NULLS LAST, marca NULLS LAST`,
    );
  }

  async metas(anio: number, mes: number) {
    return this.dataSource.query(
      `SELECT m.*, m.monto::float8 AS monto
         FROM crm.meta m
        WHERE m.anio = $1 AND m.mes = $2
        ORDER BY m.comercial`,
      [anio, mes],
    );
  }

  /**
   * Pone o corrige la meta de alguien.
   *
   * Es un `upsert` y no un `insert`: corregir la meta del mes es normal —se
   * reparte entre quien se incorpora, se ajusta al cambiar una cartera— y con
   * un insert a secas la segunda vez fallaría con un error de índice único
   * que no explica nada.
   */
  async ponerMeta(
    datos: { comercial: string; anio: number; mes: number; monto: number; marca?: string; nota?: string },
    usuario: string,
  ) {
    if (!(datos.monto > 0)) throw new BadRequestException('La meta tiene que ser mayor que cero.');
    if (datos.mes < 1 || datos.mes > 12) throw new BadRequestException('Ese mes no existe.');

    await this.dataSource.query(
      `INSERT INTO crm.comercial (usuario, first_name) VALUES ($1,$1)
       ON CONFLICT (usuario) DO NOTHING`,
      [datos.comercial],
    );

    const filas = await this.dataSource.query(
      `INSERT INTO crm.meta (comercial, anio, mes, marca, monto, nota, puesta_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (comercial, anio, mes, coalesce(marca, ''))
       DO UPDATE SET monto = EXCLUDED.monto, nota = EXCLUDED.nota,
                     puesta_por = EXCLUDED.puesta_por, puesta_en = now()
       RETURNING *`,
      [
        datos.comercial,
        datos.anio,
        datos.mes,
        datos.marca ?? null,
        datos.monto,
        datos.nota ?? null,
        usuario,
      ],
    );
    return filas[0];
  }

  async ponerRegla(
    datos: {
      codigo: string;
      nombre: string;
      porcentaje: number;
      producto?: string;
      marca?: string;
      desdeCumplimiento?: number;
      activa?: boolean;
    },
    usuario: string,
  ) {
    if (!(datos.porcentaje >= 0 && datos.porcentaje <= 100)) {
      throw new BadRequestException('El porcentaje va entre 0 y 100.');
    }

    const filas = await this.dataSource.query(
      `INSERT INTO crm.comision_regla
         (codigo, nombre, producto, marca, porcentaje, desde_cumplimiento, activa, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (codigo) DO UPDATE SET
         nombre = EXCLUDED.nombre, producto = EXCLUDED.producto, marca = EXCLUDED.marca,
         porcentaje = EXCLUDED.porcentaje, desde_cumplimiento = EXCLUDED.desde_cumplimiento,
         activa = EXCLUDED.activa
       RETURNING *`,
      [
        datos.codigo,
        datos.nombre,
        datos.producto ?? null,
        datos.marca ?? null,
        datos.porcentaje,
        datos.desdeCumplimiento ?? 0,
        datos.activa ?? true,
        usuario,
      ],
    );
    return filas[0];
  }
}
