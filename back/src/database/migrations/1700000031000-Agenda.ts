import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La agenda: calendarios compartidos, no uno por persona.
 *
 * Sigue el modelo de TimeTree, que es lo que se acordó. La diferencia con un
 * calendario personal no es cosmética: aquí el calendario es la unidad que se
 * comparte, se filtra y se apaga. Uno comercial, uno por marca, uno de visitas
 * técnicas; cada quien ve los suyos juntos o por separado.
 *
 * Con un calendario por persona, «¿quién puede atender el martes?» se contesta
 * abriendo siete agendas, y una reunión con tres asistentes se escribe tres
 * veces. Con calendarios compartidos, el evento es uno solo y se ve desde
 * todos los calendarios a los que pertenece.
 *
 * Lo que **no** hace esta migración es sincronizar con Google ni Outlook. Eso
 * llega después y por encima: la agenda propia es la fuente de verdad, y los
 * proveedores externos se conectan por persona. Depender de uno solo deja sin
 * disponibilidad fiable a un equipo con medio mundo en cada sitio.
 */
export class Agenda1700000031000 implements MigrationInterface {
  name = 'Agenda1700000031000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.calendario (
        id          bigserial PRIMARY KEY,
        nombre      text NOT NULL,
        descripcion text NULL,
        color       text NOT NULL DEFAULT '#1e3a5f',
        marca       text NULL REFERENCES crm.marca(codigo),
        activo      boolean NOT NULL DEFAULT true,
        creado_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Quién ve y quién escribe en cada calendario.
     *
     * `puede_editar` separa mirar de tocar: el equipo entero puede ver la
     * agenda comercial, y sólo quien la lleva añade cosas. Sin esa distinción,
     * compartir un calendario obliga a elegir entre que nadie lo vea o que
     * cualquiera lo cambie.
     */
    await q.query(`
      CREATE TABLE crm.calendario_miembro (
        calendario   bigint NOT NULL REFERENCES crm.calendario(id) ON DELETE CASCADE,
        usuario      text NOT NULL REFERENCES crm.comercial(usuario) ON DELETE CASCADE,
        puede_editar boolean NOT NULL DEFAULT true,
        PRIMARY KEY (calendario, usuario)
      )
    `);
    await q.query(`CREATE INDEX idx_crm_calendario_miembro_usuario ON crm.calendario_miembro (usuario)`);

    // ----------------------------------------------------------------- eventos
    await q.query(`
      CREATE TABLE crm.evento (
        id          bigserial PRIMARY KEY,
        calendario  bigint NOT NULL REFERENCES crm.calendario(id) ON DELETE CASCADE,
        titulo      text NOT NULL,
        descripcion text NULL,
        lugar       text NULL,

        inicio      timestamptz NOT NULL,
        fin         timestamptz NOT NULL,
        todo_el_dia boolean NOT NULL DEFAULT false,

        -- Lo que TimeTree llama «evento importante»: destaca sobre el resto.
        importante  boolean NOT NULL DEFAULT false,

        -- De qué va, si va de algo del CRM. Las tres son opcionales: una
        -- reunión interna no tiene cliente.
        empresa_id     bigint NULL REFERENCES crm.empresa(id) ON DELETE SET NULL,
        contacto_id    bigint NULL REFERENCES crm.contacto(id) ON DELETE SET NULL,
        oportunidad_id bigint NULL REFERENCES crm.oportunidad(id) ON DELETE SET NULL,

        -- Qué pasó. El requerimiento pide registrar el resultado de cada
        -- reunión, y sin un sitio donde ponerlo acaba en una nota suelta que
        -- nadie relaciona con la cita.
        resultado   text NULL,
        asistio     boolean NULL,

        creado_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now(),

        -- Una cita que termina antes de empezar no es un caso raro: es un
        -- error de tecleo que, sin esto, se guarda y luego desordena la vista
        -- del día sin que se entienda por qué.
        CONSTRAINT crm_evento_orden CHECK (fin >= inicio)
      )
    `);
    await q.query(`CREATE INDEX idx_crm_evento_rango ON crm.evento (inicio, fin)`);
    await q.query(`CREATE INDEX idx_crm_evento_calendario ON crm.evento (calendario, inicio)`);
    await q.query(`CREATE INDEX idx_crm_evento_empresa ON crm.evento (empresa_id)`);

    /**
     * Quién asiste.
     *
     * Separado del evento porque una reunión tiene varios, y porque es lo que
     * permite contestar «¿quién está libre el martes?» sin abrir agendas una
     * por una. El estado guarda la respuesta a la invitación.
     */
    await q.query(`
      CREATE TABLE crm.evento_participante (
        evento  bigint NOT NULL REFERENCES crm.evento(id) ON DELETE CASCADE,
        usuario text NOT NULL REFERENCES crm.comercial(usuario) ON DELETE CASCADE,
        estado  text NOT NULL DEFAULT 'invitado'
                CHECK (estado IN ('invitado','aceptado','rechazado','tentativo')),
        PRIMARY KEY (evento, usuario)
      )
    `);
    await q.query(`CREATE INDEX idx_crm_participante_usuario ON crm.evento_participante (usuario)`);

    // Archivos del evento: la propuesta que se va a presentar, el acta de la
    // reunión anterior. TimeTree los lleva y aquí hacen falta por lo mismo.
    await q.query(`
      CREATE TABLE crm.evento_adjunto (
        id        bigserial PRIMARY KEY,
        evento    bigint NOT NULL REFERENCES crm.evento(id) ON DELETE CASCADE,
        nombre    text NOT NULL,
        ruta      text NOT NULL,
        tipo      text NULL,
        tamano    bigint NULL,
        subido_por text NOT NULL,
        subido_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_evento_adjunto ON crm.evento_adjunto (evento)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.evento_adjunto`);
    await q.query(`DROP TABLE IF EXISTS crm.evento_participante`);
    await q.query(`DROP TABLE IF EXISTS crm.evento`);
    await q.query(`DROP TABLE IF EXISTS crm.calendario_miembro`);
    await q.query(`DROP TABLE IF EXISTS crm.calendario`);
  }
}
