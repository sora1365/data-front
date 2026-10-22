import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Campañas de correo por segmento, y el consentimiento que las condiciona.
 *
 * El consentimiento se guarda **por dirección de correo**, no por sujeto ni por
 * contacto. Es lo único que funciona aquí: un segmento alcanza a decenas de
 * miles de sujetos del padrón que no son contactos del CRM, y la misma persona
 * puede aparecer como contacto de una empresa y como representante de otra. Lo
 * que recibe el mensaje es una dirección, y es la dirección la que se da de
 * baja.
 *
 * Esto no es una formalidad: el uso comercial de datos personales en Ecuador
 * cae bajo la LOPDP, y el README de segmentos ya avisa de que esos segmentos
 * alcanzan a personas físicas. Sin un registro de quién aceptó, cuándo y por
 * qué vía, no hay forma de responder a la primera reclamación.
 */
export class Campanias1700000032000 implements MigrationInterface {
  name = 'Campanias1700000032000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.consentimiento (
        correo      text PRIMARY KEY,
        estado      text NOT NULL DEFAULT 'sin_declarar'
                    CHECK (estado IN ('otorgado','sin_declarar','revocado')),
        origen      text NULL,
        otorgado_en timestamptz NULL,
        revocado_en timestamptz NULL,
        motivo      text NULL,

        -- Con quién se corresponde, si se sabe. Es sólo informativo: la baja
        -- vale por el correo, aunque esa persona cambie de empresa.
        tipo_sujeto text NULL,
        clave       text NULL,

        actualizado_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_consentimiento_estado ON crm.consentimiento (estado)`);

    // ---------------------------------------------------------------- campañas
    await q.query(`
      CREATE TABLE crm.campania (
        id          bigserial PRIMARY KEY,
        nombre      text NOT NULL,
        marca       text NULL REFERENCES crm.marca(codigo),
        segmento    text NULL REFERENCES segmento(codigo),
        producto    text NULL REFERENCES producto(codigo),

        asunto      text NOT NULL,
        cuerpo      text NOT NULL,
        remitente   text NULL,

        estado      text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','preparada','enviando','enviada','cancelada')),

        programada_para timestamptz NULL,
        empezada_en timestamptz NULL,
        terminada_en timestamptz NULL,

        creada_por  text NOT NULL,
        creada_en   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_campania_estado ON crm.campania (estado, creada_en DESC)`);

    /**
     * Un envío por destinatario.
     *
     * Se materializa al preparar la campaña y no al enviarla: así se puede
     * revisar a cuántos va antes de mandar nada, y un envío que se corta a la
     * mitad sabe por dónde iba. Volver a calcular el segmento en mitad del
     * envío daría una lista distinta, porque los segmentos cambian con cada
     * corrida.
     */
    await q.query(`
      CREATE TABLE crm.campania_envio (
        id          bigserial PRIMARY KEY,
        campania    bigint NOT NULL REFERENCES crm.campania(id) ON DELETE CASCADE,
        correo      text NOT NULL,
        nombre      text NULL,
        tipo_sujeto text NULL,
        clave       text NULL,

        estado      text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','enviado','rebotado','fallido','descartado')),
        motivo      text NULL,

        mensaje_id  text NULL,
        enviado_en  timestamptz NULL,
        abierto_en  timestamptz NULL,

        /**
         * El token del enlace de baja.
         *
         * Permite darse de baja sin iniciar sesión, que es como tiene que ser:
         * exigir una cuenta para dejar de recibir correos es, en la práctica,
         * no dejar darse de baja. Es por envío y no por persona para que un
         * enlace filtrado no sirva para dar de baja a cualquiera.
         */
        token       uuid NOT NULL DEFAULT gen_random_uuid()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX idx_crm_envio_token ON crm.campania_envio (token)`);
    // Un correo una vez por campaña: la misma persona puede salir dos veces de
    // un segmento —dos empresas, mismo representante— y recibir el mismo
    // mensaje dos veces es la forma más rápida de que alguien se dé de baja.
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_envio_unico ON crm.campania_envio (campania, correo)
    `);
    await q.query(`CREATE INDEX idx_crm_envio_pendiente ON crm.campania_envio (campania, estado)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.campania_envio`);
    await q.query(`DROP TABLE IF EXISTS crm.campania`);
    await q.query(`DROP TABLE IF EXISTS crm.consentimiento`);
  }
}
