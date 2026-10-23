import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El índice que impide dos oportunidades del mismo producto sólo mira las
 * abiertas.
 *
 * Existía para evitar que dos comerciales trabajaran lo mismo a la vez, pero
 * contaba también las ganadas y las perdidas, que ya no se trabajan. El efecto
 * aparece en la primera renovación: un cliente al que se le vendió
 * contabilidad hace un año **no puede volver a comprarla**, porque la venta
 * ganada del año pasado sigue ocupando el sitio. Y lo mismo con un cliente que
 * dijo que no en marzo y vuelve en octubre.
 *
 * La alternativa era archivar la oportunidad vieja al renovar, pero archivar
 * es lo que se hace con lo que se abrió por error: una ganada archivada
 * desaparece del embudo y del histórico de ventas, así que renovar borraría la
 * venta del año pasado de los números.
 *
 * **Los códigos de las etapas terminales van escritos en el índice.** Un
 * índice parcial no puede consultar otra tabla, así que no hay forma de
 * preguntarle a `crm.etapa` quién es ganada. Si algún día se añade otra etapa
 * terminal, hay que rehacer este índice; está dicho aquí y en el README del
 * módulo para que no se descubra por accidente.
 */
export class OportunidadAbierta1700000045000 implements MigrationInterface {
  name = 'OportunidadAbierta1700000045000';

  public async up(q: QueryRunner): Promise<void> {
    const terminales = await q.query(
      `SELECT codigo FROM crm.etapa WHERE es_ganada OR es_perdida ORDER BY orden`,
    );
    const codigos = terminales.map((e: any) => `'${e.codigo}'`).join(', ') || `''`;

    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_abierta_unica`);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
        ON crm.oportunidad (company_id, producto)
       WHERE archivada_en IS NULL AND etapa NOT IN (${codigos})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_abierta_unica`);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
        ON crm.oportunidad (company_id, producto)
       WHERE archivada_en IS NULL
    `);
  }
}
