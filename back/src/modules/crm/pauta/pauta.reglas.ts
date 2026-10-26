/**
 * Las reglas de la pauta: leer el gasto que exportan las plataformas y
 * convertirlo en indicadores.
 *
 * Todo lo que puede salir mal sin dar error vive aquí y está probado: un
 * «1.234» leído como uno coma dos, un 03/04 leído como cuatro de marzo, una
 * fila de totales sumada como un día más. Cualquiera de esos deja el retorno
 * de una campaña equivocado y nadie lo nota hasta que se decide el
 * presupuesto con él.
 */
import { decodificarTexto } from '../../../common/text/encoding';
import { headerKey } from '../../../common/text/normalize';

export const PLATAFORMAS = ['meta', 'google', 'tiktok', 'linkedin', 'otra'] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export function esPlataforma(valor: unknown): valor is Plataforma {
  return typeof valor === 'string' && (PLATAFORMAS as readonly string[]).includes(valor);
}

/**
 * La etiqueta de campaña tal como se compara.
 *
 * Quien arma el anuncio escribe «Auditoria-Octubre» y el enlace lo copia otro
 * como «auditoria-octubre ». Para el cruce son la misma campaña; la base hace
 * lo mismo con `lower()` en el índice único y en la consulta.
 */
export function claveUtm(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim().toLowerCase();
  return limpio === '' ? null : limpio;
}

// ============================================================ informe de gasto

export interface DiaDeGasto {
  dia: string; // YYYY-MM-DD
  gasto: number;
  impresiones: number | null;
  clics: number | null;
}

export interface InformeLeido {
  dias: DiaDeGasto[];
  /** Lo que no se pudo leer, con su línea, para enseñarlo y no tragárselo. */
  avisos: string[];
  encoding: string;
}

/**
 * Decodifica el archivo.
 *
 * Google Ads exporta en UTF-16 con BOM (`FF FE`); Meta y TikTok en UTF-8; un
 * CSV guardado desde Excel en Windows suele venir en Latin-1. Lo que no es
 * UTF-16 pasa por `decodificarTexto`, que es el lector común del proyecto.
 */
export function decodificarInforme(buffer: Buffer): { texto: string; encoding: string } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { texto: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
  }
  const { texto, encoding } = decodificarTexto(buffer);
  return { texto, encoding };
}

