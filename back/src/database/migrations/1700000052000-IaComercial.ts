import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IA comercial: resúmenes, calificación de leads y siguiente paso.
 *
 * **La IA propone; una persona firma.** Es la misma regla que el rastreador de
 * presencia y que las secuencias de seguimiento: nada de lo que devuelve el
 * modelo cambia una oportunidad, un lead o un ticket por sí solo. Se guarda
 * como análisis, se enseña al lado de la ficha y, si alguien lo acepta, ese
 * alguien queda firmado (`aplicado_por`).
 *
 * `crm.ia_analisis` es además el registro de lo que hizo la IA, que el módulo 16
 * pide expresamente («auditoría de acciones realizadas por agentes de IA»):
 * quién lo pidió, con qué modelo, cuánto costó en tokens y qué se hizo con
 * ello.
 *
 * - `entrada_hash` resume lo que se le mandó al modelo. Si nada cambió desde el
 *   último análisis, se devuelve ese en lugar de pagar otra llamada por la
 *   misma respuesta: abrir una ficha diez veces no son diez análisis.
 * - `resultado` va en `jsonb` y no en columnas, porque cada tipo de análisis
 *   tiene su forma y la forma va a cambiar según se afinen las preguntas. La
 *   validación de la forma la hace el esquema del back, no la tabla.
 */
export class IaComercial1700000052000 implements MigrationInterface {
  name = 'IaComercial1700000052000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.ia_analisis (
        id          bigserial PRIMARY KEY,
        entidad     text   NOT NULL CHECK (entidad IN ('oportunidad','lead','ticket')),
        entidad_id  bigint NOT NULL,
        resultado   jsonb  NOT NULL,
        entrada_hash text  NOT NULL,

        modelo          text    NOT NULL,
        tokens_entrada  integer NOT NULL DEFAULT 0,
        tokens_salida   integer NOT NULL DEFAULT 0,
        ms              integer NOT NULL DEFAULT 0,

        pedido_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now(),

        -- Qué hizo una persona con la propuesta: 'tarea' (creó la tarea del
        -- siguiente paso), 'temperatura' (aceptó la calificación),
        -- 'borrador' (usó la respuesta sugerida), 'descartado'.
        aplicado      text NULL,
        aplicado_por  text NULL,
        aplicado_en   timestamptz NULL
      )
    `);
    await q.query(
      `CREATE INDEX idx_crm_ia_analisis_entidad ON crm.ia_analisis (entidad, entidad_id, creado_en DESC)`,
    );

    // La temperatura del lead la pone una persona —a mano o aceptando la que
    // propone la IA—, no el modelo. Va aparte de `puntaje`, que mide otra
    // cosa: cuán completo y localizable es el lead, no cuántas ganas tiene de
    // comprar.
    await q.query(`
      ALTER TABLE crm.lead
        ADD COLUMN temperatura text NULL CHECK (temperatura IN ('frio','tibio','caliente'))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.lead DROP COLUMN temperatura`);
    await q.query(`DROP TABLE crm.ia_analisis`);
  }
}
