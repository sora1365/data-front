import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pauta: las campañas pagadas y lo que se gastó en ellas.
 *
 * La captación ya guarda de dónde viene cada lead (`utm_*`) y la conversión
 * deja la venta atribuida al lead. Faltaba el otro lado de la cuenta: cuánto
 * costó traerlos. Con eso salen el costo por lead, el costo de adquisición y
 * el retorno de cada campaña.
 *
 * Tres decisiones:
 *
 * 1. **La campaña se reconoce por su `utm_campaign`, y es único.** Es la clave
 *    con la que los leads llegan etiquetados y con la que se cruzan al
 *    consultar, no al guardar: un lead que entró antes de dar de alta la
 *    campaña se le atribuye igual. Si dos campañas pudieran compartirlo, el
 *    mismo lead contaría en las dos y el retorno total saldría inflado.
 *
 * 2. **El gasto es una fila por día**, con impresiones y clics. Es la forma en
 *    que lo exportan Meta, Google y TikTok, así que volver a subir el mismo
 *    informe reemplaza los días que trae en vez de sumarlos dos veces.
 *
 * 3. **Los ingresos no se copian aquí.** Se leen de `crm.venta` siguiendo
 *    venta → oportunidad → lead. Copiarlos sería tener que corregirlos cada
 *    vez que se anula una venta.
 */
export class Pauta1700000046000 implements MigrationInterface {
  name = 'Pauta1700000046000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.pauta (
        id           bigserial PRIMARY KEY,
        nombre       text NOT NULL,
        marca        text NOT NULL REFERENCES crm.marca(codigo),
        plataforma   text NOT NULL
                     CHECK (plataforma IN ('meta','google','tiktok','linkedin','otra')),
        producto     text NULL REFERENCES producto(codigo),

        -- Con qué etiquetas llegan sus leads. La campaña es obligatoria y
        -- única; la fuente, opcional, sólo documenta (ver la decisión 1).
        utm_campaign text NOT NULL,
        utm_source   text NULL,

        presupuesto  numeric(14,2) NOT NULL CHECK (presupuesto >= 0),
        desde        date NOT NULL,
        hasta        date NOT NULL,
        CONSTRAINT crm_pauta_periodo CHECK (hasta >= desde),

        activa       boolean NOT NULL DEFAULT true,
        nota         text NULL,
        creada_por   text NOT NULL,
        creada_en    timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Sin distinguir mayúsculas: «Auditoria-Octubre» y «auditoria-octubre»
    // son la misma etiqueta para quien arma el anuncio, y también al cruzar.
    await q.query(`CREATE UNIQUE INDEX idx_crm_pauta_utm ON crm.pauta (lower(utm_campaign))`);

    await q.query(`
      CREATE TABLE crm.pauta_gasto (
        pauta       bigint NOT NULL REFERENCES crm.pauta(id) ON DELETE CASCADE,
        dia         date   NOT NULL,
        gasto       numeric(14,2) NOT NULL CHECK (gasto >= 0),
        impresiones integer NULL CHECK (impresiones >= 0),
        clics       integer NULL CHECK (clics >= 0),
        -- De dónde salió la cifra: tecleada o de un informe subido. Si un día
        -- no cuadra con la plataforma, es lo primero que se pregunta.
        origen      text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','archivo')),
        cargado_por text NOT NULL,
        cargado_en  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (pauta, dia)
      )
    `);

    // El cruce con los leads va por la campaña normalizada; sin índice, cada
    // informe recorre todos los leads.
    await q.query(`CREATE INDEX idx_crm_lead_campania ON crm.lead (lower(origen_campania))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_lead_campania`);
    await q.query(`DROP TABLE IF EXISTS crm.pauta_gasto`);
    await q.query(`DROP TABLE IF EXISTS crm.pauta`);
  }
}
