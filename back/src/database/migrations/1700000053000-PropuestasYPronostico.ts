import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Propuestas comerciales completas y la analítica que mira hacia delante.
 *
 * Dos módulos del requerimiento que comparten migración porque se tocan: el
 * pronóstico necesita la probabilidad de cada etapa, y las alertas del tablero
 * cuentan las propuestas sin abrir y los descuentos esperando firma.
 *
 * **Propuestas.** La proforma ya era el documento; le faltaba la negociación:
 * versiones, opciones que elige el cliente, descuentos que alguien tiene que
 * firmar y el rastro de qué pasó con cada una.
 *
 * **Pronóstico y reportes.** El tablero contaba lo que ya pasó. Ahora también
 * lo que viene —el pipeline ponderado por mes de cierre— y los reportes que
 * cada quien arma y se manda por correo.
 */
export class PropuestasYPronostico1700000053000 implements MigrationInterface {
  name = 'PropuestasYPronostico1700000053000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------------ pronóstico

    /**
     * La probabilidad de cerrar desde cada etapa.
     *
     * En la etapa y no en la oportunidad: un porcentaje por tarjeta lo pone
     * cada comercial a ojo, y el pronóstico acaba midiendo el optimismo de
     * cada uno. Junto a esta cifra declarada el tablero enseña la observada
     * —qué parte de lo que pasó por esa etapa se ganó de verdad—, que es la
     * que dice si la declarada está bien puesta.
     */
    await q.query(`
      ALTER TABLE crm.etapa
        ADD COLUMN probabilidad smallint NOT NULL DEFAULT 0
            CHECK (probabilidad BETWEEN 0 AND 100)
    `);
    await q.query(`
      UPDATE crm.etapa SET probabilidad = CASE
        WHEN es_ganada THEN 100
        WHEN es_perdida THEN 0
        WHEN codigo = 'contacto' THEN 10
        WHEN codigo = 'conversando' THEN 25
        WHEN codigo = 'propuesta' THEN 50
        WHEN codigo = 'negociacion' THEN 75
        ELSE 20 END
    `);

    /**
     * El equipo de cada comercial es su supervisor.
     *
     * Una columna y no una tabla de equipos: el requerimiento pide
     * «estructuras jerárquicas», y un árbol de quién responde a quién lo es
     * sin inventar una entidad que alguien tendría que mantener aparte. El
     * tablero por equipo es el de un supervisor y su gente; la aprobación de
     * descuentos sube por la misma cadena.
     */
    await q.query(`
      ALTER TABLE crm.comercial
        ADD COLUMN supervisor text NULL REFERENCES crm.comercial(usuario) ON DELETE SET NULL,
        ADD CONSTRAINT comercial_no_se_supervisa CHECK (supervisor IS DISTINCT FROM usuario)
    `);

    // ------------------------------------------------------------ propuestas

    /**
     * Plantillas: el texto de siempre, puesto una vez.
     *
     * Las condiciones de una propuesta —forma de pago, alcance, plazos— se
     * copiaban a mano de la anterior, y cada copia salía un poco distinta. La
     * plantilla se **copia** a la proforma al crearla y no se enlaza: cambiar
     * la plantilla no debe reescribir lo que ya se mandó.
     */
    await q.query(`
      CREATE TABLE crm.proforma_plantilla (
        codigo      text PRIMARY KEY,
        nombre      text NOT NULL,
        marca       text NULL REFERENCES crm.marca(codigo),
        dias_validez smallint NOT NULL DEFAULT 15 CHECK (dias_validez BETWEEN 1 AND 365),
        notas       text NULL,
        condiciones text NULL,
        condiciones_pago text NULL,
        activa      boolean NOT NULL DEFAULT true,
        actualizada_por text NOT NULL,
        actualizada_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`ALTER TABLE crm.proforma DROP CONSTRAINT proforma_estado_check`);
    await q.query(`
      ALTER TABLE crm.proforma
        ADD CONSTRAINT proforma_estado_check
            CHECK (estado IN ('borrador','enviada','aceptada','rechazada','anulada','reemplazada')),

        -- Versiones: la 2 de P-2026-0007 es P-2026-0007-v2 y apunta a la 1.
        -- Mandar la nueva deja la anterior «reemplazada», y su enlace deja de
        -- aceptar: el cliente no puede quedarse con el precio viejo.
        ADD COLUMN version     smallint NOT NULL DEFAULT 1,
        ADD COLUMN version_de  bigint NULL REFERENCES crm.proforma(id) ON DELETE SET NULL,

        ADD COLUMN plantilla        text NULL REFERENCES crm.proforma_plantilla(codigo) ON DELETE SET NULL,
        ADD COLUMN condiciones_pago text NULL,

        -- El motivo de rechazo, de una lista cerrada (ver proformas.reglas.ts).
        -- \`motivo\` sigue guardando lo que el cliente escribió con sus palabras.
        ADD COLUMN motivo_rechazo text NULL,

        -- El descuento que alguien firmó. Si después se edita la proforma y
        -- el descuento sube por encima, la firma deja de valer sola: lo que se
        -- aprobó fue un número, no un cheque en blanco.
        ADD COLUMN descuento_aprobado_pct numeric(5,2) NULL,
        ADD COLUMN aprobada_por    text NULL,
        ADD COLUMN aprobada_en     timestamptz NULL,
        ADD COLUMN aprobacion_pedida_en timestamptz NULL,

        ADD COLUMN canal_envio text NULL
    `);
    await q.query(`CREATE INDEX idx_crm_proforma_version_de ON crm.proforma (version_de)`);

