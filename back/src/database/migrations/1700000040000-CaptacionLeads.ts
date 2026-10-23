import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Captación de leads: formularios públicos y la bandeja que los recibe.
 *
 * `crm.lead` existe desde la primera migración del CRM, con `recibido_en` y
 * `primera_respuesta_en` puestos a propósito, pero nada lo llenaba. Esto le da
 * por dónde entrar y lo que hace falta para trabajarlo:
 *
 * 1. **El formulario es una fila, no una pantalla.** Cada uno tiene su `slug`
 *    público, sus campos, la marca a la que pertenece y a quién se reparten
 *    los leads que entran por él. Un formulario nuevo para una feria o una
 *    landing es un alta, no un despliegue.
 *
 * 2. **El origen se guarda al entrar.** Fuente, medio, campaña, contenido y
 *    término (los `utm_*`), la página desde la que se envió y el canal. Es lo
 *    único que permite atribuir una venta a una campaña, y no se reconstruye
 *    después.
 *
 * 3. **Correo y teléfono se guardan también normalizados.** Es la clave con la
 *    que se detecta que quien escribe ya está en la bandeja: `0991234567` y
 *    `+593 99 123 4567` son la misma persona y, sin normalizar, dos leads que
 *    dos comerciales llaman por separado.
 *
 * 4. **Las visitas se cuentan por día, sin datos de quién.** Sólo así hay una
 *    tasa de abandono —cuántos abrieron el formulario y no lo enviaron— sin
 *    guardar nada de quien no llegó a dar sus datos.
 */
export class CaptacionLeads1700000040000 implements MigrationInterface {
  name = 'CaptacionLeads1700000040000';

