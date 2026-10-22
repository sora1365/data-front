import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CRM comercial.
 *
 * El gestor comercial (`perfil_comercial`, `segmento`, `producto`) responde a
 * quién llamar. Esto guarda **qué pasó después de la llamada**: con quién se
 * habló, qué se le ofreció, por cuánto y en qué va.
 *
 * Tres decisiones que atraviesan todo el esquema:
 *
 * 1. **El cliente es un sujeto, no una ficha nueva.** Se referencia
 *    `(tipo_sujeto, clave)` igual que `segmento_miembro`, y el nombre, el RUC y
 *    la actividad se leen del perfil. Copiarlos aquí sería tener dos verdades y
 *    descubrir la divergencia el día que alguien mire las dos pantallas. Igual
 *    que en el resto de la capa comercial, `clave` es el expediente para las
 *    compañías y el RUC para las otras dos poblaciones.
 *
 * 2. **La marca va desde el principio.** Son varias (ASCENDRA, FRIDAY) y lo que
 *    se quiere medir es por marca. Añadir la columna después es migrar datos ya
 *    cargados y revisar cada consulta; llevarla desde la primera fila no cuesta
 *    nada. El aislamiento multiempresa —otra cosa— llega con los roles.
 *
 * 3. **Los leads no son sujetos.** Uno de pauta llega con un teléfono y nada
 *    más: no tiene RUC ni está en el padrón, así que no puede ser un sujeto
 *    hasta que alguien lo identifique. Vive en `crm_lead` y se enlaza cuando
 *    aparece su RUC o su cédula. La oportunidad sí exige sujeto.
 */
export class CreateCrm1700000025000 implements MigrationInterface {
  name = 'CreateCrm1700000025000';

