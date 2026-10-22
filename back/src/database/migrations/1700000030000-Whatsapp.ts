import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp: números, conversaciones, mensajes y plantillas.
 *
 * Cuatro decisiones que vienen de cómo funciona la plataforma de Meta, no de
 * cómo nos gustaría que funcionara:
 *
 * 1. **Varios números.** Una empresa puede tener uno por marca o por unidad, y
 *    el requerimiento lo pide explícitamente. Por eso el número es una fila y
 *    no una variable de entorno.
 *
 * 2. **El id de Meta es la clave de la idempotencia.** Los webhooks se
 *    reintentan: el mismo mensaje llega dos o tres veces, y sin un único sobre
 *    `wa_id` la conversación muestra duplicados que nadie escribió dos veces.
 *
 * 3. **La ventana de 24 horas.** Fuera de ella Meta sólo acepta plantillas
 *    aprobadas. `ultima_entrante_en` es lo que permite saber si la ventana
 *    sigue abierta sin preguntárselo a Meta en cada envío.
 *
 * 4. **El estado de un mensaje cambia después de enviarlo** —enviado,
 *    entregado, leído, fallido— y llega por webhook. Por eso es una columna
 *    que se actualiza y no un hecho inmutable.
 */
export class Whatsapp1700000030000 implements MigrationInterface {
  name = 'Whatsapp1700000030000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------- números conectados
    await q.query(`
      CREATE TABLE crm.canal_whatsapp (
        id              bigserial PRIMARY KEY,
        nombre          text NOT NULL,
        numero          text NOT NULL,
        phone_number_id text NOT NULL UNIQUE,
        waba_id         text NOT NULL,
        marca           text NULL REFERENCES crm.marca(codigo),
        activo          boolean NOT NULL DEFAULT true,
        creado_en       timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ---------------------------------------------------------- conversaciones
    await q.query(`
      CREATE TABLE crm.conversacion (
        id          bigserial PRIMARY KEY,
        canal_id    bigint NOT NULL REFERENCES crm.canal_whatsapp(id),
        telefono    text NOT NULL,
        nombre_perfil text NULL,

        -- A quién corresponde, si se sabe. Puede no saberse: un número que
        -- escribe por primera vez no es nadie todavía.
        contacto_id bigint NULL REFERENCES crm.contacto(id) ON DELETE SET NULL,
        empresa_id  bigint NULL REFERENCES crm.empresa(id) ON DELETE SET NULL,
        lead_id     bigint NULL REFERENCES crm.lead(id) ON DELETE SET NULL,

        estado      text NOT NULL DEFAULT 'abierta'
                    CHECK (estado IN ('abierta','cerrada')),
        asignada_a  text NULL REFERENCES crm.comercial(usuario),

        -- Cuándo escribió el cliente por última vez. Es lo que abre la ventana
        -- de 24 horas en la que se puede responder con texto libre.
        ultima_entrante_en timestamptz NULL,
        ultimo_mensaje_en  timestamptz NULL,
        sin_leer    integer NOT NULL DEFAULT 0,

        creada_en   timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Una conversación por número de teléfono y canal: si hubiera dos, los
    // mensajes del mismo cliente se repartirían entre ellas y cada agente
    // vería media conversación.
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_conversacion_unica
        ON crm.conversacion (canal_id, telefono)
    `);
    await q.query(`
      CREATE INDEX idx_crm_conversacion_bandeja
        ON crm.conversacion (estado, ultimo_mensaje_en DESC)
    `);
    await q.query(`CREATE INDEX idx_crm_conversacion_contacto ON crm.conversacion (contacto_id)`);

    // ----------------------------------------------------------------- mensajes
    await q.query(`
      CREATE TABLE crm.mensaje (
        id             bigserial PRIMARY KEY,
        conversacion_id bigint NOT NULL REFERENCES crm.conversacion(id) ON DELETE CASCADE,
        direccion      text NOT NULL CHECK (direccion IN ('entrante','saliente')),
        tipo           text NOT NULL DEFAULT 'texto',
        texto          text NULL,
        media          jsonb NULL,
        plantilla      text NULL,

        -- El identificador que da Meta. Único cuando existe: es lo que hace
        -- idempotente el webhook, que se reintenta.
        wa_id          text NULL,

        estado         text NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente','enviado','entregado','leido','fallido')),
        error          text NULL,

        enviado_por    text NULL,
        ocurrido_en    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_mensaje_wa ON crm.mensaje (wa_id)
       WHERE wa_id IS NOT NULL
    `);
    await q.query(`
      CREATE INDEX idx_crm_mensaje_conversacion
        ON crm.mensaje (conversacion_id, ocurrido_en)
    `);

    // --------------------------------------------------------------- plantillas
    // Las plantillas las aprueba Meta, no nosotros: esta tabla es el reflejo
    // local de lo que allí existe, para poder elegirlas sin consultar su API
    // en cada pantalla.
    await q.query(`
      CREATE TABLE crm.plantilla_whatsapp (
        id         bigserial PRIMARY KEY,
        waba_id    text NOT NULL,
        nombre     text NOT NULL,
        idioma     text NOT NULL DEFAULT 'es',
        categoria  text NULL,
        estado     text NOT NULL DEFAULT 'pendiente',
        cuerpo     text NOT NULL,
        variables  smallint NOT NULL DEFAULT 0,
        producto   text NULL REFERENCES producto(codigo),
        sincronizada_en timestamptz NULL
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_plantilla_unica
        ON crm.plantilla_whatsapp (waba_id, nombre, idioma)
    `);

    // La interacción del historial apunta al mensaje que la originó, para que
    // la ficha pueda enseñar «se le escribió esto» sin duplicar el texto.
    await q.query(`ALTER TABLE crm.interaccion ADD COLUMN mensaje_id bigint NULL REFERENCES crm.mensaje(id) ON DELETE SET NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.interaccion DROP COLUMN mensaje_id`);
    await q.query(`DROP TABLE IF EXISTS crm.plantilla_whatsapp`);
    await q.query(`DROP TABLE IF EXISTS crm.mensaje`);
    await q.query(`DROP TABLE IF EXISTS crm.conversacion`);
    await q.query(`DROP TABLE IF EXISTS crm.canal_whatsapp`);
  }
}
