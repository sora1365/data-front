/**
 * Las reglas de la postventa: cuándo toca renovar y qué dice la encuesta.
 *
 * Puras, porque las dos cosas se equivocan de forma silenciosa. Una fecha de
 * renovación mal calculada avisa tarde —o no avisa—, y un NPS mal contado
 * tranquiliza a todo el mundo justo cuando habría que preocuparse.
 */

export type Periodicidad = 'mensual' | 'anual' | 'unica';

/**
 * Cuándo se renueva algo que empezó en `desde`.
 *
 * Lo que se vende una sola vez no se renueva y devuelve `null`: inventarle una
 * fecha llenaría la lista de avisos de cosas que no hay que renovar, y el día
 * que la lista miente nadie la mira.
 *
 * **El último día del mes se queda en el último día del mes.** Sumando meses a
 * la brava, el 31 de enero se convierte en el 3 de marzo: `setMonth` desborda
 * a los días que sobran. Un contrato que empieza el 31 vence el 28 o el 29.
 */
export function fechaDeRenovacion(
  periodicidad: Periodicidad | null | undefined,
  desde: string,
): string | null {
  if (periodicidad !== 'mensual' && periodicidad !== 'anual') return null;

  const base = Date.parse(`${desde}T00:00:00Z`);
  if (Number.isNaN(base)) return null;

  const fecha = new Date(base);
  const dia = fecha.getUTCDate();
  const mes = fecha.getUTCMonth() + (periodicidad === 'mensual' ? 1 : 12);

  const destino = new Date(Date.UTC(fecha.getUTCFullYear(), mes, 1));
  const ultimoDelMes = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate();

  destino.setUTCDate(Math.min(dia, ultimoDelMes));
  return destino.toISOString().slice(0, 10);
}

export interface VentaRenovable {
  id: number | string;
  renueva_en: string | null;
  renovada_en: string | null;
  estado?: string;
}

/**
 * Qué renovaciones hay que mirar hoy.
 *
 * Incluye las que vencen dentro de `diasDeAviso` **y las que ya vencieron sin
 * renovarse**: una renovación que pasó de fecha no desaparece del problema,
 * se convierte en el problema. Las ya renovadas y las anuladas salen de la
 * lista.
 */
export function renovacionesQueTocan<T extends VentaRenovable>(
  ventas: T[],
  hoy: string,
  diasDeAviso = 45,
): (T & { dias: number; vencida: boolean })[] {
  const limite = sumarDias(hoy, diasDeAviso);

  return ventas
    .filter((v) => v.renueva_en && !v.renovada_en && v.estado !== 'anulada')
    .filter((v) => v.renueva_en! <= limite)
    .map((v) => ({
      ...v,
      dias: diasEntreDias(hoy, v.renueva_en!),
      vencida: v.renueva_en! < hoy,
    }))
    .sort((a, b) => a.dias - b.dias);
}

export type Clase = 'promotor' | 'pasivo' | 'detractor';

/**
 * Cómo se lee un puntaje del 0 al 10.
 *
 * Es la escala estándar del NPS y se respeta tal cual: 9 y 10 promotores, 7 y
 * 8 pasivos, el resto detractores. Mover los cortes para que el número salga
 * mejor es la forma más rápida de que deje de poder compararse con nada.
 */
export function clasificar(puntaje: number): Clase {
  if (puntaje >= 9) return 'promotor';
  if (puntaje >= 7) return 'pasivo';
  return 'detractor';
}

export interface ResumenDeEncuestas {
  respuestas: number;
  promotores: number;
  pasivos: number;
  detractores: number;
  /** De -100 a 100, o null si nadie contestó. */
  nps: number | null;
  promedio: number | null;
}

/**
 * El NPS: promotores menos detractores, en porcentaje.
 *
 * **Los pasivos cuentan en el denominador y no suman**, que es lo que la gente
 * olvida: dejarlos fuera infla el número justo cuando hay muchos clientes
 * tibios, que es cuando más importa saberlo.
 *
 * Sin respuestas devuelve `null`, no cero. Un cero se lee como «vamos
 * regular»; la verdad es que no se sabe.
 */
export function resumirEncuestas(
  respuestas: { puntaje: number | null }[],
): ResumenDeEncuestas {
  const puntajes = respuestas
    .map((r) => r.puntaje)
    .filter((p): p is number => typeof p === 'number');

  if (puntajes.length === 0) {
    return { respuestas: 0, promotores: 0, pasivos: 0, detractores: 0, nps: null, promedio: null };
  }

  let promotores = 0;
  let pasivos = 0;
  let detractores = 0;
  for (const p of puntajes) {
    const clase = clasificar(p);
    if (clase === 'promotor') promotores += 1;
    else if (clase === 'pasivo') pasivos += 1;
    else detractores += 1;
  }

  const total = puntajes.length;
  const nps = Math.round(((promotores - detractores) / total) * 100);
  const promedio = Math.round((puntajes.reduce((s, p) => s + p, 0) / total) * 10) / 10;

  return { respuestas: total, promotores, pasivos, detractores, nps, promedio };
}

/** Días enteros entre dos fechas `YYYY-MM-DD`, en UTC para no contar de más. */
export function diasEntreDias(desde: string, hasta: string): number {
  const dia = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / dia);
}

export function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
