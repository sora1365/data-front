import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las listas de trabajo: lo que se intentó con cada sujeto y cuándo volver.
 *
 * El gestor comercial sabe a quién llamar —convierte 7,1 millones de sujetos
 * en segmentos— y el CRM sabe qué pasó después de la llamada. Entre los dos
 * faltaba justo lo de en medio: **la memoria del intento**. Sin ella, la
 * lista de un segmento sale igual todos los días, y todos los días se llama a
 * los veinte primeros mientras el resto no se toca nunca.
 *
 * Una gestión no es una interacción. `crm.interaccion` cuelga de una
 * oportunidad o de un contacto, y aquí el caso normal es el contrario: llamé a
 * una empresa que todavía no es nada en el CRM y no contestó. Crear una
 * oportunidad para poder anotar eso llenaría el tablero de tarjetas que nadie
 * abrió, y el embudo diría que se trabajaron ventas que no existieron.
 *
 * `reintentar_en` es lo que hace que la lista tenga sentido mañana: quien no
 * contesta vuelve en dos días, a quien no le interesa se le pregunta en seis
 * meses, y quien pide que no lo llamen no vuelve nunca.
 */
export class Gestiones1700000047000 implements MigrationInterface {
  name = 'Gestiones1700000047000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.gestion (
        id          bigserial PRIMARY KEY,

        tipo_sujeto text NOT NULL,
        clave       text NOT NULL,

        -- De qué lista salió y qué se le iba a ofrecer. Sin esto no se puede
        -- contestar qué segmento convierte, que es media razón de tener
        -- segmentos.
        segmento    text NULL REFERENCES segmento(codigo) ON DELETE SET NULL,
        producto    text NULL REFERENCES producto(codigo) ON DELETE SET NULL,

        resultado   text NOT NULL,
        canal       text NULL,
        nota        text NULL,

        -- Cuándo vuelve a la lista. Nulo significa nunca.
        reintentar_en date NULL,

        /**
         * La oportunidad que salió de aquí, si salió alguna.
         *
         * Es el enlace que permite medir el embudo desde antes del embudo: de
         * cien llamadas de un segmento, cuántas acabaron en tarjeta.
         */
        oportunidad bigint NULL REFERENCES crm.oportunidad(id) ON DELETE SET NULL,

        autor       text NOT NULL,
        ocurrido_en timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`CREATE INDEX idx_crm_gestion_sujeto ON crm.gestion (tipo_sujeto, clave, ocurrido_en DESC)`);
    await q.query(`CREATE INDEX idx_crm_gestion_segmento ON crm.gestion (segmento, ocurrido_en)`);

    /**
     * Cuándo vuelve cada sujeto a estar disponible.
     *
     * Se guarda aparte del histórico porque son dos preguntas distintas: el
     * histórico dice qué se intentó y esto dice qué toca hoy. Calcularlo del
     * histórico en cada consulta obligaría a recorrer todas las gestiones de
     * cada uno de los miles de miembros de un segmento sólo para pintar una
     * lista.
     */
    await q.query(`
      CREATE TABLE crm.gestion_estado (
        tipo_sujeto text NOT NULL,
        clave       text NOT NULL,
        ultima_en   timestamptz NOT NULL,
        ultimo_resultado text NOT NULL,
        reintentar_en date NULL,
        intentos    smallint NOT NULL DEFAULT 1,
        PRIMARY KEY (tipo_sujeto, clave)
      )
    `);
    await q.query(`CREATE INDEX idx_crm_gestion_estado_vuelta ON crm.gestion_estado (reintentar_en)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.gestion_estado`);
    await q.query(`DROP TABLE IF EXISTS crm.gestion`);
  }
}
