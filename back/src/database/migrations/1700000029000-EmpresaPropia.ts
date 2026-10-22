import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El CRM pasa a tener sus propias empresas.
 *
 * Hasta ahora la empresa de una oportunidad **era** un sujeto del padrón
 * ecuatoriano: `(tipo_sujeto, clave)` leído de `perfil_comercial`, de sólo
 * lectura. Para uso interno estaba bien —es la ventaja de FRIDAY, 7,1 millones
 * de empresas ya cargadas y sin teclear— pero cierra dos puertas que el CRM
 * necesita abiertas:
 *
 * - Un cliente que no esté en el padrón no existe: un proveedor extranjero,
 *   una empresa recién creada que aún no publica la Superintendencia, o la
 *   cartera que alguien quiera subir desde un Excel.
 * - El día que el CRM se venda a otra empresa, su cartera no tiene nada que
 *   ver con el padrón de Ecuador.
 *
 * Ahora la empresa es una fila de `crm.empresa`, editable como cualquier otra,
 * **con un enlace opcional al sujeto**. Cuando ese enlace existe, el CRM sigue
 * teniendo lo caro: actividad, ubicación, balances y el estado comercial del
 * gestor. Cuando no, la empresa funciona igual, sólo que sin esos extras.
 *
 * El enlace es opcional y único: dos empresas no pueden apuntar al mismo
 * sujeto, porque entonces habría dos fichas del mismo cliente y cada comercial
 * trabajaría la suya.
 */
export class EmpresaPropia1700000029000 implements MigrationInterface {
  name = 'EmpresaPropia1700000029000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.empresa (
        id             bigserial PRIMARY KEY,
        name           text NOT NULL,
        tax_identifier text NULL,
        sector         text NULL,
        size           smallint NULL,
        revenue        text NULL,
        description    text NULL,
        address        text NULL,
        city           text NULL,
        state_abbr     text NULL,
        zipcode        text NULL,
        country        text NULL,
        phone_number   text NULL,
        website        text NULL,
        linkedin_url   text NULL,
        logo           jsonb NULL,
        sales_id       text NULL REFERENCES crm.comercial(usuario),

        tipo_sujeto    text NULL,
        clave          text NULL,

        created_at     timestamptz NOT NULL DEFAULT now(),
        creado_por     text NULL
      )
    `);
    await q.query(`CREATE INDEX idx_crm_empresa_nombre ON crm.empresa (name)`);
    await q.query(`CREATE INDEX idx_crm_empresa_ruc ON crm.empresa (tax_identifier)`);
    // Un sujeto del padrón, una ficha. Sin esto, dos comerciales acaban
    // trabajando la misma empresa en dos fichas que no se ven entre sí.
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_empresa_sujeto ON crm.empresa (tipo_sujeto, clave)
       WHERE tipo_sujeto IS NOT NULL
    `);

    // ------------------------------------------------ oportunidades y contactos
    await q.query(`ALTER TABLE crm.oportunidad ADD COLUMN company_id bigint NULL REFERENCES crm.empresa(id)`);
    await q.query(`ALTER TABLE crm.contacto ADD COLUMN company_id bigint NULL REFERENCES crm.empresa(id)`);

    // Las que ya existen apuntaban a un sujeto. Se les crea su empresa, con los
    // datos que el perfil ya sabe, y se enlazan.
    await q.query(`
      INSERT INTO crm.empresa (name, tax_identifier, sector, address, city, state_abbr,
                               country, phone_number, website, tipo_sujeto, clave, creado_por)
      SELECT DISTINCT ON (s.tipo_sujeto, s.clave)
             coalesce(p.nombre, s.clave), p.ruc, p.actividad, p.direccion, p.canton,
             p.provincia, 'Ecuador', p.telefono, p.sitio_web, s.tipo_sujeto, s.clave, 'migracion'
        FROM (
          SELECT tipo_sujeto, clave FROM crm.oportunidad
          UNION
          SELECT tipo_sujeto, clave FROM crm.contacto
        ) s
        LEFT JOIN perfil_comercial p
               ON p.tipo_sujeto = s.tipo_sujeto AND p.clave = s.clave
    `);

    await q.query(`
      UPDATE crm.oportunidad o SET company_id = e.id
        FROM crm.empresa e
       WHERE e.tipo_sujeto = o.tipo_sujeto AND e.clave = o.clave
    `);
    await q.query(`
      UPDATE crm.contacto c SET company_id = e.id
        FROM crm.empresa e
       WHERE e.tipo_sujeto = c.tipo_sujeto AND e.clave = c.clave
    `);

    // A partir de aquí el sujeto vive en la empresa y en ningún otro sitio: dos
    // copias del mismo enlace divergen en cuanto alguien cambia una.
    await q.query(`ALTER TABLE crm.oportunidad ALTER COLUMN company_id SET NOT NULL`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_sujeto`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_abierta_unica`);
    await q.query(`ALTER TABLE crm.oportunidad DROP COLUMN tipo_sujeto, DROP COLUMN clave`);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
        ON crm.oportunidad (company_id, producto)
       WHERE archivada_en IS NULL
    `);
    await q.query(`CREATE INDEX idx_crm_oport_empresa ON crm.oportunidad (company_id)`);

    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_contacto_sujeto`);
    await q.query(`ALTER TABLE crm.contacto DROP COLUMN tipo_sujeto, DROP COLUMN clave`);
    await q.query(`CREATE INDEX idx_crm_contacto_empresa ON crm.contacto (company_id)`);

    // La venta conserva su copia del sujeto: es un hecho histórico y tiene que
    // sobrevivir a que alguien edite o borre la ficha de la empresa.
    await q.query(`ALTER TABLE crm.venta ADD COLUMN company_id bigint NULL REFERENCES crm.empresa(id)`);
    await q.query(`
      UPDATE crm.venta v SET company_id = e.id
        FROM crm.empresa e
       WHERE e.tipo_sujeto = v.tipo_sujeto AND e.clave = v.clave
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.venta DROP COLUMN company_id`);

    await q.query(`ALTER TABLE crm.contacto ADD COLUMN tipo_sujeto text, ADD COLUMN clave text`);
    await q.query(`
      UPDATE crm.contacto c SET tipo_sujeto = e.tipo_sujeto, clave = e.clave
        FROM crm.empresa e WHERE e.id = c.company_id
    `);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_contacto_empresa`);
    await q.query(`ALTER TABLE crm.contacto DROP COLUMN company_id`);
    await q.query(`CREATE INDEX idx_crm_contacto_sujeto ON crm.contacto (tipo_sujeto, clave)`);

    await q.query(`ALTER TABLE crm.oportunidad ADD COLUMN tipo_sujeto text, ADD COLUMN clave text`);
    await q.query(`
      UPDATE crm.oportunidad o SET tipo_sujeto = e.tipo_sujeto, clave = e.clave
        FROM crm.empresa e WHERE e.id = o.company_id
    `);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_abierta_unica`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_oport_empresa`);
    await q.query(`ALTER TABLE crm.oportunidad DROP COLUMN company_id`);
    await q.query(`CREATE INDEX idx_crm_oport_sujeto ON crm.oportunidad (tipo_sujeto, clave)`);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
        ON crm.oportunidad (tipo_sujeto, clave, producto)
       WHERE archivada_en IS NULL
    `);

    await q.query(`DROP TABLE crm.empresa`);
  }
}
