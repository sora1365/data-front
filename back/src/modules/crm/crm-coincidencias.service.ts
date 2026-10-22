import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface Coincidencia {
  /** `crm` si ya es una ficha del CRM, `padron` si está en la base de FRIDAY. */
  origen: 'crm' | 'padron';
  id: string;
  name: string;
  tax_identifier: string | null;
  sector: string | null;
  city: string | null;
  tipo_sujeto?: string | null;
  clave?: string | null;
  /** Por qué se parece: lo que se le enseña a la persona. */
  motivo: 'ruc' | 'nombre';
  /** Si ya hay una ficha del CRM enlazada a ese sujeto. */
  ya_enlazada?: boolean;
}

/**
 * Busca si una empresa que alguien está escribiendo ya existe.
 *
 * Mira en dos sitios, y la diferencia importa:
 *
 * - **En el CRM**: ya hay una ficha. Crear otra es partir en dos el historial
 *   de un cliente, y que dos comerciales trabajen la misma empresa sin verse.
 * - **En el padrón**: no hay ficha todavía, pero FRIDAY ya sabe de esa empresa.
 *   Enlazarla ahorra teclear y, sobre todo, le da al CRM la actividad, los
 *   balances y el estado comercial que el gestor ya calculó.
 *
 * Es una propuesta, no una validación: puede haber dos empresas con nombres
 * parecidos y ser distintas de verdad. Bloquear el alta por un parecido deja a
 * alguien sin poder registrar a su cliente, que es peor que un duplicado.
 */
@Injectable()
export class CrmCoincidenciasService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async buscar(nombre?: string, ruc?: string, excluir?: string): Promise<Coincidencia[]> {
    const limpio = (nombre ?? '').trim();
    const rucLimpio = (ruc ?? '').replace(/\D/g, '');

    // Por debajo de tres letras cualquier cosa se parece a todo, y la consulta
    // sobre 7,1 millones de filas no compensa para devolver ruido.
    if (rucLimpio.length < 10 && limpio.length < 3) return [];

    const [enCrm, enPadron] = await Promise.all([
      this.enElCrm(limpio, rucLimpio, excluir),
      this.enElPadron(limpio, rucLimpio),
    ]);

    // Las fichas del CRM van primero: son las que de verdad duplicarían algo.
    return [...enCrm, ...enPadron];
  }

  /**
   * Los tres parámetros van siempre, aunque vengan vacíos.
   *
   * Construirlos sólo cuando hay valor obliga a llevar la cuenta de en qué
   * posición cayó cada uno, y basta con que una condición no se añada para que
   * todos los `$n` de después apunten al parámetro equivocado. Con ellos fijos,
   * la cadena vacía desactiva su condición y no hay aritmética que cuadrar.
   */
  private async enElCrm(nombre: string, ruc: string, excluir?: string) {
    const porRuc = ruc.length >= 10 ? ruc : '';
    const porNombre = nombre.length >= 3 ? `%${nombre}%` : '';
    if (!porRuc && !porNombre) return [];

    const filas = await this.dataSource.query(
      `SELECT e.id::text, e.name, e.tax_identifier, e.sector, e.city,
              e.tipo_sujeto, e.clave,
              CASE WHEN $1 <> '' AND regexp_replace(coalesce(e.tax_identifier, ''), '\\D', '', 'g') = $1
                   THEN 'ruc' ELSE 'nombre' END AS motivo
         FROM crm.empresa e
        WHERE (
                ($1 <> '' AND regexp_replace(coalesce(e.tax_identifier, ''), '\\D', '', 'g') = $1)
             OR ($2 <> '' AND e.name ILIKE $2)
              )
          AND ($3 = '' OR e.id::text <> $3)
        ORDER BY e.name
        LIMIT 5`,
      [porRuc, porNombre, excluir ?? ''],
    );

    return filas.map((f: any) => ({ ...f, origen: 'crm' as const }));
  }

  /**
   * En el padrón sólo se busca por RUC exacto o por nombre que empiece igual.
   *
   * Un `ILIKE '%algo%'` sobre 7,1 millones de filas no usa el índice y tarda
   * segundos; con el prefijo sí lo usa. La diferencia se nota en un formulario
   * que consulta mientras la persona escribe.
   */
  private async enElPadron(nombre: string, ruc: string) {
    const porRuc = ruc.length >= 10 ? ruc : '';
    const porNombre = nombre.length >= 3 ? `${nombre}%` : '';
    if (!porRuc && !porNombre) return [];

    const filas = await this.dataSource.query(
      `SELECT p.tipo_sujeto || ':' || p.clave AS id, p.nombre AS name,
              p.ruc AS tax_identifier, p.actividad AS sector, p.canton AS city,
              p.tipo_sujeto, p.clave,
              CASE WHEN $1 <> '' AND p.ruc = $1 THEN 'ruc' ELSE 'nombre' END AS motivo,
              EXISTS (
                SELECT 1 FROM crm.empresa e
                 WHERE e.tipo_sujeto = p.tipo_sujeto AND e.clave = p.clave
              ) AS ya_enlazada
         FROM perfil_comercial p
        WHERE ($1 <> '' AND p.ruc = $1)
           OR ($2 <> '' AND p.nombre ILIKE $2)
        ORDER BY p.nombre
        LIMIT 5`,
      [porRuc, porNombre],
    );

    return filas.map((f: any) => ({ ...f, origen: 'padron' as const }));
  }
}
