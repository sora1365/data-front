/**
 * Fuente única de verdad del orden de columnas del import.
 *
 * Este array alimenta CUATRO cosas que deben coincidir exactamente:
 *   1. el DDL de la tabla de staging,
 *   2. la lista de columnas del `COPY ... FROM STDIN`,
 *   3. el orden de los valores que serializa el row-mapper,
 *   4. el INSERT ... SELECT del merge.
 *
 * Si esas cuatro se desincronizan, los datos entran desplazados de columna en
 * silencio (el RUC en `nombre`, etc.). Derivarlas todas de aquí lo hace imposible.
 */

/** Las 24 columnas de negocio, en el orden del Excel de la Superintendencia. */
export const BUSINESS_COLUMNS = [
  'expediente',
  'ruc',
  'nombre',
  'situacion_legal',
  'fecha_constitucion',
  'tipo',
  'pais',
  'region',
  'provincia',
  'canton',
  'ciudad',
  'calle',
  'numero',
  'interseccion',
  'barrio',
  'telefono',
  'representante',
  'cargo',
  'capital_suscrito',
  'ciiu_nivel_1',
  'ciiu_nivel_6',
  'ultimo_balance',
  'presento_balance_inicial',
  'fecha_presentacion_balance_inicial',
] as const;

export type BusinessColumn = (typeof BUSINESS_COLUMNS)[number];

/** Orden exacto de los campos en cada línea del COPY. */
export const COPY_COLUMNS = [
  'source_row_number',
  ...BUSINESS_COLUMNS,
  'row_hash',
] as const;

/** Tipos Postgres de cada columna, usados para generar el DDL del staging. */
export const STAGING_COLUMN_TYPES: Record<string, string> = {
  source_row_number: 'bigint NOT NULL',
  expediente: 'text',
  ruc: 'text',
  nombre: 'text',
  situacion_legal: 'text',
  fecha_constitucion: 'date',
  tipo: 'text',
  pais: 'text',
  region: 'text',
  provincia: 'text',
  canton: 'text',
  ciudad: 'text',
  calle: 'text',
  numero: 'text',
  interseccion: 'text',
  barrio: 'text',
  telefono: 'text',
  representante: 'text',
  cargo: 'text',
  capital_suscrito: 'numeric(18,2)',
  ciiu_nivel_1: 'text',
  ciiu_nivel_6: 'text',
  ultimo_balance: 'smallint',
  presento_balance_inicial: 'boolean',
  fecha_presentacion_balance_inicial: 'date',
  row_hash: 'uuid NOT NULL',
};

/** Columnas sin las cuales una fila no tiene sentido: se rechaza entera. */
export const REQUIRED_COLUMNS: BusinessColumn[] = ['expediente', 'nombre'];

export const IMPORT_KIND = 'supercias_companias';
export const IMPORT_KIND_CATALOGO = 'catalogo_cuentas';
export const IMPORT_KIND_CIIU = 'catalogo_ciiu';
export const IMPORT_KIND_COEFICIENTES = 'coeficientes_sri';

/**
 * Fracción máxima de filas vigentes que un archivo puede dejar fuera antes de
 * que el import se aborte sin tocar nada.
 *
 * Es la protección contra subir un archivo truncado como snapshot completo: sin
 * ella, media base quedaría marcada como ausente de una sola sentencia.
 */
export const UMBRAL_AUSENCIA = 0.2;

/** Tamaño del buffer de texto antes de escribir al stream de COPY (~1 MiB). */
export const COPY_CHUNK_BYTES = 1 << 20;

/** Cada cuántas filas se considera reportar progreso. */
export const PROGRESS_ROW_INTERVAL = 25_000;

/** Mínimo de milisegundos entre dos escrituras de progreso. */
export const PROGRESS_MIN_INTERVAL_MS = 1500;

/** Número de particiones del merge (transacciones acotadas + progreso real). */
export const MERGE_CHUNKS = 8;

/** Máximo de filas rechazadas que se persisten (se siguen contando todas). */
export const MAX_STORED_REJECTS = 10_000;

/** Filas de rechazo por INSERT. */
export const REJECT_FLUSH_SIZE = 500;