/** El separador que más se repite en las primeras líneas con contenido. */
function detectarSeparador(lineas: string[]): string {
  const muestra = lineas.slice(0, 10).join('\n');
  const candidatos = ['\t', ';', ','];
  let mejor = ',';
  let max = -1;
  for (const c of candidatos) {
    const n = muestra.split(c).length - 1;
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

/** Parte una línea CSV respetando las comillas (Meta las pone en todo). */
function partir(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        enComillas = !enComillas;
      }
    } else if (c === sep && !enComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * Las columnas que interesan, por prioridad.
 *
 * Las claves ya pasaron por `headerKey` (mayúsculas, sin tildes, `_`). Se
 * compara por prefijo porque las plataformas añaden la moneda al final
 * («Importe gastado (USD)»). En clics se prefiere el clic en el enlace: el
 * «Clics (todos)» de Meta cuenta también los «me gusta» y abrir la foto, y
 * con él el costo por clic sale más barato de lo que es.
 */
const COLUMNAS: Record<'dia' | 'gasto' | 'impresiones' | 'clics', string[]> = {
  dia: ['DIA', 'DAY', 'FECHA', 'DATE', 'INICIO_DEL_INFORME', 'REPORTING_STARTS', 'BY_DAY'],
  gasto: [
    'IMPORTE_GASTADO',
    'AMOUNT_SPENT',
    'COSTO',
    'COSTE',
    'COST',
    'GASTO',
    'SPEND',
    'INVERSION',
    'TOTAL_SPENT',
  ],
  impresiones: ['IMPRESIONES', 'IMPRESSIONS', 'IMPR'],
  clics: ['CLICS_EN_EL_ENLACE', 'LINK_CLICKS', 'CLICS', 'CLICKS', 'CLIC'],
};

function indiceDe(cabeceras: string[], candidatos: string[]): number {
  for (const candidato of candidatos) {
    const i = cabeceras.findIndex((c) => c === candidato || c.startsWith(`${candidato}_`));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Qué signo es el decimal en este archivo.
 *
 * No se puede decidir número a número: «1.234» es mil doscientos treinta y
 * cuatro en un informe en español y uno coma dos en uno en inglés. Se mira el
 * archivo entero: si algún valor termina en coma y uno o dos dígitos, el
 * decimal es la coma; si alguno termina en punto y uno o dos dígitos, el
 * punto. Si nada lo delata, punto, que es como exportan las plataformas en su
 * configuración por defecto.
 */
export function detectarDecimal(valores: string[]): ',' | '.' {
  for (const v of valores) {
    const s = v.replace(/[^\d.,-]/g, '');
    if (/,\d{1,2}$/.test(s)) return ',';
    if (/\.\d{1,2}$/.test(s)) return '.';
  }
  return '.';
}

/** Un número tal como viene en el informe, o `null` si no es un número. */
export function leerNumero(crudo: string, decimal: ',' | '.'): number | null {
  let s = (crudo ?? '').replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  const miles = decimal === ',' ? '.' : ',';
  s = s.split(miles).join('');
  if (decimal === ',') s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

/**
 * Cómo vienen las fechas con barra en este archivo: día/mes o mes/día.
 *
 * Igual que con los decimales, se decide por el archivo: si alguna fecha tiene
 * más de 12 en la primera parte, es día/mes; si la tiene en la segunda,
 * mes/día. Sin pistas, día/mes, que es lo que usa una cuenta configurada en
 * español. Decidirlo fecha a fecha haría que el 3 de abril y el 13 de abril
 * del mismo informe se leyeran con reglas distintas.
 */
export function detectarOrdenFecha(valores: string[]): 'dm' | 'md' {
  for (const v of valores) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) return 'dm';
    if (Number(m[2]) > 12) return 'md';
  }
  return 'dm';
}

function dosCifras(n: number): string {
  return String(n).padStart(2, '0');
}

function fechaValida(a: number, m: number, d: number): string | null {
  if (a < 100) a += 2000;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${dosCifras(m)}-${dosCifras(d)}`;
}

/** Una fecha del informe como `YYYY-MM-DD`, o `null`. */
export function leerFecha(crudo: string, orden: 'dm' | 'md'): string | null {
  const s = (crudo ?? '').trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return orden === 'dm'
      ? fechaValida(Number(m[3]), y, x)
      : fechaValida(Number(m[3]), x, y);
  }

  // «1 oct. 2026», «1 de octubre de 2026», «Oct 1, 2026».
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-zñ]{3})[a-zñ.]*\s+(?:de\s+)?(\d{4})$/);
  if (m && MESES[m[2]]) return fechaValida(Number(m[3]), MESES[m[2]], Number(m[1]));
  m = s.match(/^([a-z]{3})[a-z.]*\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MESES[m[1]]) return fechaValida(Number(m[3]), MESES[m[1]], Number(m[2]));

  return null;
}

/**
 * Lee un informe de gasto diario de Meta, Google, TikTok o uno hecho a mano.
 *
 * - La cabecera no siempre es la primera línea: Google pone antes el nombre
 *   del informe y el rango de fechas. Se busca la primera línea que tenga
 *   columna de día y de gasto.
 * - Las filas sin fecha legible se saltan con aviso, salvo las de totales
 *   («Total», «Total: cuenta», «--»), que se saltan en silencio: sumarlas
 *   duplicaría el gasto del período.
 * - Varias filas del mismo día (un informe por conjunto de anuncios) se
 *   suman: el gasto de la campaña ese día es la suma de todos.
 */
export function leerInformeDeGasto(buffer: Buffer): InformeLeido {
  const { texto, encoding } = decodificarInforme(buffer);
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const avisos: string[] = [];
  if (lineas.length === 0) return { dias: [], avisos: ['El archivo está vacío.'], encoding };

  const sep = detectarSeparador(lineas);
  let fila = -1;
  let idx = { dia: -1, gasto: -1, impresiones: -1, clics: -1 };
  for (let i = 0; i < Math.min(lineas.length, 15); i++) {
    const cab = partir(lineas[i], sep).map(headerKey);
    const dia = indiceDe(cab, COLUMNAS.dia);
    const gasto = indiceDe(cab, COLUMNAS.gasto);
    if (dia >= 0 && gasto >= 0) {
      fila = i;
      idx = {
        dia,
        gasto,
        impresiones: indiceDe(cab, COLUMNAS.impresiones),
        clics: indiceDe(cab, COLUMNAS.clics),
      };
      break;
    }
  }
  if (fila < 0) {
    return {
      dias: [],
      avisos: [
        'No encontré las columnas de día y de gasto. Exporta el informe desglosado por día, con la columna de importe gastado o costo.',
      ],
      encoding,
    };
  }

  const filas = lineas.slice(fila + 1).map((l) => partir(l, sep));
  const decimal = detectarDecimal(filas.map((f) => f[idx.gasto] ?? ''));
  const orden = detectarOrdenFecha(filas.map((f) => f[idx.dia] ?? ''));

  const porDia = new Map<string, DiaDeGasto>();
  filas.forEach((f, i) => {
    const linea = fila + i + 2;
    const crudoDia = f[idx.dia] ?? '';
    if (/^(total|--|$)/i.test(crudoDia.trim())) return;

    const dia = leerFecha(crudoDia, orden);
    if (!dia) {
      avisos.push(`Línea ${linea}: «${crudoDia}» no es una fecha que entienda.`);
      return;
    }
    const gasto = leerNumero(f[idx.gasto] ?? '', decimal);
    if (gasto === null || gasto < 0) {
      avisos.push(`Línea ${linea}: el gasto «${f[idx.gasto] ?? ''}» no es un número.`);
      return;
    }
    // Impresiones y clics son enteros: se leen sin decimales para que un
    // «1.234» de un informe con coma decimal no quede en 1,234.
    const entero = (j: number) => {
      if (j < 0) return null;
      const n = leerNumero((f[j] ?? '').replace(/[.,]/g, ''), '.');
      return n === null ? null : Math.round(n);
    };

    const previo = porDia.get(dia);
    const impresiones = entero(idx.impresiones);
    const clics = entero(idx.clics);
    porDia.set(dia, {
      dia,
      gasto: Math.round(((previo?.gasto ?? 0) + gasto) * 100) / 100,
      impresiones:
        impresiones === null && previo?.impresiones == null
          ? null
          : (previo?.impresiones ?? 0) + (impresiones ?? 0),
      clics: clics === null && previo?.clics == null ? null : (previo?.clics ?? 0) + (clics ?? 0),
    });
  });

  const dias = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  if (dias.length === 0 && avisos.length === 0) avisos.push('El informe no trae ningún día con gasto.');
  return { dias, avisos, encoding };
}

/** Separa los días dentro del período de la campaña de los que caen fuera. */
export function dentroDelPeriodo(dias: DiaDeGasto[], desde: string, hasta: string) {
  const dentro = dias.filter((d) => d.dia >= desde && d.dia <= hasta);
  const fuera = dias.filter((d) => d.dia < desde || d.dia > hasta);
  return { dentro, fuera };
}

// ================================================================ indicadores

export interface Cifras {
  presupuesto: number;
  desde: string;
  hasta: string;
  gasto: number;
  impresiones: number;
  clics: number;
  leads: number;
  oportunidades: number;
  /** Ventas ganadas y no anuladas que vienen de sus leads. */
  ventas: number;
  /** Empresas distintas que compraron: el denominador del CAC. */
  clientes: number;
  ingresos: number;
  cobrado: number;
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const dividir = (a: number, b: number, d = 2) => (b > 0 ? redondear(a / b, d) : null);

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Los indicadores de una campaña.
 *
 * - **CPL** = gasto / leads; **CAC** = gasto / clientes nuevos.
 * - **ROAS** = ingresos / gasto: cuántos dólares vuelven por dólar pautado.
 * - **ROI** = (ingresos − gasto) / gasto, en porcentaje. Es sobre lo vendido;
 *   `roiCobrado` hace la misma cuenta con lo ya cobrado, que es el dinero
 *   que de verdad volvió.
 * - Lo que no se puede calcular —sin gasto, sin leads— es `null`, no cero: un
 *   CPL de cero diría que los leads salieron gratis.
 */
export function indicadores(c: Cifras) {
  return {
    ctr: c.impresiones > 0 ? redondear((c.clics / c.impresiones) * 100) : null,
    cpc: dividir(c.gasto, c.clics),
    cpl: dividir(c.gasto, c.leads),
    conversionLead: c.leads > 0 ? redondear((c.ventas / c.leads) * 100, 1) : null,
    cac: dividir(c.gasto, c.clientes),
    roas: dividir(c.ingresos, c.gasto),
    roi: c.gasto > 0 ? redondear(((c.ingresos - c.gasto) / c.gasto) * 100, 1) : null,
    roiCobrado: c.gasto > 0 ? redondear(((c.cobrado - c.gasto) / c.gasto) * 100, 1) : null,
  };
}

export type EstadoRitmo = 'sin_empezar' | 'bajo' | 'en_linea' | 'sobre' | 'terminada' | 'excedida';

/**
 * El ritmo de gasto contra el presupuesto.
 *
 * Compara lo gastado con lo que se debería llevar gastado si el presupuesto
 * se repartiera parejo entre los días de la campaña. Un 15 % de margen hacia
 * cada lado es «en línea»: las plataformas no gastan exactamente lo mismo
 * cada día. Proyecta además cuánto se habrá gastado al final si se sigue al
 * ritmo de hoy, que es la cifra que permite corregir a tiempo.
 *
 * Se calcula con `hoy` explícito para no depender del reloj en las pruebas.
 */
export function ritmo(c: Pick<Cifras, 'presupuesto' | 'desde' | 'hasta' | 'gasto'>, hoy: string) {
  const total = diasEntre(c.desde, c.hasta);
  const ejecucion = c.presupuesto > 0 ? redondear((c.gasto / c.presupuesto) * 100, 1) : null;

  if (hoy < c.desde) {
    return { estado: 'sin_empezar' as EstadoRitmo, ejecucion, esperado: 0, proyeccion: null, transcurridos: 0, total };
  }
  const transcurridos = Math.min(total, diasEntre(c.desde, hoy));
  const esperado = redondear((c.presupuesto * transcurridos) / total);
  const proyeccion = transcurridos > 0 ? redondear((c.gasto / transcurridos) * total) : null;

  let estado: EstadoRitmo;
  if (c.presupuesto > 0 && c.gasto > c.presupuesto * 1.0001) estado = 'excedida';
  else if (hoy > c.hasta) estado = 'terminada';
  else if (esperado === 0) estado = 'en_linea';
  else if (c.gasto > esperado * 1.15) estado = 'sobre';
  else if (c.gasto < esperado * 0.85) estado = 'bajo';
  else estado = 'en_linea';

  return { estado, ejecucion, esperado, proyeccion, transcurridos, total };
}
