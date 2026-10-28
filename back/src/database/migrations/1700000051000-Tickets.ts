import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tickets: lo que el cliente pide después de comprar.
 *
 * Hasta aquí una queja llegaba por WhatsApp o por teléfono, alguien decía «lo
 * miro» y quedaba en su cabeza. No había forma de saber cuántas solicitudes
 * había abiertas, cuál llevaba tres días sin respuesta ni qué cliente se
 * quejaba por cuarta vez este mes. El ticket es la unidad que permite
 * contestarlo: quién lo pidió, qué, para cuándo y qué se hizo.
 *
 * - **El cliente es opcional.** Un ticket que entra por el formulario de la web
 *   o por un WhatsApp de un número desconocido no siempre se puede atar a una
 *   empresa del CRM al llegar. Se guarda quién lo pidió (`solicitante_*`) y se
 *   enlaza cuando alguien lo identifica, igual que los leads. Exigirlo haría
 *   que la persona que atiende inventara una empresa para poder anotarlo.
 * - **El SLA se copia al ticket.** Las horas de la política vigente se guardan
 *   en cada ticket al crearlo (y al cambiar la prioridad). Si mañana se aprieta
 *   la política, los tickets de ayer siguen midiéndose con lo que se prometió
 *   ayer; si no, el cumplimiento del mes pasado cambiaría sin que nadie
 *   tocara un ticket.
 * - **Esperar al cliente para el reloj** de la resolución, no el de la
 *   primera respuesta. `pausado_seg` acumula lo esperado y `en_espera_desde`
 *   marca la espera en curso. Sin esto, un ticket que lleva cuatro días
 *   esperando un documento del cliente sale como incumplido por culpa del
 *   cliente, y el indicador deja de servir para lo que sirve.
 * - **Ningún estado `vencido`.** Si se ha incumplido o no se calcula al
 *   preguntar, como las proformas y las renovaciones: un estado guardado
 *   necesitaría un proceso nocturno que lo escribiera.
 */
export class Tickets1700000051000 implements MigrationInterface {
  name = 'Tickets1700000051000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.ticket_sla (
        prioridad        text PRIMARY KEY
                         CHECK (prioridad IN ('urgente','alta','media','baja')),
        horas_respuesta  integer NOT NULL CHECK (horas_respuesta > 0),
        horas_resolucion integer NOT NULL CHECK (horas_resolucion > 0),
        CHECK (horas_resolucion >= horas_respuesta)
      )
    `);
    // Horas de reloj, no laborables: es lo que entiende el cliente cuando se
    // le dice «en 24 horas», y contar horas hábiles pide un calendario de
    // feriados que todavía no existe.
    await q.query(`
      INSERT INTO crm.ticket_sla (prioridad, horas_respuesta, horas_resolucion) VALUES
        ('urgente', 1, 8),
        ('alta', 4, 24),
        ('media', 8, 72),
        ('baja', 24, 168)
    `);

    await q.query(`
      CREATE TABLE crm.ticket (
        id          bigserial PRIMARY KEY,
        asunto      text NOT NULL,
        descripcion text NULL,

        -- Queja y reclamo no son lo mismo: la queja es un descontento, el
        -- reclamo pide algo concreto (devolver, rehacer, compensar). Separarlos
        -- es lo que permite contar cuántas veces hubo que dar algo de vuelta.
        tipo      text NOT NULL DEFAULT 'consulta'
                  CHECK (tipo IN ('consulta','solicitud','incidencia','queja','reclamo')),
        prioridad text NOT NULL DEFAULT 'media'
                  REFERENCES crm.ticket_sla(prioridad),
        estado    text NOT NULL DEFAULT 'abierto'
                  CHECK (estado IN ('abierto','en_curso','esperando_cliente','resuelto','cerrado')),
        canal     text NOT NULL DEFAULT 'manual'
                  CHECK (canal IN ('manual','formulario','whatsapp','correo','telefono')),

        empresa_id      bigint NULL REFERENCES crm.empresa(id) ON DELETE SET NULL,
        contacto_id     bigint NULL REFERENCES crm.contacto(id) ON DELETE SET NULL,
        venta_id        bigint NULL REFERENCES crm.venta(id) ON DELETE SET NULL,
        conversacion_id bigint NULL REFERENCES crm.conversacion(id) ON DELETE SET NULL,

        solicitante_nombre   text NULL,
        solicitante_correo   text NULL,
        solicitante_telefono text NULL,

        responsable text NULL REFERENCES crm.comercial(usuario),

        horas_respuesta  integer NOT NULL,
        horas_resolucion integer NOT NULL,
        pausado_seg      integer NOT NULL DEFAULT 0,
        en_espera_desde  timestamptz NULL,

        primera_respuesta_en timestamptz NULL,
        resuelto_en          timestamptz NULL,
        cerrado_en           timestamptz NULL,
        reabierto            integer NOT NULL DEFAULT 0,

        -- Satisfacción con la atención (CSAT), de 1 a 5. Es otra pregunta que
        -- la del NPS de postventa: aquella es «¿nos recomendarías?», esta es
        -- «¿te resolvimos esto?», y un cliente fiel puede estar furioso con un
        -- ticket concreto.
        csat_token      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        csat_enviada_en timestamptz NULL,
        csat_puntaje    smallint NULL CHECK (csat_puntaje IS NULL OR csat_puntaje BETWEEN 1 AND 5),
        csat_comentario text NULL,
        csat_en         timestamptz NULL,

        creado_por text NOT NULL,
        creado_en  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_ticket_estado ON crm.ticket (estado, creado_en DESC)`);
    await q.query(`CREATE INDEX idx_crm_ticket_empresa ON crm.ticket (empresa_id)`);
    await q.query(`CREATE INDEX idx_crm_ticket_responsable ON crm.ticket (responsable) WHERE estado NOT IN ('resuelto','cerrado')`);

    // El historial del ticket. Una respuesta al cliente y una nota interna
    // van en la misma tabla, distinguidas por `interna`, porque se leen juntas
    // y en orden: separarlas obliga a reconstruir la conversación cruzando
    // dos listas por fecha.
    await q.query(`
      CREATE TABLE crm.ticket_evento (
        id      bigserial PRIMARY KEY,
        ticket  bigint NOT NULL REFERENCES crm.ticket(id) ON DELETE CASCADE,
        tipo    text NOT NULL
                CHECK (tipo IN ('creado','respuesta','nota','estado','asignado','prioridad','cliente','csat')),
        texto   text NULL,
        interna boolean NOT NULL DEFAULT false,
        autor   text NOT NULL,
        en      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_ticket_evento ON crm.ticket_evento (ticket, en)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE crm.ticket_evento`);
    await q.query(`DROP TABLE crm.ticket`);
    await q.query(`DROP TABLE crm.ticket_sla`);
  }
}
