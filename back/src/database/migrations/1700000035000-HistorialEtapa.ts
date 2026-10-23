import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Por dónde pasó cada oportunidad.
 *
 * El tablero dice en qué etapa está cada venta **hoy**, y con eso no se puede
 * contestar la pregunta que justifica un embudo: de cien oportunidades
 * abiertas, cuántas llegaron a propuesta y cuántas se quedaron por el camino.
 * Una venta ganada ya no aparece en «propuesta» aunque pasara por ahí, así que
 * el recuento por etapa actual mide el momento, no el recorrido.
 *
 * El movimiento ya se anotaba, pero como frase: `crm.interaccion` guarda «De
 * «contacto» a «propuesta»» con canal `sistema`. Sirve para leerlo, no para
 * contarlo: cualquier medición pasaría por descomponer texto, y bastaría con
 * que alguien cambiara las comillas para que el embudo empezara a mentir sin
 * que nada fallara. Esta tabla guarda los mismos datos como datos.
 *
 * Se mantiene **además** de la interacción y no en su lugar: el historial que
 * se lee en la ficha es uno solo, y sacar de ahí los cambios de etapa dejaría
 * la conversación sin el contexto de cuándo avanzó la venta.
 */
export class HistorialEtapa1700000035000 implements MigrationInterface {
  name = 'HistorialEtapa1700000035000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.oportunidad_etapa (
        id          bigserial PRIMARY KEY,
        oportunidad bigint NOT NULL REFERENCES crm.oportunidad(id) ON DELETE CASCADE,
        desde       text NULL REFERENCES crm.etapa(codigo),
        hasta       text NOT NULL REFERENCES crm.etapa(codigo),
        autor       text NOT NULL,
        ocurrido_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_crm_oportunidad_etapa ON crm.oportunidad_etapa (oportunidad, ocurrido_en)`,
    );
    await q.query(
      `CREATE INDEX idx_crm_oportunidad_etapa_hasta ON crm.oportunidad_etapa (hasta, ocurrido_en)`,
    );

    /**
     * Lo ya ocurrido, rescatado de las frases.
     *
     * Es descomponer texto, justo lo que esta tabla existe para no tener que
     * hacer; se hace una vez y aquí porque el formato lo escribió este mismo
     * repo y porque la alternativa es un embudo que empieza vacío y tarda
     * meses en poder decir algo. Lo que no case con el patrón se queda fuera:
     * perder una fila es mejor que inventarla.
     */
    await q.query(`
      INSERT INTO crm.oportunidad_etapa (oportunidad, desde, hasta, autor, ocurrido_en)
      SELECT i.oportunidad,
             d.codigo,
             h.codigo,
             i.autor,
             i.ocurrido_en
        FROM crm.interaccion i
        JOIN crm.etapa d ON d.codigo = substring(i.texto from 'De «([^»]+)»')
        JOIN crm.etapa h ON h.codigo = substring(i.texto from 'a «([^»]+)»')
       WHERE i.canal = 'sistema'
         AND i.resultado = 'cambio_etapa'
         AND i.oportunidad IS NOT NULL
    `);

    /**
     * Y el primer asiento de cada oportunidad: la etapa en la que nació.
     *
     * Sin él, una oportunidad que nunca se movió no aparece en el embudo, y
     * las que sí se movieron no tienen principio: el primer tramo mediría
     * desde la nada.
     */
    await q.query(`
      INSERT INTO crm.oportunidad_etapa (oportunidad, desde, hasta, autor, ocurrido_en)
      SELECT o.id,
             NULL,
             coalesce(
               (SELECT e.desde FROM crm.oportunidad_etapa e
                 WHERE e.oportunidad = o.id ORDER BY e.ocurrido_en, e.id LIMIT 1),
               o.etapa
             ),
             'importado',
             o.creada_en
        FROM crm.oportunidad o
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.oportunidad_etapa`);
  }
}
