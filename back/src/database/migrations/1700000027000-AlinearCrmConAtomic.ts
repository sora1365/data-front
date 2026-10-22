import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alinea el esquema del CRM con el modelo que esperan sus pantallas.
 *
 * El CRM es Atomic CRM, y sus componentes leen campos concretos: un contacto
 * tiene `first_name` y `last_name`, una oportunidad tiene `name` y
 * `description`, una etiqueta tiene un id numérico. El esquema que se escribió
 * antes de traerlo no los tenía.
 *
 * La alternativa era traducir en el camino —que el API inventara un nombre
 * juntando producto y cliente, o partiera `nombre` por el primer espacio—, y
 * eso se rompe con «María del Carmen» y con cualquier empresa que lleve coma.
 * Es más barato que la tabla guarde lo que la pantalla muestra.
 *
 * Lo que **no** se toca es lo que es de FRIDAY y Atomic no tiene: el sujeto
 * `(tipo_sujeto, clave)`, la venta que recoge el contable, el segmento de
 * origen y la marca. Eso sigue igual.
 *
 * Los nombres de columna nuevos van en inglés, como el resto del código de
 * Atomic, y no en español como el esquema anterior. Traducirlos obligaría a
 * mapear cada campo en el camino, que es justo lo que esta migración evita.
 */
