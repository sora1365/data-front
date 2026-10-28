import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de exportaciones completas del CRM.
 *
 * Criterio de aceptación 12 de `Requerimientos CRM.pdf`: «exportar la
 * información de forma completa y verificable», y el «historial de
 * exportaciones y descargas» del módulo 16.
 *
 * Una exportación completa es todo el CRM en un archivo, y un archivo así se
 * puede llevar a cualquier sitio: por eso queda anotado quién la sacó, cuándo y
 * qué llevaba. `manifiesto` es el mismo que va dentro del ZIP, con la huella
 * de cada tabla; `sha256` es la del ZIP entero. Con las dos se puede saber, de
 * un archivo que aparece meses después, si salió de aquí y si alguien lo tocó.
 */
export class Exportaciones1700000055000 implements MigrationInterface {
  name = 'Exportaciones1700000055000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.exportacion (
        id         bigserial PRIMARY KEY,
        por        text    NOT NULL,
        en         timestamptz NOT NULL DEFAULT now(),
        tablas     integer NOT NULL,
        filas      bigint  NOT NULL,
        bytes      bigint  NOT NULL,
        sha256     text    NOT NULL,
        manifiesto jsonb   NOT NULL
      )
    `);
    await q.query(`CREATE INDEX idx_crm_exportacion_sha ON crm.exportacion (sha256)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE crm.exportacion`);
  }
}
