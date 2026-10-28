import { createHash } from 'node:crypto';

/**
 * Cómo se escribe una exportación y cómo se comprueba.
 *
 * Puras, para probarlas sin base de datos: lo que hace que una exportación sea
 * «verificable» es que cada byte sea predecible —mismo dato, mismo archivo,
 * misma huella— y eso se prueba con ejemplos, no con una base llena.
 */

export const VERSION_FORMATO = 1;

// --------------------------------------------------------------------- CSV

/**
 * Un valor en CSV (RFC 4180), ya convertido a texto por Postgres.
 *
 * **Nulo y vacío no son lo mismo**, y en un CSV ingenuo se confunden: el
 * contacto sin cargo y el contacto con cargo «» salen iguales, y al volver a
 * cargar no se sabe cuál era cuál. Aquí el nulo va sin nada y el texto vacío
 * entre comillas (`""`), que es como lo lee el `COPY ... CSV` de Postgres. Así
 * el archivo vuelve a la base tal como salió.
 */
export function celda(valor: string | null): string {
  if (valor === null) return '';
  if (valor === '' || /[",\r\n]/.test(valor) || valor !== valor.trim()) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function filaCsv(valores: (string | null)[]): string {
  return valores.map(celda).join(',');
}

/** Saltos de línea `\r\n`, como pide la norma y como los espera Excel. */
export const FIN = '\r\n';

export function csv(columnas: string[], filas: (string | null)[][]): string {
  return [filaCsv(columnas), ...filas.map(filaCsv)].map((l) => l + FIN).join('');
}

// ------------------------------------------------------------ qué no sale

/**
 * Las columnas que no se exportan, con su motivo.
 *
 * Los `token` son las llaves de los enlaces públicos —la proforma que acepta
 * el cliente, su encuesta, la baja de un correo—. No son información del
 * cliente sino credenciales: quien tuviera el archivo podría aceptar proformas
 * en nombre de otros. Se dejan fuera **y se dice en el manifiesto**, para que
 * «completa» siga siendo verdad: falta esto, y por esto.
 */
export function motivoParaOmitir(columna: string, tipo: string): string | null {
  if (/(^|_)token$/.test(columna) && tipo === 'uuid') {
    return 'Llave de un enlace público: es una credencial, no un dato.';
  }
  return null;
}

// --------------------------------------------------------------- huellas

export const sha256 = (datos: string | Buffer) => createHash('sha256').update(datos).digest('hex');

export interface TablaExportada {
  tabla: string;
  archivo: string;
  filas: number;
  columnas: string[];
  omitidas: { columna: string; motivo: string }[];
  sha256: string;
}

export interface Manifiesto {
  formato: number;
  generado_en: string;
  por: string;
  /** La última migración aplicada: dice con qué esquema se leen los archivos. */
  esquema: string | null;
  tablas: TablaExportada[];
  total_filas: number;
}

/** Nombre de archivo seguro para una tabla: `crm.oportunidad` → `crm.oportunidad.csv`. */
export function archivoDe(tabla: string): string {
  return `tablas/${tabla.replace(/[^a-z0-9_.]/gi, '_')}.csv`;
}

// -------------------------------------------------------------- verificar

export interface Verificacion {
  valido: boolean;
  problemas: string[];
  tablas: number;
  filas: number;
}

/**
 * Comprobar un ZIP contra su propio manifiesto.
 *
 * Recibe el manifiesto y los archivos tal como vienen del ZIP. Comprueba que
 * estén todos, que no sobre ninguno, que cada uno tenga la huella anotada y
 * el número de filas anotado. Cualquier diferencia —una fila borrada a mano,
 * un archivo que falta, uno añadido— sale como problema con su nombre.
 */
export function verificar(manifiesto: Manifiesto, archivos: Map<string, Buffer>): Verificacion {
  const problemas: string[] = [];
  if (manifiesto?.formato !== VERSION_FORMATO) {
    problemas.push(`Formato ${manifiesto?.formato ?? 'desconocido'}; se esperaba ${VERSION_FORMATO}.`);
  }
  const esperados = new Set<string>();
  let filas = 0;
  for (const t of manifiesto?.tablas ?? []) {
    esperados.add(t.archivo);
    const contenido = archivos.get(t.archivo);
    if (!contenido) {
      problemas.push(`Falta ${t.archivo}.`);
      continue;
    }
    if (sha256(contenido) !== t.sha256) {
      problemas.push(`${t.archivo} no es el que se exportó (su huella no coincide).`);
    }
    const contadas = contarFilas(contenido.toString('utf8'));
    if (contadas !== t.filas) {
      problemas.push(`${t.archivo} tiene ${contadas} filas y el manifiesto dice ${t.filas}.`);
    }
    filas += t.filas;
  }
  for (const nombre of archivos.keys()) {
    if (nombre.startsWith('tablas/') && !esperados.has(nombre)) {
      problemas.push(`${nombre} no está en el manifiesto.`);
    }
  }
  if (filas !== manifiesto?.total_filas) {
    problemas.push(`El manifiesto suma ${filas} filas pero declara ${manifiesto?.total_filas}.`);
  }
  return { valido: problemas.length === 0, problemas, tablas: manifiesto?.tablas?.length ?? 0, filas };
}

/**
 * Filas de datos de un CSV, sin la cabecera.
 *
 * No basta con contar saltos de línea: una nota con tres párrafos lleva saltos
 * dentro de las comillas. Se recorre respetando las comillas.
 */
export function contarFilas(texto: string): number {
  let lineas = 0;
  let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') dentro = !dentro;
    else if (c === '\n' && !dentro) lineas++;
  }
  return Math.max(0, lineas - 1);
}