  public async up(q: QueryRunner): Promise<void> {
    // --------------------------------------------------------------- catálogos
    await q.query(`
      CREATE TABLE crm_marca (
        codigo text PRIMARY KEY,
        nombre text NOT NULL,
        activo boolean NOT NULL DEFAULT true,
        orden  smallint NOT NULL DEFAULT 50
      )
    `);

    // El comercial se identifica con el mismo valor que firma los cambios
    // (`X-Usuario`), para que el día que haya autenticación de verdad la tabla
    // ya apunte a la identidad buena y no haya que casar dos listas.
    await q.query(`
      CREATE TABLE crm_comercial (
        usuario text PRIMARY KEY,
        nombre  text NOT NULL,
        activo  boolean NOT NULL DEFAULT true
      )
    `);

    // Las etapas son datos y no un enum: el embudo de cada negocio es distinto
    // y cambiarlo no debería ser una migración de tipo. `es_ganada` y
    // `es_perdida` marcan las dos terminales, que es lo único que el código
    // necesita saber para calcular conversión y mover el estado comercial.
    await q.query(`
      CREATE TABLE crm_etapa (
        codigo     text PRIMARY KEY,
        nombre     text NOT NULL,
        orden      smallint NOT NULL,
        es_ganada  boolean NOT NULL DEFAULT false,
        es_perdida boolean NOT NULL DEFAULT false,
        CONSTRAINT crm_etapa_terminal_unica CHECK (NOT (es_ganada AND es_perdida))
      )
    `);

    await q.query(`
      CREATE TABLE crm_etiqueta (
        codigo text PRIMARY KEY,
        nombre text NOT NULL,
        color  text NOT NULL
      )
    `);

    // ------------------------------------------------------------------ leads
    await q.query(`
      CREATE TABLE crm_lead (
        id              bigserial PRIMARY KEY,
        marca           text NOT NULL REFERENCES crm_marca(codigo),
        nombre          text NULL,
        telefono        text NULL,
        correo          text NULL,
        origen_canal    text NULL,
        origen_campania text NULL,
        tipo_sujeto     text NULL,
        clave           text NULL,
        estado          text NOT NULL DEFAULT 'nuevo',
        nota            text NULL,
        recibido_en          timestamptz NOT NULL DEFAULT now(),
        primera_respuesta_en timestamptz NULL,
        creado_por      text NULL
      )
    `);
    // El tiempo de respuesta sólo se mide si se guarda cuándo entró el lead; no
    // se reconstruye después, así que las dos marcas van desde el principio.
    await q.query(`CREATE INDEX idx_crm_lead_sujeto ON crm_lead (tipo_sujeto, clave)`);
    await q.query(`CREATE INDEX idx_crm_lead_estado ON crm_lead (estado, recibido_en DESC)`);
    await q.query(`CREATE INDEX idx_crm_lead_telefono ON crm_lead (telefono)`);

    // -------------------------------------------------------------- contactos
    await q.query(`
      CREATE TABLE crm_contacto (
        id          bigserial PRIMARY KEY,
        tipo_sujeto text NOT NULL,
        clave       text NOT NULL,
        nombre      text NOT NULL,
        cargo       text NULL,
        correos     jsonb NOT NULL DEFAULT '[]'::jsonb,
        telefonos   jsonb NOT NULL DEFAULT '[]'::jsonb,
        linkedin    text NULL,
        principal   boolean NOT NULL DEFAULT false,
        nota        text NULL,
        creado_en   timestamptz NOT NULL DEFAULT now(),
        creado_por  text NOT NULL
      )
    `);
    // Varios correos y teléfonos por persona, cada uno con su etiqueta
    // ("trabajo", "móvil"). Dos columnas planas obligan a elegir cuál es *el*
    // correo, y la respuesta real es que depende de para qué.
    await q.query(`CREATE INDEX idx_crm_contacto_sujeto ON crm_contacto (tipo_sujeto, clave)`);

    await q.query(`
      CREATE TABLE crm_contacto_etiqueta (
        contacto bigint NOT NULL REFERENCES crm_contacto(id) ON DELETE CASCADE,
        etiqueta text   NOT NULL REFERENCES crm_etiqueta(codigo) ON DELETE CASCADE,
        PRIMARY KEY (contacto, etiqueta)
      )
    `);

    // ---------------------------------------------------------- oportunidades
    await q.query(`
      CREATE TABLE crm_oportunidad (
        id              bigserial PRIMARY KEY,
        marca           text NOT NULL REFERENCES crm_marca(codigo),
        tipo_sujeto     text NOT NULL,
        clave           text NOT NULL,
        producto        text NOT NULL REFERENCES producto(codigo),
        etapa           text NOT NULL REFERENCES crm_etapa(codigo),
        monto           numeric(14,2) NULL,
        comercial       text NULL REFERENCES crm_comercial(usuario),
        origen_segmento text NULL REFERENCES segmento(codigo),
        origen_lead     bigint NULL REFERENCES crm_lead(id) ON DELETE SET NULL,
        cierre_estimado date NULL,
        indice          smallint NOT NULL DEFAULT 0,
        archivada_en    timestamptz NULL,
        creada_en       timestamptz NOT NULL DEFAULT now(),
        actualizada_en  timestamptz NOT NULL DEFAULT now(),
        creada_por      text NOT NULL
      )
    `);
    // `producto` apunta al catálogo que ya alimenta los segmentos. Con texto
    // libre, «cuánto vendimos de Registro de Marca» obliga a clasificar a mano.
    //
    // `origen_segmento` y `origen_lead` son de dónde salió: lo que permite
    // responder qué segmento y qué campaña convierten, que hoy no tiene
    // respuesta. `indice` es la posición dentro de su columna del tablero.
    await q.query(`CREATE INDEX idx_crm_oport_sujeto ON crm_oportunidad (tipo_sujeto, clave)`);
    await q.query(`CREATE INDEX idx_crm_oport_etapa ON crm_oportunidad (etapa, indice)`);
    await q.query(`CREATE INDEX idx_crm_oport_comercial ON crm_oportunidad (comercial)`);
    await q.query(`CREATE INDEX idx_crm_oport_marca ON crm_oportunidad (marca)`);

    // Una sola oportunidad abierta por sujeto y producto.
    //
    // Es el error clásico cuando dos comerciales trabajan la misma lista: los
    // dos abren la misma venta y el embudo cuenta doble. Las archivadas quedan
    // fuera del índice, así que al mismo cliente se le puede volver a ofrecer
    // lo mismo el año que viene.
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
        ON crm_oportunidad (tipo_sujeto, clave, producto)
       WHERE archivada_en IS NULL
    `);

    // -------------------------------------------------------------- actividad
    // Toda conversación con el cliente, venga por donde venga.
    //
    // Nace registrando llamadas a mano, pero es la tabla en la que luego caen
    // WhatsApp y correo. Si las llamadas nacieran como notas, el día del
    // historial unificado habría que migrarlas y reescribir la ficha.
    await q.query(`
      CREATE TABLE crm_interaccion (
        id          bigserial PRIMARY KEY,
        canal       text NOT NULL,
        direccion   text NOT NULL CHECK (direccion IN ('entrante','saliente')),
        oportunidad bigint NULL REFERENCES crm_oportunidad(id) ON DELETE CASCADE,
        contacto    bigint NULL REFERENCES crm_contacto(id) ON DELETE SET NULL,
        lead        bigint NULL REFERENCES crm_lead(id) ON DELETE CASCADE,
        resultado   text NULL,
        texto       text NULL,
        ocurrido_en timestamptz NOT NULL DEFAULT now(),
        autor       text NOT NULL,
        CONSTRAINT crm_interaccion_colgada CHECK (
          oportunidad IS NOT NULL OR contacto IS NOT NULL OR lead IS NOT NULL
        )
      )
    `);
    await q.query(
      `CREATE INDEX idx_crm_interaccion_oport ON crm_interaccion (oportunidad, ocurrido_en DESC)`,
    );
    await q.query(
      `CREATE INDEX idx_crm_interaccion_lead ON crm_interaccion (lead, ocurrido_en DESC)`,
    );

    await q.query(`
      CREATE TABLE crm_nota (
        id          bigserial PRIMARY KEY,
        oportunidad bigint NULL REFERENCES crm_oportunidad(id) ON DELETE CASCADE,
        contacto    bigint NULL REFERENCES crm_contacto(id) ON DELETE CASCADE,
        texto       text NOT NULL,
        estado      text NULL,
        fecha       timestamptz NOT NULL DEFAULT now(),
        autor       text NOT NULL,
        CONSTRAINT crm_nota_colgada CHECK (
          oportunidad IS NOT NULL OR contacto IS NOT NULL
        )
      )
    `);
    await q.query(`CREATE INDEX idx_crm_nota_oport ON crm_nota (oportunidad, fecha DESC)`);

    await q.query(`
      CREATE TABLE crm_tarea (
        id          bigserial PRIMARY KEY,
        oportunidad bigint NULL REFERENCES crm_oportunidad(id) ON DELETE CASCADE,
        contacto    bigint NULL REFERENCES crm_contacto(id) ON DELETE CASCADE,
        texto       text NOT NULL,
        tipo        text NULL,
        vence       date NOT NULL,
        hecha_en    timestamptz NULL,
        responsable text NOT NULL,
        creada_en   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT crm_tarea_colgada CHECK (
          oportunidad IS NOT NULL OR contacto IS NOT NULL
        )
      )
    `);
    // La agenda del día pregunta siempre por lo pendiente, así que el índice
    // deja fuera lo hecho en vez de guardarlo para nada.
    await q.query(`
      CREATE INDEX idx_crm_tarea_pendiente ON crm_tarea (responsable, vence)
       WHERE hecha_en IS NULL
    `);

    // --------------------------------------------------------------- semillas
    // Las marcas que ya existen en el repositorio: ASCENDRA es la firma que
    // emite los informes (`front/src/marca.jsx`) y FRIDAY la plataforma. Si hay
    // más, se añaden con una migración.
    await q.query(`
      INSERT INTO crm_marca (codigo, nombre, orden) VALUES
        ('ascendra', 'ASCENDRA', 1),
        ('friday',   'FRIDAY',   2)
    `);

    await q.query(`
      INSERT INTO crm_etapa (codigo, nombre, orden, es_ganada, es_perdida) VALUES
        ('contacto',    'Por contactar',     1, false, false),
        ('conversando', 'En conversación',   2, false, false),
        ('propuesta',   'Propuesta enviada', 3, false, false),
        ('negociacion', 'En negociación',    4, false, false),
        ('ganada',      'Ganada',            5, true,  false),
        ('perdida',     'Perdida',           6, false, true)
    `);

    await q.query(`
      INSERT INTO crm_etiqueta (codigo, nombre, color) VALUES
        ('decisor',     'Decisor',     '#1e3a5f'),
        ('tecnico',     'Técnico',     '#3d5a80'),
        ('contable',    'Contable',    '#065f46'),
        ('recomendado', 'Recomendado', '#b45309')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm_tarea`);
    await q.query(`DROP TABLE IF EXISTS crm_nota`);
    await q.query(`DROP TABLE IF EXISTS crm_interaccion`);
    await q.query(`DROP TABLE IF EXISTS crm_contacto_etiqueta`);
    await q.query(`DROP TABLE IF EXISTS crm_oportunidad`);
    await q.query(`DROP TABLE IF EXISTS crm_contacto`);
    await q.query(`DROP TABLE IF EXISTS crm_lead`);
    await q.query(`DROP TABLE IF EXISTS crm_etiqueta`);
    await q.query(`DROP TABLE IF EXISTS crm_etapa`);
    await q.query(`DROP TABLE IF EXISTS crm_comercial`);
    await q.query(`DROP TABLE IF EXISTS crm_marca`);
  }
}
