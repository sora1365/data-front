/**
 * Qué recurso del CRM es qué tabla.
 *
 * Las pantallas son las de Atomic CRM, que pide sus datos como react-admin:
 * `GET /crm/api/deals?filter=…&sort=…&range=…`. En vez de escribir ocho
 * controladores que sólo se diferencian en el nombre de la tabla, el
 * controlador es uno y la diferencia son estos datos.
 *
 * **Esto es una lista blanca, no una comodidad.** Lo que llega del cliente
 * —recurso, campo por el que ordenar, campo por el que filtrar— acaba
 * interpolado en el SQL, porque ni el nombre de una tabla ni el de una columna
 * pueden ir como parámetro. Cada nombre se comprueba contra estas listas antes
 * de tocar la consulta: lo que no está aquí no existe.
 */
export interface Recurso {
  /** Tabla o vista de la que lee. */
  tabla: string;
  /** Columnas que se pueden leer, filtrar y ordenar. */
  columnas: string[];
  /** Columnas que el cliente puede escribir. El resto las pone el servidor. */
  escribibles: string[];
  /** Orden por defecto, cuando el cliente no pide ninguno. */
  orden: string;
  /** Columnas de texto que busca el filtro `q`. */
  busqueda?: string[];
  /** Sólo lectura: lo que viene de la base de FRIDAY no se edita desde el CRM. */
  soloLectura?: boolean;
  /** SELECT a medida, cuando la tabla no basta. */
  select?: string;
}

const COLUMNAS_OPORTUNIDAD = [
  'id',
  'name',
  'description',
  'company_id',
  'contact_ids',
  'category',
  'stage',
  'amount',
  'sales_id',
  'index',
  'created_at',
  'updated_at',
  'archived_at',
  'expected_closing_date',
  'marca',
  'origen_segmento',
  'tipo_sujeto',
  'clave',
];

