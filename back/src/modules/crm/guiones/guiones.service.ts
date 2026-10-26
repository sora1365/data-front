import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  guionAplicable,
  limpiarObjeciones,
  limpiarPreguntas,
  type Objecion,
} from './guiones.reglas';

export interface DefinicionDeGuion {
  codigo: string;
  nombre: string;
  producto?: string | null;
  segmento?: string | null;
  apertura?: string | null;
  preguntas?: unknown;
  objeciones?: unknown;
  cierre?: string | null;
  activo?: boolean;
}

@Injectable()
export class GuionesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  listar() {
    return this.dataSource.query(
      `SELECT g.*, p.nombre AS producto_nombre, s.nombre AS segmento_nombre
         FROM crm.guion g
         LEFT JOIN producto p ON p.codigo = g.producto
         LEFT JOIN segmento s ON s.codigo = g.segmento
        ORDER BY g.activo DESC, g.nombre`,
    );
  }

  /**
   * El guion que toca para esta llamada.
   *
   * Se traen todos y se elige en TypeScript en vez de resolverlo con un
   * `ORDER BY` a medida: son unas decenas de filas, y la regla de «gana el más
   * específico» se puede probar sin base de datos sólo si vive fuera del SQL.
   */
  async aplicable(producto?: string, segmento?: string) {
    const guiones = await this.dataSource.query(
      `SELECT g.*, p.nombre AS producto_nombre, s.nombre AS segmento_nombre
         FROM crm.guion g
         LEFT JOIN producto p ON p.codigo = g.producto
         LEFT JOIN segmento s ON s.codigo = g.segmento
        WHERE g.activo`,
    );
    return guionAplicable(guiones, { producto: producto ?? null, segmento: segmento ?? null });
  }

  async guardar(def: DefinicionDeGuion, usuario: string) {
    if (!def?.codigo?.trim()) throw new BadRequestException('El guion necesita un código.');
    if (!def?.nombre?.trim()) throw new BadRequestException('El guion necesita un nombre.');

    const objeciones: Objecion[] = limpiarObjeciones(def.objeciones);
    const preguntas = limpiarPreguntas(def.preguntas);

    const filas = await this.dataSource.query(
      `INSERT INTO crm.guion
         (codigo, nombre, producto, segmento, apertura, preguntas, objeciones, cierre, activo, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
       ON CONFLICT (codigo) DO UPDATE SET
         nombre = EXCLUDED.nombre, producto = EXCLUDED.producto,
         segmento = EXCLUDED.segmento, apertura = EXCLUDED.apertura,
         preguntas = EXCLUDED.preguntas, objeciones = EXCLUDED.objeciones,
         cierre = EXCLUDED.cierre, activo = EXCLUDED.activo,
         actualizado_en = now()
       RETURNING *`,
      [
        def.codigo.trim(),
        def.nombre.trim(),
        def.producto || null,
        def.segmento || null,
        def.apertura?.trim() || null,
        JSON.stringify(preguntas),
        JSON.stringify(objeciones),
        def.cierre?.trim() || null,
        def.activo ?? true,
        usuario,
      ],
    );
    return filas[0];
  }

  async obtener(codigo: string) {
    const filas = await this.dataSource.query(`SELECT * FROM crm.guion WHERE codigo = $1`, [
      codigo,
    ]);
    if (!filas[0]) throw new NotFoundException(`No existe el guion «${codigo}»`);
    return filas[0];
  }
}
