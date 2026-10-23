import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { costoHoraDeTarea } from '../contable/contable.reglas';
import {
  calcularCotizacion,
  problemasDeConfiguracion,
  valoresConDefecto,
  type TareaDeCotizador,
} from './cotizadores.reglas';

export interface DefinicionDeCotizador {
  codigo: string;
  nombre: string;
  descripcion?: string;
  producto?: string | null;
  costo_hora: number;
  margen: number;
  modo_margen?: 'sobre_costo' | 'sobre_precio';
  iva?: number;
  periodicidad?: 'mensual' | 'unica' | 'anual';
  activo?: boolean;
  variables?: {
    codigo: string;
    nombre: string;
    unidad?: string | null;
    valor_defecto?: number;
  }[];
  tareas?: {
    nombre: string;
    horas_fijas?: number;
    horas_por_unidad?: number;
    variable?: string | null;
    costo_hora?: number | null;
  }[];
}

@Injectable()
export class CotizadoresService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async listar() {
    const cotizadores = await this.dataSource.query(
      `SELECT c.*, c.costo_hora::float8 AS costo_hora, c.margen::float8 AS margen,
              c.iva::float8 AS iva, p.nombre AS producto_nombre
         FROM crm.cotizador c
         LEFT JOIN producto p ON p.codigo = c.producto
        ORDER BY c.activo DESC, c.nombre`,
    );
    return Promise.all(cotizadores.map((c: any) => this.completar(c)));
  }

  async obtener(codigo: string) {
    const filas = await this.dataSource.query(
      `SELECT c.*, c.costo_hora::float8 AS costo_hora, c.margen::float8 AS margen,
              c.iva::float8 AS iva, p.nombre AS producto_nombre
         FROM crm.cotizador c
         LEFT JOIN producto p ON p.codigo = c.producto
        WHERE c.codigo = $1`,
      [codigo],
    );
    if (!filas[0]) throw new NotFoundException(`No existe el cotizador «${codigo}»`);
    return this.completar(filas[0]);
  }

  private async completar(cotizador: any) {
    const [variables, tareas] = await Promise.all([this.variables(cotizador.codigo), this.tareas(cotizador.codigo)]);
    return {
      ...cotizador,
      variables,
      tareas,
      problemas: problemasDeConfiguracion(tareas, variables),
    };
  }

  private variables(codigo: string) {
    return this.dataSource.query(
      `SELECT id, codigo, nombre, unidad, valor_defecto::float8 AS valor_defecto, orden
         FROM crm.cotizador_variable WHERE cotizador = $1 ORDER BY orden, id`,
      [codigo],
    );
  }

  private tareas(codigo: string): Promise<TareaDeCotizador[]> {
    return this.dataSource.query(
      `SELECT id, orden, nombre,
              horas_fijas::float8 AS horas_fijas,
              horas_por_unidad::float8 AS horas_por_unidad,
              variable, costo_hora::float8 AS costo_hora, perfil
         FROM crm.cotizador_tarea WHERE cotizador = $1 ORDER BY orden`,
      [codigo],
    );
  }

  /**
   * Guarda la definición entera de un cotizador.
   *
   * Variables y tareas se reemplazan completas, no se parchean una a una: es
   * una pantalla donde se mueven filas, y mandar altas y bajas por separado
   * obliga a las dos partes a llevar la cuenta de qué fila es cuál.
   */
  async guardar(def: DefinicionDeCotizador, usuario: string) {
    if (!def?.codigo?.trim()) throw new BadRequestException('El cotizador necesita un código.');
    if (!def?.nombre?.trim()) throw new BadRequestException('El cotizador necesita un nombre.');
    if (!(Number(def.costo_hora) >= 0)) {
      throw new BadRequestException('El costo por hora no puede ser negativo.');
    }
    const margen = Number(def.margen ?? 0);
    if (!(margen >= 0 && margen < 100)) {
      throw new BadRequestException('El margen va entre 0 y 99,99.');
    }

    const codigo = def.codigo.trim();

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO crm.cotizador
           (codigo, nombre, descripcion, producto, costo_hora, margen, modo_margen,
            iva, periodicidad, activo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (codigo) DO UPDATE SET
           nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion,
           producto = EXCLUDED.producto, costo_hora = EXCLUDED.costo_hora,
           margen = EXCLUDED.margen, modo_margen = EXCLUDED.modo_margen,
           iva = EXCLUDED.iva, periodicidad = EXCLUDED.periodicidad,
           activo = EXCLUDED.activo`,
        [
          codigo,
          def.nombre.trim(),
          def.descripcion ?? null,
          def.producto || null,
          Number(def.costo_hora),
          margen,
          def.modo_margen ?? 'sobre_costo',
          def.iva ?? 15,
          def.periodicidad ?? 'mensual',
          def.activo ?? true,
          usuario,
        ],
      );

      if (Array.isArray(def.variables)) {
        await manager.query(`DELETE FROM crm.cotizador_variable WHERE cotizador = $1`, [codigo]);
        let orden = 0;
        for (const v of def.variables) {
          if (!v?.codigo?.trim() || !v?.nombre?.trim()) continue;
          orden += 1;
          await manager.query(
            `INSERT INTO crm.cotizador_variable
               (cotizador, codigo, nombre, unidad, valor_defecto, orden)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [codigo, v.codigo.trim(), v.nombre.trim(), v.unidad || null, Number(v.valor_defecto ?? 0), orden],
          );
        }
      }

      if (Array.isArray(def.tareas)) {
        await manager.query(`DELETE FROM crm.cotizador_tarea WHERE cotizador = $1`, [codigo]);
        let orden = 0;
        for (const t of def.tareas) {
          if (!t?.nombre?.trim()) continue;
          orden += 1;
          await manager.query(
            `INSERT INTO crm.cotizador_tarea
               (cotizador, orden, nombre, horas_fijas, horas_por_unidad, variable, costo_hora, perfil)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              codigo,
              orden,
              t.nombre.trim(),
              Number(t.horas_fijas ?? 0),
              Number(t.horas_por_unidad ?? 0),
              t.variable || null,
              t.costo_hora === null || t.costo_hora === undefined || t.costo_hora === ('' as any)
                ? null
                : Number(t.costo_hora),
              (t as any).perfil || null,
            ],
          );
        }
      }
    });

    return this.obtener(codigo);
  }

  /**
   * Calcula sin guardar nada.
   *
   * Es lo que se usa mientras se mueven los números en pantalla: cotizar es
   * probar «¿y si son 300 transacciones?», y guardar cada tanteo llenaría el
   * histórico de cotizaciones que nadie ofreció.
   */
  async calcular(codigo: string, entradas: Record<string, unknown>) {
    const cotizador = await this.obtener(codigo);
    const valores = valoresConDefecto(cotizador.variables, entradas ?? {});

    /**
     * El costo de cada tarea sale de la nómina cuando tiene perfil.
     *
     * Es lo que hace que un cotizador no se quede con el sueldo del año
     * pasado: tecleado a mano, el costo hora envejece y todo lo que se cotiza
     * sale barato sin que nadie lo note. Lo escrito a propósito en la tarea
     * sigue mandando sobre la nómina, porque alguien lo puso sabiendo qué
     * hacía.
     */
    const perfiles = await this.dataSource.query(
      `SELECT perfil, costo_hora::float8 AS costo_hora FROM crm.costo_personal`,
    );
    const porPerfil: Record<string, number> = {};
    for (const p of perfiles) porPerfil[p.perfil] = Number(p.costo_hora);

    const tareas = cotizador.tareas.map((t: any) => {
      const { costo, origen } = costoHoraDeTarea(t, porPerfil, Number(cotizador.costo_hora));
      return { ...t, costo_hora: costo, origen_costo: origen };
    });

    return {
      cotizador: {
        codigo: cotizador.codigo,
        nombre: cotizador.nombre,
        periodicidad: cotizador.periodicidad,
        iva: cotizador.iva,
      },
      valores,
      problemas: cotizador.problemas,
      ...calcularCotizacion(cotizador, tareas, valores),
    };
  }

  /**
   * Guarda la cotización que se va a ofrecer.
   *
   * Se guardan las entradas **y** los resultados, aunque se puedan recalcular:
   * el costo por hora y el margen cambian, y recalcular una cotización del año
   * pasado con los números de hoy daría un precio que nadie ofreció nunca.
   */
  async guardarCotizacion(
    codigo: string,
    entradas: Record<string, unknown>,
    usuario: string,
    oportunidad?: number,
    nota?: string,
  ) {
    const calculo = await this.calcular(codigo, entradas);

    const filas = await this.dataSource.query(
      `INSERT INTO crm.cotizacion
         (cotizador, oportunidad, entradas, detalle, horas, costo, margen, modo_margen,
          precio, periodicidad, nota, creada_por)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        codigo,
        oportunidad ?? null,
        JSON.stringify(calculo.valores),
        JSON.stringify(calculo.detalle),
        calculo.horas,
        calculo.costo,
        calculo.margen,
        calculo.modo_margen,
        calculo.precio,
        calculo.cotizador.periodicidad,
        nota ?? null,
        usuario,
      ],
    );

    return { id: filas[0].id, ...calculo };
  }

  /** Lo que se ha cotizado para una oportunidad, de lo último a lo primero. */
  deOportunidad(oportunidad: number) {
    return this.dataSource.query(
      `SELECT c.id, c.cotizador, c.entradas, c.detalle,
              c.horas::float8 AS horas, c.costo::float8 AS costo,
              c.margen::float8 AS margen, c.modo_margen,
              c.precio::float8 AS precio, c.periodicidad, c.nota,
              c.creada_por, c.creada_en, q.nombre AS cotizador_nombre
         FROM crm.cotizacion c
         JOIN crm.cotizador q ON q.codigo = c.cotizador
        WHERE c.oportunidad = $1
        ORDER BY c.creada_en DESC`,
      [oportunidad],
    );
  }
}
