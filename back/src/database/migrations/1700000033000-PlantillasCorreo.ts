import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plantillas de correo y adjuntos de campaña.
 *
 * El gestor comercial entrega una lista por producto: «a estos hay que
 * ofrecerles auditoría externa». Lo que se les escribe es casi siempre lo
 * mismo, así que la plantilla cuelga del producto y se reutiliza. Escribir el
 * cuerpo entero en cada campaña es cómo acaban circulando cinco versiones del
 * mismo mensaje, cada una con una condición distinta.
 *
 * Los adjuntos van en la campaña y no en la plantilla porque la propuesta, el
 * tarifario o el folleto cambian cada vez aunque el texto no cambie.
 */
export class PlantillasCorreo1700000033000 implements MigrationInterface {
  name = 'PlantillasCorreo1700000033000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.plantilla_correo (
        id        bigserial PRIMARY KEY,
        nombre    text NOT NULL,
        asunto    text NOT NULL,
        cuerpo    text NOT NULL,

        -- De qué producto es. Es lo que permite que, partiendo de la lista que
        -- entrega el gestor, el CRM proponga ya la plantilla correcta.
        producto  text NULL REFERENCES producto(codigo) ON DELETE SET NULL,
        marca     text NULL REFERENCES crm.marca(codigo) ON DELETE SET NULL,

        remitente text NULL,
        activa    boolean NOT NULL DEFAULT true,

        creada_por text NOT NULL,
        creada_en  timestamptz NOT NULL DEFAULT now(),
        actualizada_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_plantilla_correo_producto ON crm.plantilla_correo (producto)`);

    await q.query(`
      CREATE TABLE crm.campania_adjunto (
        id        bigserial PRIMARY KEY,
        campania  bigint NOT NULL REFERENCES crm.campania(id) ON DELETE CASCADE,
        nombre    text NOT NULL,
        ruta      text NOT NULL,
        tipo      text NULL,
        tamano    bigint NOT NULL,
        subido_por text NOT NULL,
        subido_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_campania_adjunto ON crm.campania_adjunto (campania)`);

    // De qué plantilla salió la campaña. Informativo: la campaña guarda su
    // propio asunto y cuerpo, porque editar la plantilla después no puede
    // cambiar lo que ya se envió.
    await q.query(`
      ALTER TABLE crm.campania
        ADD COLUMN plantilla bigint NULL REFERENCES crm.plantilla_correo(id) ON DELETE SET NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.campania DROP COLUMN plantilla`);
    await q.query(`DROP TABLE IF EXISTS crm.campania_adjunto`);
    await q.query(`DROP TABLE IF EXISTS crm.plantilla_correo`);
  }
}
