import { MigrationInterface, QueryRunner } from 'typeorm';

/** Las once tablas del CRM, en el orden en que se crearon. */
const TABLAS = [
  'marca',
  'comercial',
  'etapa',
  'etiqueta',
  'lead',
  'contacto',
  'oportunidad',
  'interaccion',
  'nota',
  'tarea',
  'venta',
];

/**
 * El CRM se muda a su propio esquema.
 *
 * Hasta ahora todo vivía en `public`, con el prefijo `crm_` haciendo de
 * separación. Un prefijo no separa nada: no impide que una consulta del gestor
 * comercial lea una tabla del CRM por descuido, no permite dar permisos
 * distintos a cada módulo, y un `\dt` mezcla las once tablas del CRM con las
 * veintitantas del resto.
 *
 * Con un esquema la frontera existe de verdad y se puede sostener con permisos
 * el día que haga falta. Los dos módulos siguen compartiendo base —lo que
 * permite que una venta referencie un producto, y que las empresas del CRM
 * sean el perfil comercial sin copiar nada—, pero cada uno tiene su sitio.
 *
 * El prefijo `crm_` se va con la mudanza: `crm.oportunidad` ya dice de quién
 * es, y `crm.crm_oportunidad` sería tartamudear.
 *
 * Es `ALTER TABLE ... SET SCHEMA`, no copiar y borrar: las filas no se mueven,
 * sólo cambia el catálogo. Las claves foráneas hacia `public` —producto,
 * segmento, import_job— siguen funcionando porque apuntan al objeto y no a su
 * nombre.
 */
export class EsquemaCrm1700000028000 implements MigrationInterface {
  name = 'EsquemaCrm1700000028000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SCHEMA IF NOT EXISTS crm`);

    for (const tabla of TABLAS) {
      await q.query(`ALTER TABLE crm_${tabla} SET SCHEMA crm`);
      await q.query(`ALTER TABLE crm.crm_${tabla} RENAME TO ${tabla}`);
    }

    // Las secuencias de las columnas `bigserial` viajan con su tabla, pero el
    // nombre se queda con el prefijo viejo. Renombrarlas no es cosmético: es
    // lo que hace que un `\d crm.oportunidad` diga la verdad sobre de dónde
    // sale su id.
    const secuencias = await q.query(`
      SELECT sequencename FROM pg_sequences
       WHERE schemaname = 'crm' AND sequencename LIKE 'crm\\_%'
    `);
    for (const { sequencename } of secuencias) {
      const nuevo = String(sequencename).replace(/^crm_/, '');
      await q.query(`ALTER SEQUENCE crm."${sequencename}" RENAME TO "${nuevo}"`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const secuencias = await q.query(`
      SELECT sequencename FROM pg_sequences WHERE schemaname = 'crm'
    `);
    for (const { sequencename } of secuencias) {
      await q.query(`ALTER SEQUENCE crm."${sequencename}" RENAME TO "crm_${sequencename}"`);
    }

    for (const tabla of [...TABLAS].reverse()) {
      await q.query(`ALTER TABLE crm.${tabla} RENAME TO crm_${tabla}`);
      await q.query(`ALTER TABLE crm.crm_${tabla} SET SCHEMA public`);
    }

    await q.query(`DROP SCHEMA IF EXISTS crm`);
  }
}
