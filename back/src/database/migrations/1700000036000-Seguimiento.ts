import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Secuencias de seguimiento: el plan de lo que se hace después del primer
 * contacto.
 *
 * «Día 1 llamada, día 3 WhatsApp, día 7 correo» es el requerimiento, y hoy eso
 * vive en la cabeza de quien vende. Lo que se pierde no es el primer contacto
 * —ese lo hace todo el mundo— sino el tercero: la empresa que dijo «escríbeme
 * la semana que viene» y nadie volvió a escribir.
 *
 * **Una secuencia genera tareas, no envíos.** Es la decisión que define el
 * módulo. Mandar solo un WhatsApp al tercer día es técnicamente igual de fácil
 * y convierte el CRM en algo que escribe a clientes sin que nadie lea lo que
 * contestaron; aquí entra como tarea con su canal, y la persona decide. Es la
 * misma regla que el rastreador de presencia: lo automático propone y una
 * persona firma.
 *
 * Las tareas generadas caen en la agenda como cualquier otra, que es lo que
 * hace que esto sirva para algo: el seguimiento aparece el martes junto a las
 * visitas del martes, no en una lista aparte que hay que acordarse de abrir.
 */
export class Seguimiento1700000036000 implements MigrationInterface {
  name = 'Seguimiento1700000036000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.secuencia (
        codigo      text PRIMARY KEY,
        nombre      text NOT NULL,
        descripcion text NULL,
        marca       text NULL REFERENCES crm.marca(codigo),
        producto    text NULL REFERENCES producto(codigo),

        -- Cuándo arranca sola. Una secuencia sin disparador existe igual y se
        -- inicia a mano desde la oportunidad: es lo que permite tener un plan
        -- de reactivación que nadie quiere que salte por su cuenta.
        etapa_disparo text NULL REFERENCES crm.etapa(codigo),

        activa      boolean NOT NULL DEFAULT true,
        creada_por  text NOT NULL,
        creada_en   timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE TABLE crm.secuencia_paso (
        id        bigserial PRIMARY KEY,
        secuencia text NOT NULL REFERENCES crm.secuencia(codigo) ON DELETE CASCADE,
        orden     smallint NOT NULL,

        -- Días desde que arranca el seguimiento, no desde el paso anterior.
        -- Contar desde el anterior parece más natural y se desfasa solo: si
        -- alguien hace la llamada del día 1 con tres días de retraso, todo lo
        -- que viene detrás se corre, y el plan de siete días dura diez.
        dia       smallint NOT NULL,

        canal     text NOT NULL,
        texto     text NOT NULL,
        UNIQUE (secuencia, orden),
        CONSTRAINT crm_secuencia_paso_dia CHECK (dia >= 0)
      )
    `);

    /**
     * Un seguimiento: una secuencia aplicada a una oportunidad.
     *
     * El único parcial deja **un seguimiento vivo por oportunidad**, no uno
     * por secuencia. Dos planes a la vez sobre el mismo cliente son dos
     * calendarios de llamadas que no se conocen: le llaman dos veces el mismo
     * día y las dos tareas dicen que toca. También cierra el caso de mover la
     * tarjeta a la etapa de disparo, sacarla y volverla a meter.
     */
    await q.query(`
      CREATE TABLE crm.seguimiento (
        id          bigserial PRIMARY KEY,
        secuencia   text NOT NULL REFERENCES crm.secuencia(codigo),
        oportunidad bigint NOT NULL REFERENCES crm.oportunidad(id) ON DELETE CASCADE,
        estado      text NOT NULL DEFAULT 'vivo'
                    CHECK (estado IN ('vivo','terminado','cortado')),
        motivo_corte text NULL,
        iniciado_por text NOT NULL,
        iniciado_en  timestamptz NOT NULL DEFAULT now(),
        cerrado_en   timestamptz NULL
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_seguimiento_vivo
        ON crm.seguimiento (oportunidad) WHERE estado = 'vivo'
    `);
    await q.query(`CREATE INDEX idx_crm_seguimiento_oportunidad ON crm.seguimiento (oportunidad)`);

    /**
     * De qué seguimiento salió cada tarea.
     *
     * Hace falta para cortar: cuando la venta se gana o se pierde, lo que
     * queda pendiente del plan hay que quitarlo de en medio. Sin esta columna
     * no hay forma de saber qué tareas eran del seguimiento y cuáles las
     * escribió una persona, y seguir persiguiendo a quien ya compró es la
     * manera más rápida de que el equipo deje de confiar en las tareas.
     */
    await q.query(`
      ALTER TABLE crm.tarea
        ADD COLUMN seguimiento bigint NULL REFERENCES crm.seguimiento(id) ON DELETE SET NULL
    `);
    await q.query(
      `CREATE INDEX idx_crm_tarea_seguimiento ON crm.tarea (seguimiento) WHERE seguimiento IS NOT NULL`,
    );

    await this.sembrar(q);
  }

  /**
   * Dos secuencias para empezar, con los días del requerimiento.
   *
   * Se siembran desde la migración y no desde la pantalla por lo mismo que las
   * etapas: un CRM que arranca sin ninguna secuencia obliga a inventarse una
   * antes de poder probar si esto sirve, y casi nadie lo hace.
   */
  private async sembrar(q: QueryRunner) {
    const primeraEtapa = await q.query(
      `SELECT codigo FROM crm.etapa WHERE NOT es_ganada AND NOT es_perdida ORDER BY orden LIMIT 1`,
    );
    const etapa = primeraEtapa[0]?.codigo ?? null;

    await q.query(
      `INSERT INTO crm.secuencia (codigo, nombre, descripcion, etapa_disparo, creada_por)
       VALUES
         ('primer_contacto',
          'Primer contacto',
          'El plan de la primera semana: llamar, insistir por WhatsApp y cerrar por correo.',
          $1,
          'migracion'),
         ('reactivacion',
          'Reactivación',
          'Para volver sobre una propuesta que se quedó sin respuesta. Se inicia a mano.',
          NULL,
          'migracion')`,
      [etapa],
    );

    await q.query(`
      INSERT INTO crm.secuencia_paso (secuencia, orden, dia, canal, texto) VALUES
        ('primer_contacto', 1, 1, 'llamada',  'Llamar y presentar la propuesta'),
        ('primer_contacto', 2, 3, 'whatsapp', 'Escribir por WhatsApp si no contestó la llamada'),
        ('primer_contacto', 3, 7, 'correo',   'Enviar la propuesta por correo y pedir una respuesta'),
        ('reactivacion',    1, 0, 'llamada',  'Llamar para retomar la propuesta'),
        ('reactivacion',    2, 5, 'correo',   'Reenviar la propuesta con una fecha límite'),
        ('reactivacion',    3, 15, 'llamada', 'Última llamada antes de darla por perdida')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_tarea_seguimiento`);
    await q.query(`ALTER TABLE crm.tarea DROP COLUMN IF EXISTS seguimiento`);
    await q.query(`DROP TABLE IF EXISTS crm.seguimiento`);
    await q.query(`DROP TABLE IF EXISTS crm.secuencia_paso`);
    await q.query(`DROP TABLE IF EXISTS crm.secuencia`);
  }
}
