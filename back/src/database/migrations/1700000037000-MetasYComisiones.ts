import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Metas por comercial y reglas de comisión.
 *
 * Dos tablas pequeñas y una decisión grande: **la comisión se calcula sobre lo
 * cobrado, no sobre lo ganado**. Pagar por una venta que todavía no entró es
 * adelantar dinero contra una factura que puede no cobrarse nunca, y
 * recuperarlo después del sueldo de alguien es una conversación que no se
 * quiere tener. Lo ganado y pendiente de cobro se enseña aparte, porque es lo
 * que el comercial sí quiere ver: su comisión en camino.
 *
 * La meta es mensual y por persona. Por trimestre se mira tarde para corregir;
 * por semana, cualquier mes con una venta grande parece un desastre las otras
 * tres semanas.
 */
export class MetasYComisiones1700000037000 implements MigrationInterface {
  name = 'MetasYComisiones1700000037000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.meta (
        id        bigserial PRIMARY KEY,
        comercial text NOT NULL REFERENCES crm.comercial(usuario) ON DELETE CASCADE,
        anio      smallint NOT NULL,
        mes       smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),

        -- Una meta puede ser de toda la operación o de una marca. Con marca en
        -- nulo es la general: es lo que casi siempre se quiere, y obligar a
        -- repartirla por marca desde el primer día hace que nadie ponga metas.
        marca     text NULL REFERENCES crm.marca(codigo),

        monto     numeric(14,2) NOT NULL CHECK (monto > 0),
        nota      text NULL,
        puesta_por text NOT NULL,
        puesta_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Dos metas para el mismo mes y la misma marca serían dos cifras ciertas
     * a la vez. El índice las impide; `coalesce` sobre la marca es necesario
     * porque en SQL dos nulos no son iguales, así que sin él la meta general
     * se podría poner dos veces.
     */
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_meta_unica
        ON crm.meta (comercial, anio, mes, coalesce(marca, ''))
    `);

    await q.query(`
      CREATE TABLE crm.comision_regla (
        codigo     text PRIMARY KEY,
        nombre     text NOT NULL,

        -- La más específica gana: producto, luego marca, luego la general.
        -- Sin ese orden, una regla general del 5 % y otra de producto del 8 %
        -- son dos respuestas correctas a la misma venta.
        producto   text NULL REFERENCES producto(codigo),
        marca      text NULL REFERENCES crm.marca(codigo),

        porcentaje numeric(5,2) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),

        -- El mínimo de cumplimiento para cobrar comisión, en porcentaje de la
        -- meta. En cero, se cobra desde el primer dólar.
        desde_cumplimiento smallint NOT NULL DEFAULT 0
                           CHECK (desde_cumplimiento BETWEEN 0 AND 200),

        activa     boolean NOT NULL DEFAULT true,
        creada_por text NOT NULL,
        creada_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE UNIQUE INDEX idx_crm_comision_ambito
        ON crm.comision_regla (coalesce(producto, ''), coalesce(marca, ''))
        WHERE activa
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.comision_regla`);
    await q.query(`DROP TABLE IF EXISTS crm.meta`);
  }
}