export const RECURSOS: Record<string, Recurso> = {
  /**
   * Las oportunidades. `company_id` no es una columna: el cliente de FRIDAY es
   * un sujeto con clave compuesta `(tipo_sujeto, clave)`, y react-admin
   * necesita un identificador único por registro. Se compone como
   * `compania:390772` al leer y se parte al escribir.
   */
  /**
   * `amount` se saca como `float8` y no como el `numeric` que es en la tabla:
   * `numeric` llega a JavaScript como cadena —no cabe en un double sin perder
   * precisión—, y el tablero suma los importes de cada columna. Sumar cadenas
   * concatena, así que una columna con un solo trato de 480 mostraba «0480.00»
   * como total. Un importe comercial cabe de sobra en un float.
   */
  deals: {
    tabla: 'crm.oportunidad',
    columnas: COLUMNAS_OPORTUNIDAD,
    escribibles: [
      'name',
      'description',
      'category',
      'stage',
      'amount',
      'sales_id',
      'index',
      'expected_closing_date',
      'contact_ids',
      'archived_at',
      'marca',
    ],
    orden: 'index',
    busqueda: ['name', 'description'],
    select: `
      o.id, o.name, o.description, o.producto AS category, o.etapa AS stage,
      o.monto::float8 AS amount, o.comercial AS sales_id, o.indice AS index,
      o.creada_en AS created_at, o.actualizada_en AS updated_at,
      o.archivada_en AS archived_at, o.cierre_estimado AS expected_closing_date,
      o.contact_ids, o.marca, o.origen_segmento, o.tipo_sujeto, o.clave,
      o.tipo_sujeto || ':' || o.clave AS company_id
    `,
  },

  contacts: {
    tabla: 'crm.contacto',
    columnas: [
      'id',
      'first_name',
      'last_name',
      'title',
      'company_id',
      'email_jsonb',
      'phone_jsonb',
      'linkedin_url',
      'background',
      'gender',
      'status',
      'tags',
      'sales_id',
      'first_seen',
      'last_seen',
      'has_newsletter',
      'avatar',
      'tipo_sujeto',
      'clave',
    ],
    escribibles: [
      'first_name',
      'last_name',
      'title',
      'email_jsonb',
      'phone_jsonb',
      'linkedin_url',
      'background',
      'gender',
      'status',
      'tags',
      'sales_id',
      'has_newsletter',
      'avatar',
      'first_seen',
      'last_seen',
    ],
    orden: 'last_name',
    busqueda: ['first_name', 'last_name', 'title'],
    select: `
      c.id, c.first_name, c.last_name, c.title, c.email_jsonb, c.phone_jsonb,
      c.linkedin_url, c.background, c.gender, c.status, c.tags, c.sales_id,
      c.first_seen, c.last_seen, c.has_newsletter, c.avatar,
      c.tipo_sujeto, c.clave,
      c.tipo_sujeto || ':' || c.clave AS company_id
    `,
  },

  /**
   * Las empresas **no se crean desde el CRM**: son los 7,1 millones de sujetos
   * que ya están en FRIDAY. Dejar crearlas aquí sería empezar a teclear a mano
   * compañías que la Superintendencia ya publica, con su RUC mal escrito, y
   * acabar con dos listas que no casan.
   */
  companies: {
    tabla: 'perfil_comercial',
    columnas: [
      'id',
      'name',
      'tax_identifier',
      'sector',
      'address',
      'city',
      'state_abbr',
      'phone_number',
      'website',
      'created_at',
      // `country` sale del SELECT como literal, así que no se puede ordenar ni
      // filtrar por él: no existe como columna en el perfil.
    ],
    escribibles: [],
    soloLectura: true,
    orden: 'name',
    busqueda: ['name', 'tax_identifier'],
    select: `
      p.tipo_sujeto || ':' || p.clave AS id,
      p.nombre AS name, p.ruc AS tax_identifier, p.actividad AS sector,
      p.direccion AS address, p.canton AS city, p.provincia AS state_abbr,
      p.telefono AS phone_number, p.sitio_web AS website,
      p.fecha_constitucion AS created_at, 'Ecuador'::text AS country
    `,
  },

  tasks: {
    tabla: 'crm.tarea',
    columnas: [
      'id',
      'text',
      'type',
      'due_date',
      'done_date',
      'contact_id',
      'deal_id',
      'sales_id',
      'created_at',
    ],
    escribibles: [
      'text',
      'type',
      'due_date',
      'done_date',
      'contact_id',
      'deal_id',
      'sales_id',
    ],
    orden: 'due_date',
    busqueda: ['text'],
  },

  tags: {
    tabla: 'crm.etiqueta',
    columnas: ['id', 'name', 'color'],
    escribibles: ['name', 'color'],
    orden: 'name',
    busqueda: ['name'],
  },

  sales: {
    tabla: 'crm.comercial',
    columnas: [
      'id',
      'first_name',
      'last_name',
      'email',
      'administrator',
      'disabled',
      'avatar',
    ],
    escribibles: ['first_name', 'last_name', 'email', 'administrator', 'disabled'],
    orden: 'first_name',
    busqueda: ['first_name', 'last_name', 'email'],
    // El identificador del comercial es el mismo `X-Usuario` que firma los
    // cambios en el resto de FRIDAY, para que el día que haya autenticación
    // no haya que casar dos listas de personas.
    select: `
      s.usuario AS id, s.first_name, s.last_name, s.email,
      s.administrator, s.disabled, s.avatar
    `,
  },

  contact_notes: {
    tabla: 'crm.nota',
    columnas: ['id', 'contact_id', 'deal_id', 'text', 'status', 'date', 'sales_id', 'attachments'],
    escribibles: ['contact_id', 'text', 'status', 'date', 'sales_id', 'attachments'],
    orden: 'date',
    busqueda: ['text'],
  },

  deal_notes: {
    tabla: 'crm.nota',
    columnas: ['id', 'contact_id', 'deal_id', 'text', 'status', 'date', 'sales_id', 'attachments'],
    escribibles: ['deal_id', 'text', 'date', 'sales_id', 'attachments'],
    orden: 'date',
    busqueda: ['text'],
  },
};

/** El alias que usa cada SELECT a medida. */
export const ALIAS: Record<string, string> = {
  deals: 'o',
  contacts: 'c',
  companies: 'p',
  sales: 's',
};

/**
 * Las notas de contacto y las de oportunidad son la misma tabla.
 *
 * Atomic las trata como dos recursos porque en Supabase son dos tablas. Aquí
 * una nota cuelga de una cosa o de la otra, así que cada recurso añade su
 * propio filtro: sin esto, la ficha de un contacto enseñaría también las notas
 * de las ventas.
 */
export const FILTRO_FIJO: Record<string, string> = {
  contact_notes: 'contact_id IS NOT NULL',
  deal_notes: 'deal_id IS NOT NULL',
};