    /**
     * Líneas opcionales: la propuesta interactiva.
     *
     * Una línea opcional no suma al total ofrecido; el cliente la marca al
     * aceptar, y entonces sí. `incluida` queda en nulo hasta que contesta: es
     * distinto «no la quiso» de «todavía no ha dicho nada».
     */
    await q.query(`
      ALTER TABLE crm.proforma_linea
        ADD COLUMN opcional boolean NOT NULL DEFAULT false,
        ADD COLUMN incluida boolean NULL
    `);

    /**
     * El historial de la negociación.
     *
     * Las columnas de la proforma dicen cómo está; esto dice cómo llegó. Sin
     * él, «¿le subimos el descuento antes o después de que la abriera?» no
     * tiene respuesta.
     */
    await q.query(`
      CREATE TABLE crm.proforma_evento (
        id          bigserial PRIMARY KEY,
        proforma    bigint NOT NULL REFERENCES crm.proforma(id) ON DELETE CASCADE,
        tipo        text NOT NULL,
        detalle     text NULL,
        autor       text NOT NULL,
        ocurrido_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_proforma_evento ON crm.proforma_evento (proforma, ocurrido_en)`);

    /**
     * Hasta qué descuento firma quién.
     *
     * Tabla y no constantes: los topes los decide gerencia y cambian con la
     * temporada. Los niveles sí son fijos —libre, supervisor, dirección—
     * porque cada uno es una regla distinta en el código.
     */
    await q.query(`
      CREATE TABLE crm.descuento_nivel (
        nivel     text PRIMARY KEY CHECK (nivel IN ('libre','supervisor','direccion')),
        hasta_pct numeric(5,2) NOT NULL CHECK (hasta_pct >= 0 AND hasta_pct <= 100),
        actualizado_por text NOT NULL DEFAULT 'sistema',
        actualizado_en  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      INSERT INTO crm.descuento_nivel (nivel, hasta_pct)
      VALUES ('libre', 10), ('supervisor', 25), ('direccion', 100)
    `);

    // -------------------------------------------------------------- reportes

    /**
     * Reportes guardados y su envío programado.
     *
     * La definición es un `jsonb` con dimensión, métricas y filtros, y se
     * valida contra una lista blanca al ejecutarla (ver analitica.reglas.ts):
     * nunca llega SQL del cliente, sólo nombres de cosas que el servidor ya
     * sabe calcular.
     */
    await q.query(`
      CREATE TABLE crm.reporte (
        id          bigserial PRIMARY KEY,
        nombre      text NOT NULL,
        definicion  jsonb NOT NULL,
        frecuencia  text NULL CHECK (frecuencia IN ('semanal','mensual')),
        destinatarios text[] NOT NULL DEFAULT '{}',
        proximo_envio timestamptz NULL,
        ultimo_envio  timestamptz NULL,
        ultimo_error  text NULL,
        creado_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE INDEX idx_crm_reporte_proximo ON crm.reporte (proximo_envio)
       WHERE frecuencia IS NOT NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.reporte`);
    await q.query(`DROP TABLE IF EXISTS crm.descuento_nivel`);
    await q.query(`DROP TABLE IF EXISTS crm.proforma_evento`);
    await q.query(`ALTER TABLE crm.proforma_linea DROP COLUMN IF EXISTS incluida, DROP COLUMN IF EXISTS opcional`);
    await q.query(`UPDATE crm.proforma SET estado = 'anulada' WHERE estado = 'reemplazada'`);
    await q.query(`ALTER TABLE crm.proforma DROP CONSTRAINT proforma_estado_check`);
    await q.query(`
      ALTER TABLE crm.proforma
        DROP COLUMN canal_envio, DROP COLUMN aprobacion_pedida_en, DROP COLUMN aprobada_en,
        DROP COLUMN aprobada_por, DROP COLUMN descuento_aprobado_pct, DROP COLUMN motivo_rechazo,
        DROP COLUMN condiciones_pago, DROP COLUMN plantilla, DROP COLUMN version_de,
        DROP COLUMN version,
        ADD CONSTRAINT proforma_estado_check
            CHECK (estado IN ('borrador','enviada','aceptada','rechazada','anulada'))
    `);
    await q.query(`DROP TABLE IF EXISTS crm.proforma_plantilla`);
    await q.query(`ALTER TABLE crm.comercial DROP CONSTRAINT comercial_no_se_supervisa, DROP COLUMN supervisor`);
    await q.query(`ALTER TABLE crm.etapa DROP COLUMN probabilidad`);
  }
}