export class AlinearCrmConAtomic1700000027000 implements MigrationInterface {
  name = 'AlinearCrmConAtomic1700000027000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------------- contactos
    // `nombre` pasa a ser el nombre de pila y se añaden los demás campos que
    // la ficha de contacto muestra.
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN nombre TO first_name`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN cargo TO title`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN correos TO email_jsonb`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN telefonos TO phone_jsonb`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN linkedin TO linkedin_url`);
    await q.query(`
      ALTER TABLE crm_contacto
        ADD COLUMN last_name      text NOT NULL DEFAULT '',
        ADD COLUMN gender         text NULL,
        ADD COLUMN status         text NULL,
        ADD COLUMN background     text NULL,
        ADD COLUMN first_seen     timestamptz NULL,
        ADD COLUMN last_seen      timestamptz NULL,
        ADD COLUMN has_newsletter boolean NOT NULL DEFAULT false,
        ADD COLUMN sales_id       text NULL REFERENCES crm_comercial(usuario),
        ADD COLUMN avatar         jsonb NULL
    `);

    // ---------------------------------------------------------- oportunidades
    await q.query(`
      ALTER TABLE crm_oportunidad
        ADD COLUMN name        text NOT NULL DEFAULT '',
        ADD COLUMN description text NULL,
        ADD COLUMN contact_ids bigint[] NOT NULL DEFAULT '{}'
    `);
    // Las que ya existen se quedan con el nombre del producto, que es lo que
    // la tarjeta enseñaba hasta ahora.
    await q.query(`
      UPDATE crm_oportunidad o
         SET name = p.nombre
        FROM producto p
       WHERE p.codigo = o.producto AND o.name = ''
    `);

    // --------------------------------------------------------------- tareas
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN texto TO text`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN tipo TO type`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN vence TO due_date`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN hecha_en TO done_date`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN contacto TO contact_id`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN responsable TO sales_id`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN oportunidad TO deal_id`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN creada_en TO created_at`);

    // ---------------------------------------------------------------- notas
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN texto TO text`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN estado TO status`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN fecha TO date`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN autor TO sales_id`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN contacto TO contact_id`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN oportunidad TO deal_id`);
    await q.query(`ALTER TABLE crm_nota ADD COLUMN attachments jsonb NULL`);

    // ------------------------------------------------------------ etiquetas
    // Atomic guarda las etiquetas de un contacto como un array de ids
    // numéricos (`contacts.tags`). Con el código de texto como clave habría
    // que convertir en los dos sentidos en cada lectura y cada escritura.
    await q.query(`ALTER TABLE crm_contacto_etiqueta DROP CONSTRAINT crm_contacto_etiqueta_etiqueta_fkey`);
    await q.query(`ALTER TABLE crm_etiqueta RENAME COLUMN codigo TO codigo_antiguo`);
    await q.query(`ALTER TABLE crm_etiqueta ADD COLUMN id bigserial`);
    await q.query(`ALTER TABLE crm_etiqueta DROP CONSTRAINT crm_etiqueta_pkey`);
    await q.query(`ALTER TABLE crm_etiqueta ADD PRIMARY KEY (id)`);
    await q.query(`ALTER TABLE crm_etiqueta RENAME COLUMN nombre TO name`);
    // `color` ya se llama igual en los dos modelos.

    // El array vive en el contacto, como en Atomic; la tabla de cruce se va.
    await q.query(`ALTER TABLE crm_contacto ADD COLUMN tags bigint[] NOT NULL DEFAULT '{}'`);
    await q.query(`DROP TABLE crm_contacto_etiqueta`);

    // ----------------------------------------------------------- comerciales
    await q.query(`ALTER TABLE crm_comercial RENAME COLUMN nombre TO first_name`);
    await q.query(`
      ALTER TABLE crm_comercial
        ADD COLUMN last_name     text NOT NULL DEFAULT '',
        ADD COLUMN email         text NOT NULL DEFAULT '',
        ADD COLUMN administrator boolean NOT NULL DEFAULT false,
        ADD COLUMN avatar        jsonb NULL
    `);
    // `activo` y `disabled` dicen lo mismo al revés. Se queda el de Atomic,
    // que es el que leen las pantallas.
    await q.query(`ALTER TABLE crm_comercial ADD COLUMN disabled boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE crm_comercial SET disabled = NOT activo`);
    await q.query(`ALTER TABLE crm_comercial DROP COLUMN activo`);

    // Los índices que seguían a las columnas renombradas.
    await q.query(`DROP INDEX IF EXISTS idx_crm_tarea_pendiente`);
    await q.query(`
      CREATE INDEX idx_crm_tarea_pendiente ON crm_tarea (sales_id, due_date)
       WHERE done_date IS NULL
    `);
    await q.query(`DROP INDEX IF EXISTS idx_crm_nota_oport`);
    await q.query(`CREATE INDEX idx_crm_nota_deal ON crm_nota (deal_id, date DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_crm_nota_deal`);
    await q.query(`DROP INDEX IF EXISTS idx_crm_tarea_pendiente`);

    await q.query(`ALTER TABLE crm_comercial ADD COLUMN activo boolean NOT NULL DEFAULT true`);
    await q.query(`UPDATE crm_comercial SET activo = NOT disabled`);
    await q.query(`
      ALTER TABLE crm_comercial
        DROP COLUMN disabled,
        DROP COLUMN last_name,
        DROP COLUMN email,
        DROP COLUMN administrator,
        DROP COLUMN avatar
    `);
    await q.query(`ALTER TABLE crm_comercial RENAME COLUMN first_name TO nombre`);

    await q.query(`
      CREATE TABLE crm_contacto_etiqueta (
        contacto bigint NOT NULL REFERENCES crm_contacto(id) ON DELETE CASCADE,
        etiqueta text NOT NULL,
        PRIMARY KEY (contacto, etiqueta)
      )
    `);
    await q.query(`ALTER TABLE crm_contacto DROP COLUMN tags`);
    await q.query(`ALTER TABLE crm_etiqueta RENAME COLUMN name TO nombre`);
    await q.query(`ALTER TABLE crm_etiqueta DROP CONSTRAINT crm_etiqueta_pkey`);
    await q.query(`ALTER TABLE crm_etiqueta DROP COLUMN id`);
    await q.query(`ALTER TABLE crm_etiqueta RENAME COLUMN codigo_antiguo TO codigo`);
    await q.query(`ALTER TABLE crm_etiqueta ADD PRIMARY KEY (codigo)`);

    await q.query(`ALTER TABLE crm_nota DROP COLUMN attachments`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN deal_id TO oportunidad`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN contact_id TO contacto`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN sales_id TO autor`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN date TO fecha`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN status TO estado`);
    await q.query(`ALTER TABLE crm_nota RENAME COLUMN text TO texto`);

    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN created_at TO creada_en`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN deal_id TO oportunidad`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN sales_id TO responsable`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN contact_id TO contacto`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN done_date TO hecha_en`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN due_date TO vence`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN type TO tipo`);
    await q.query(`ALTER TABLE crm_tarea RENAME COLUMN text TO texto`);

    await q.query(`
      ALTER TABLE crm_oportunidad
        DROP COLUMN name,
        DROP COLUMN description,
        DROP COLUMN contact_ids
    `);

    await q.query(`
      ALTER TABLE crm_contacto
        DROP COLUMN last_name,
        DROP COLUMN gender,
        DROP COLUMN status,
        DROP COLUMN background,
        DROP COLUMN first_seen,
        DROP COLUMN last_seen,
        DROP COLUMN has_newsletter,
        DROP COLUMN sales_id,
        DROP COLUMN avatar
    `);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN linkedin_url TO linkedin`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN phone_jsonb TO telefonos`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN email_jsonb TO correos`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN title TO cargo`);
    await q.query(`ALTER TABLE crm_contacto RENAME COLUMN first_name TO nombre`);
  }
}
