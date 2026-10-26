import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guiones de llamada por producto.
 *
 * Es lo que le faltaba a la lista de trabajo. Las primeras llamadas de alguien
 * nuevo son malas no porque no sepa vender, sino porque no sabe **qué decir de
 * este producto a esta empresa**, y lo aprende a costa de los primeros
 * cuarenta números de la lista. Un guion no obliga a leerlo: pone delante lo
 * que a los demás ya les funcionó.
 *
 * Lo que de verdad se guarda aquí son **las objeciones y su respuesta**. La
 * apertura se aprende en tres llamadas; «ya tengo contador» se contesta bien o
 * se pierde la venta, y esa respuesta vive hoy en la cabeza de quien lleva más
 * tiempo.
 *
 * Un guion puede ser de un producto, de un segmento, de los dos o de ninguno.
 * Gana el más específico, igual que en las reglas de comisión: a una empresa
 * recién creada no se le dice lo mismo que a una que acaba de cruzar el umbral
 * de auditoría, aunque se le ofrezca lo mismo.
 */
export class Guiones1700000048000 implements MigrationInterface {
  name = 'Guiones1700000048000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.guion (
        codigo    text PRIMARY KEY,
        nombre    text NOT NULL,

        producto  text NULL REFERENCES producto(codigo) ON DELETE CASCADE,
        segmento  text NULL REFERENCES segmento(codigo) ON DELETE CASCADE,

        apertura  text NULL,
        preguntas jsonb NOT NULL DEFAULT '[]'::jsonb,

        -- [{ objecion, respuesta }]. Va como jsonb y no como tabla aparte
        -- porque se edita siempre entero, en una pantalla, y partirlo en filas
        -- sólo añadiría el problema de llevar la cuenta de cuál es cuál.
        objeciones jsonb NOT NULL DEFAULT '[]'::jsonb,

        cierre    text NULL,
        activo    boolean NOT NULL DEFAULT true,

        creado_por text NOT NULL,
        creado_en  timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Un guion activo por ámbito.
     *
     * Dos guiones para el mismo producto y segmento son dos respuestas a la
     * misma llamada, y cuál sale depende del orden de la consulta. `coalesce`
     * es necesario porque en SQL dos nulos no son iguales: sin él, el guion
     * general se podría crear dos veces.
     */
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_guion_ambito
        ON crm.guion (coalesce(producto, ''), coalesce(segmento, ''))
        WHERE activo
    `);

    await this.sembrar(q);
  }

  /**
   * Un guion de verdad para empezar, no un ejemplo vacío.
   *
   * El de contabilidad a empresas recién creadas, que es la llamada más
   * repetida: la empresa acaba de nacer, todavía no tiene contador fijo y
   * tiene por delante su primera declaración.
   */
  private async sembrar(q: QueryRunner) {
    const producto = await q.query(
      `SELECT codigo FROM producto WHERE codigo LIKE 'contabilidad%' LIMIT 1`,
    );
    const segmento = await q.query(
      `SELECT codigo FROM segmento WHERE codigo LIKE '%recien_creadas%' LIMIT 1`,
    );
    if (!producto[0] || !segmento[0]) return;

    await q.query(
      `INSERT INTO crm.guion
         (codigo, nombre, producto, segmento, apertura, preguntas, objeciones, cierre, creado_por)
       VALUES ('contabilidad_recien_creadas',
               'Contabilidad · empresa recién creada',
               $1, $2,
               $3, $4::jsonb, $5::jsonb, $6, 'migracion')`,
      [
        producto[0].codigo,
        segmento[0].codigo,
        'Buenos días, le llamo de parte de FRIDAY. Vi que constituyeron la compañía hace poco; ' +
          'les llamo porque la primera declaración suele ser la que más dudas genera. ' +
          '¿Ya tienen quién les lleve la contabilidad?',
        JSON.stringify([
          '¿Quién les lleva la contabilidad hoy?',
          '¿Cuántas facturas emiten y reciben al mes, más o menos?',
          '¿Tienen personal en nómina?',
          '¿Ya hicieron la primera declaración?',
        ]),
        JSON.stringify([
          {
            objecion: 'Ya tengo contador',
            respuesta:
              'Perfecto, entonces no le propongo cambiar. ¿Le sirve que le mande una revisión ' +
              'sin costo de la última declaración? Si está todo bien, se queda tranquilo; si no, ' +
              'lo ve a tiempo.',
          },
          {
            objecion: 'Es muy caro',
            respuesta:
              '¿Con qué lo está comparando? Nosotros cotizamos por el trabajo real: le paso el ' +
              'detalle de las horas y de qué incluye, y si el volumen es bajo el precio baja.',
          },
          {
            objecion: 'Todavía no facturamos nada',
            respuesta:
              'Aun sin movimiento hay que declarar, y es justo cuando sale más barato ordenarlo. ' +
              '¿Le mando lo que cuesta el plan mínimo?',
          },
          {
            objecion: 'Mándeme información por correo',
            respuesta:
              'Se la mando hoy mismo. ¿A qué correo? Y para no mandarle un folleto genérico, ' +
              '¿cuántas facturas al mes manejan?',
          },
        ]),
        'Entonces le mando la propuesta hoy y le llamo el jueves para que la veamos juntos. ' +
          '¿Le queda bien a media mañana?',
      ],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.guion`);
  }
}
