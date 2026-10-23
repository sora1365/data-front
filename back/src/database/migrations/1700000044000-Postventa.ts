import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Postventa: lo que pasa después de ganar.
 *
 * Es donde se cae casi todo el mundo. Se persigue al cliente durante semanas,
 * se cierra la venta, y el día siguiente nadie vuelve a escribirle hasta que
 * toca renovar —si alguien se acuerda—. Las tres piezas que lo evitan son las
 * mismas que ya existen para vender, usadas al revés:
 *
 * - **Secuencias que arrancan al ganar**, con las tareas del arranque del
 *   servicio. El motor es el mismo que el de prospección; lo único que faltaba
 *   era dejar que una secuencia se aplique a una venta cerrada.
 * - **Una encuesta** con su enlace, como la proforma: el cliente contesta sin
 *   tener cuenta en nada.
 * - **La fecha de renovación en la venta**, para que «se acaba en marzo» no
 *   dependa de que alguien lo recuerde.
 *
 * Lo que **no** hay es un proceso que despierte cada noche. Las renovaciones
 * que tocan se calculan al preguntar, igual que las tareas vencidas: un
 * programador nocturno es una pieza más que se cae en silencio y nadie nota
 * hasta que pasan tres meses sin avisos.
 */
export class Postventa1700000044000 implements MigrationInterface {
  name = 'Postventa1700000044000';

  public async up(q: QueryRunner): Promise<void> {
    /**
     * A qué se aplica una secuencia.
     *
     * `oportunidad` es lo de siempre: perseguir una venta que no se ha
     * cerrado. `venta` es postventa, y arranca al ganar. La distinción hace
     * falta porque `impedimentoParaIniciar` rechaza las oportunidades
     * cerradas, que es justo lo que una secuencia de postventa necesita.
     */
    await q.query(`
      ALTER TABLE crm.secuencia
        ADD COLUMN aplica_a text NOT NULL DEFAULT 'oportunidad'
        CHECK (aplica_a IN ('oportunidad','venta'))
    `);

    /**
     * Cuándo se renueva una venta y de cuál viene.
     *
     * `renovacion_de` encadena las renovaciones: es lo que permite ver que un
     * cliente lleva cuatro años seguidos, que es un dato distinto de cuatro
     * ventas sueltas del mismo producto.
     */
    await q.query(`
      ALTER TABLE crm.venta
        ADD COLUMN periodicidad text NULL
          CHECK (periodicidad IS NULL OR periodicidad IN ('mensual','anual','unica')),
        ADD COLUMN renueva_en date NULL,
        ADD COLUMN renovada_en timestamptz NULL,
        ADD COLUMN renovacion_de bigint NULL REFERENCES crm.venta(id) ON DELETE SET NULL
    `);
    await q.query(`
      CREATE INDEX idx_crm_venta_renovacion ON crm.venta (renueva_en)
       WHERE renueva_en IS NOT NULL AND renovada_en IS NULL
    `);

    /**
     * La encuesta de satisfacción.
     *
     * Una por venta y con su propio enlace, como la proforma. Se guarda
     * también el **comentario**, que es lo único que explica un 6: el número
     * solo dice que algo va mal, no qué.
     */
    await q.query(`
      CREATE TABLE crm.encuesta (
        id        bigserial PRIMARY KEY,
        venta     bigint NOT NULL REFERENCES crm.venta(id) ON DELETE CASCADE,
        token     uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,

        correo    text NULL,
        enviada_en timestamptz NULL,
        vista_en   timestamptz NULL,
        respondida_en timestamptz NULL,

        -- De 0 a 10, como el NPS de toda la vida: es la escala que la gente ya
        -- ha visto y no hay que explicar.
        puntaje   smallint NULL CHECK (puntaje IS NULL OR (puntaje BETWEEN 0 AND 10)),
        comentario text NULL,
        respondida_por text NULL,

        creada_por text NOT NULL,
        creada_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Una encuesta viva por venta.
     *
     * Dos encuestas abiertas de la misma venta son dos enlaces en el buzón del
     * cliente, y la respuesta cuenta en una sola. Las ya respondidas no
     * estorban: la de la renovación del año que viene es otra venta.
     */
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_encuesta_viva
        ON crm.encuesta (venta) WHERE respondida_en IS NULL
    `);
    await q.query(`CREATE INDEX idx_crm_encuesta_respuesta ON crm.encuesta (respondida_en, puntaje)`);

    await this.sembrar(q);
  }

  /**
   * La secuencia de arranque del servicio.
   *
   * Con los días del requerimiento puestos de forma plausible: el día de la
   * venta se agradece y se pide la documentación, a la semana se revisa que
   * todo esté andando, y al mes se pregunta qué tal. Son los números que se
   * corrigen en pantalla en dos minutos.
   */
  private async sembrar(q: QueryRunner) {
    const ganada = await q.query(
      `SELECT codigo FROM crm.etapa WHERE es_ganada ORDER BY orden LIMIT 1`,
    );

    await q.query(
      `INSERT INTO crm.secuencia
         (codigo, nombre, descripcion, etapa_disparo, aplica_a, creada_por)
       VALUES ('postventa',
               'Arranque del servicio',
               'Lo que hay que hacer la primera semana después de vender, para que el cliente no se quede solo.',
               $1, 'venta', 'migracion')`,
      [ganada[0]?.codigo ?? null],
    );

    await q.query(`
      INSERT INTO crm.secuencia_paso (secuencia, orden, dia, canal, texto) VALUES
        ('postventa', 1, 0, 'llamada',  'Agradecer y acordar la fecha de arranque'),
        ('postventa', 2, 1, 'correo',   'Enviar la lista de documentos e información que hace falta'),
        ('postventa', 3, 7, 'llamada',  'Revisar que el servicio esté andando'),
        ('postventa', 4, 30, 'correo',  'Preguntar qué tal el primer mes y mandar la encuesta')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.encuesta`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_venta_renovacion`);
    await q.query(`
      ALTER TABLE crm.venta
        DROP COLUMN IF EXISTS renovacion_de,
        DROP COLUMN IF EXISTS renovada_en,
        DROP COLUMN IF EXISTS renueva_en,
        DROP COLUMN IF EXISTS periodicidad
    `);
    await q.query(`DELETE FROM crm.secuencia WHERE codigo = 'postventa'`);
    await q.query(`ALTER TABLE crm.secuencia DROP COLUMN IF EXISTS aplica_a`);
  }
}
