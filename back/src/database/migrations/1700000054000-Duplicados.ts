import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Duplicados de contactos y empresas: detectarlos y fusionarlos.
 *
 * Un cliente partido en dos fichas es un historial partido en dos: la mitad de
 * las llamadas en una, la proforma en la otra, y dos comerciales trabajando la
 * misma empresa sin verse. Entran por todos lados —un lead que no se reconoció,
 * una importación de Excel, alguien que escribió «Cía. Ltda.» y otro «CIA
 * LTDA»—, así que no basta con avisar al crear: hay que poder encontrarlos y
 * juntarlos después.
 *
 * - `crm.fusion` guarda cada fusión con la ficha que desapareció tal como
 *   estaba (`perdedor_datos`) y cuánto se movió de cada tabla. Una fusión
 *   borra una fila; sin esto, «¿de dónde salió este correo?» no tendría
 *   respuesta y una fusión equivocada no se podría reconstruir a mano.
 * - `crm.no_duplicado` recuerda los pares que alguien revisó y dijo que son
 *   distintos. Sin ella, la lista vuelve a proponer cada día a los dos Juan
 *   Pérez que no tienen nada que ver, y la gente deja de mirarla.
 */
export class Duplicados1700000054000 implements MigrationInterface {
  name = 'Duplicados1700000054000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.fusion (
        id             bigserial PRIMARY KEY,
        tipo           text   NOT NULL CHECK (tipo IN ('contacto','empresa')),
        ganador        bigint NOT NULL,
        perdedor       bigint NOT NULL,
        perdedor_datos jsonb  NOT NULL,
        movidos        jsonb  NOT NULL DEFAULT '{}'::jsonb,
        autor          text   NOT NULL,
        en             timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_fusion_ganador ON crm.fusion (tipo, ganador)`);

    // El par se guarda ordenado (menor, mayor) para que «A no es B» y «B no
    // es A» sean la misma fila.
    await q.query(`
      CREATE TABLE crm.no_duplicado (
        tipo  text   NOT NULL CHECK (tipo IN ('contacto','empresa')),
        menor bigint NOT NULL,
        mayor bigint NOT NULL,
        autor text   NOT NULL,
        en    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tipo, menor, mayor),
        CHECK (menor < mayor)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE crm.no_duplicado`);
    await q.query(`DROP TABLE crm.fusion`);
  }
}