  public async up(q: QueryRunner): Promise<void> {
    // -------------------------------------------------------------- formularios
    await q.query(`
      CREATE TABLE crm.formulario (
        id          bigserial PRIMARY KEY,
        slug        text NOT NULL UNIQUE
                    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
        nombre      text NOT NULL,
        marca       text NOT NULL REFERENCES crm.marca(codigo),
        -- Lo que se ofrece en ese formulario. Es lo que propone la conversión
        -- a oportunidad, que exige producto.
        producto    text NULL REFERENCES producto(codigo),

        titulo      text NULL,
        descripcion text NULL,
        -- La lista de campos: clave, etiqueta, tipo, si es obligatorio, sus
        -- opciones y, si es condicional, de qué otro campo depende. Es jsonb y
        -- no una tabla porque se edita y se pinta siempre entera.
        campos      jsonb NOT NULL DEFAULT '[]'::jsonb,
        texto_consentimiento text NOT NULL,
        mensaje_gracias text NULL,
        redirigir_a text NULL,

        -- Entre quiénes se reparten los leads que entran. Vacío: quedan sin
        -- asignar, en la bandeja de todos.
        reparto     text[] NOT NULL DEFAULT '{}',

        activo      boolean NOT NULL DEFAULT true,
        creado_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE TABLE crm.formulario_vista (
        formulario bigint NOT NULL REFERENCES crm.formulario(id) ON DELETE CASCADE,
        dia        date   NOT NULL,
        vistas     integer NOT NULL DEFAULT 0,
        PRIMARY KEY (formulario, dia)
      )
    `);

    // ------------------------------------------------------------------- leads
    await q.query(`
      ALTER TABLE crm.lead
        ADD COLUMN formulario_id   bigint NULL REFERENCES crm.formulario(id) ON DELETE SET NULL,
        ADD COLUMN asignado_a      text   NULL REFERENCES crm.comercial(usuario),
        ADD COLUMN asignado_en     timestamptz NULL,
        ADD COLUMN empresa_nombre  text   NULL,
        ADD COLUMN ruc             text   NULL,
        ADD COLUMN mensaje         text   NULL,
        ADD COLUMN correo_norm     text   NULL,
        ADD COLUMN telefono_norm   text   NULL,
        ADD COLUMN datos           jsonb  NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN origen_fuente   text   NULL,
        ADD COLUMN origen_medio    text   NULL,
        ADD COLUMN origen_contenido text  NULL,
        ADD COLUMN origen_termino  text   NULL,
        ADD COLUMN pagina          text   NULL,
        ADD COLUMN consentimiento  boolean NOT NULL DEFAULT false,
        ADD COLUMN puntaje         smallint NOT NULL DEFAULT 0,
        ADD COLUMN envios          integer NOT NULL DEFAULT 1,
        ADD COLUMN ultimo_envio_en timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN contacto_id     bigint NULL REFERENCES crm.contacto(id) ON DELETE SET NULL,
        ADD COLUMN empresa_id      bigint NULL REFERENCES crm.empresa(id) ON DELETE SET NULL,
        ADD COLUMN oportunidad_id  bigint NULL REFERENCES crm.oportunidad(id) ON DELETE SET NULL,
        ADD COLUMN motivo_descarte text   NULL,
        ADD COLUMN actualizado_en  timestamptz NOT NULL DEFAULT now()
    `);

    // El estado era texto libre con 'nuevo' por defecto. Se cierra la lista:
    // con texto libre, «calificado» y «Calificado» serían dos columnas del
    // embudo y la tasa de conversión dejaría de cuadrar.
    await q.query(`
      ALTER TABLE crm.lead ADD CONSTRAINT crm_lead_estado_valido
        CHECK (estado IN ('nuevo','contactado','calificado','convertido','descartado'))
    `);

    // La búsqueda de duplicados se hace sólo entre los leads vivos: uno ya
    // convertido o descartado no se reabre porque la misma persona vuelva a
    // escribir meses después.
    await q.query(`
      CREATE INDEX idx_crm_lead_correo_vivo ON crm.lead (correo_norm)
       WHERE correo_norm IS NOT NULL AND estado NOT IN ('convertido','descartado')
    `);
    await q.query(`
      CREATE INDEX idx_crm_lead_telefono_vivo ON crm.lead (telefono_norm)
       WHERE telefono_norm IS NOT NULL AND estado NOT IN ('convertido','descartado')
    `);
    await q.query(`CREATE INDEX idx_crm_lead_asignado ON crm.lead (asignado_a, estado)`);
    await q.query(`CREATE INDEX idx_crm_lead_formulario ON crm.lead (formulario_id, recibido_en DESC)`);

    // El índice por teléfono crudo de la primera migración queda sustituido
    // por el normalizado, que es el único con el que se compara.
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_telefono`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX idx_crm_lead_telefono ON crm.lead (telefono)`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_formulario`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_asignado`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_telefono_vivo`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_correo_vivo`);
    await q.query(`ALTER TABLE crm.lead DROP CONSTRAINT IF EXISTS crm_lead_estado_valido`);
    await q.query(`
      ALTER TABLE crm.lead
        DROP COLUMN formulario_id, DROP COLUMN asignado_a, DROP COLUMN asignado_en,
        DROP COLUMN empresa_nombre, DROP COLUMN ruc, DROP COLUMN mensaje,
        DROP COLUMN correo_norm, DROP COLUMN telefono_norm, DROP COLUMN datos,
        DROP COLUMN origen_fuente, DROP COLUMN origen_medio, DROP COLUMN origen_contenido,
        DROP COLUMN origen_termino, DROP COLUMN pagina, DROP COLUMN consentimiento,
        DROP COLUMN puntaje, DROP COLUMN envios, DROP COLUMN ultimo_envio_en,
        DROP COLUMN contacto_id, DROP COLUMN empresa_id, DROP COLUMN oportunidad_id,
        DROP COLUMN motivo_descarte, DROP COLUMN actualizado_en
    `);
    await q.query(`DROP TABLE IF EXISTS crm.formulario_vista`);
    await q.query(`DROP TABLE IF EXISTS crm.formulario`);
  }
}
