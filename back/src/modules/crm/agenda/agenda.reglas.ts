/**
 * Las reglas de la agenda.
 *
 * Puras y sin base de datos, porque son las que deciden si una cita cabe y hay
 * que poder probarlas sin montar un calendario entero. Lo que hacen todas es
 * comparar franjas de tiempo, y ahí casi todos los errores vienen de la misma
 * confusión: tratar el final de una franja como si estuviera dentro de ella.
 */

export interface Franja {
  inicio: Date | string;
  fin: Date | string;
}

const ms = (v: Date | string) => new Date(v).getTime();

/**
 * Si dos franjas se pisan.
 *
 * Los extremos **no** cuentan: una cita de 9:00 a 10:00 y otra de 10:00 a
 * 11:00 no se solapan, se encadenan. Con `<=` en vez de `<`, la agenda avisa
 * de un conflicto cada vez que alguien pone dos reuniones seguidas, que es lo
 * normal en un día de visitas, y el aviso deja de significar nada.
 */
export function seSolapan(a: Franja, b: Franja): boolean {
  return ms(a.inicio) < ms(b.fin) && ms(b.inicio) < ms(a.fin);
}

/** Las franjas ocupadas que chocan con la propuesta. */
export function conflictos<T extends Franja>(propuesta: Franja, ocupadas: T[]): T[] {
  return ocupadas.filter((o) => seSolapan(propuesta, o));
}

/**
 * Los huecos libres de un día, dadas las franjas ocupadas.
 *
 * Es lo que contesta «¿cuándo puede atender?» sin que nadie mire siete
 * agendas. Las ocupadas pueden venir desordenadas y solapadas entre sí —dos
 * reuniones a la vez es un caso real— así que primero se ordenan y se funden;
 * restarlas una a una de la jornada dejaría huecos que no existen.
 */
export function huecosLibres(
  jornada: Franja,
  ocupadas: Franja[],
  duracionMinutosMinima = 0,
): Franja[] {
  const desde = ms(jornada.inicio);
  const hasta = ms(jornada.fin);
  if (hasta <= desde) return [];

  const dentro = ocupadas
    .map((o) => ({ inicio: Math.max(ms(o.inicio), desde), fin: Math.min(ms(o.fin), hasta) }))
    .filter((o) => o.fin > o.inicio)
    .sort((x, y) => x.inicio - y.inicio);

  const fundidas: { inicio: number; fin: number }[] = [];
  for (const franja of dentro) {
    const ultima = fundidas[fundidas.length - 1];
    if (ultima && franja.inicio <= ultima.fin) {
      ultima.fin = Math.max(ultima.fin, franja.fin);
    } else {
      fundidas.push({ ...franja });
    }
  }

  const huecos: Franja[] = [];
  let cursor = desde;
  for (const ocupada of fundidas) {
    if (ocupada.inicio > cursor) huecos.push({ inicio: new Date(cursor), fin: new Date(ocupada.inicio) });
    cursor = Math.max(cursor, ocupada.fin);
  }
  if (cursor < hasta) huecos.push({ inicio: new Date(cursor), fin: new Date(hasta) });

  const minimoMs = duracionMinutosMinima * 60_000;
  return huecos.filter((h) => ms(h.fin) - ms(h.inicio) >= minimoMs);
}

/**
 * Reparte los eventos de un día en columnas para que no se tapen.
 *
 * Es lo que hace legible la vista vertical: dos reuniones a la misma hora se
 * ponen lado a lado en vez de una encima de otra. Se asigna a cada evento la
 * primera columna cuyo último evento ya terminó.
 */
export function repartirEnColumnas<T extends Franja>(
  eventos: T[],
): { evento: T; columna: number; columnas: number }[] {
  const ordenados = [...eventos].sort((a, b) => ms(a.inicio) - ms(b.inicio));
  const finPorColumna: number[] = [];
  const asignados: { evento: T; columna: number }[] = [];

  for (const evento of ordenados) {
    let columna = finPorColumna.findIndex((fin) => fin <= ms(evento.inicio));
    if (columna === -1) {
      columna = finPorColumna.length;
      finPorColumna.push(0);
    }
    finPorColumna[columna] = ms(evento.fin);
    asignados.push({ evento, columna });
  }

  // El total se calcula al final: hasta no repartirlos todos no se sabe cuántas
  // columnas hacen falta, y es lo que decide el ancho de cada uno.
  const columnas = Math.max(finPorColumna.length, 1);
  return asignados.map((a) => ({ ...a, columnas }));
}

/**
 * Si una franja es válida para guardarse.
 *
 * Se comprueba antes de tocar la base porque el mensaje tiene que decir qué
 * está mal: el `CHECK` de la tabla rechaza igual, pero con un error de
 * Postgres que no se puede enseñar a nadie.
 */
export function franjaValida(inicio: Date | string, fin: Date | string): string | null {
  const desde = ms(inicio);
  const hasta = ms(fin);

  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 'Las fechas no son válidas.';
  if (hasta < desde) return 'El evento no puede terminar antes de empezar.';

  // Un año es más de lo que dura cualquier reunión: a partir de ahí es un
  // error de fecha, casi siempre del año.
  if (hasta - desde > 365 * 24 * 60 * 60 * 1000) {
    return 'El evento dura más de un año: revisa las fechas.';
  }

  return null;
}

// ------------------------------------------------------------------- tareas

/**
 * Una tarea como la ve la agenda.
 *
 * `vence` es texto `YYYY-MM-DD` y no una fecha: la columna es `date`, un día
 * sin hora, y convertirlo a `Date` lo ata a una zona horaria que no tiene.
 * Comparadas como texto, las fechas ISO se ordenan solas y no hay zona que
 * valga.
 */
export interface TareaDeAgenda {
  id: number | string;
  vence: string;
  hecha: boolean;
}

/** El día de la semana en que se pinta una tarea, o null si no toca pintarla. */
export function diaEnQueSePinta<T extends TareaDeAgenda>(
  tarea: T,
  dias: string[],
  hoy: string,
): string | null {
  if (dias.length === 0) return null;

  // Una tarea terminada se queda donde vencía: es el registro de lo que se
  // hizo ese día, y arrastrarla sería reescribir la semana pasada.
  if (tarea.hecha) return dias.includes(tarea.vence) ? tarea.vence : null;

  // Y una pendiente que ya venció se arrastra a hoy. Dejarla en su día es
  // exactamente cómo se pierden: el lunes siguiente nadie vuelve a mirar el
  // jueves anterior, y la tarea desaparece de la vista sin que nadie la haya
  // cerrado. Si hoy no está en la semana que se mira, no se pinta: arrastrarla
  // al lunes de una semana cualquiera diría que vence ese día, que es mentira.
  if (tarea.vence < hoy) return dias.includes(hoy) ? hoy : null;

  return dias.includes(tarea.vence) ? tarea.vence : null;
}

/**
 * Reparte las tareas por el día en que se enseñan.
 *
 * Devuelve un mapa de día a tareas, cada una con si está vencida y cuántos
 * días lleva así. Lo hace esta función y no la consulta porque el arrastre de
 * lo vencido a hoy es una decisión de producto, no de SQL, y porque así se
 * puede probar sin base de datos.
 */
export function repartirTareasPorDia<T extends TareaDeAgenda>(
  tareas: T[],
  dias: string[],
  hoy: string,
): Map<string, (T & { vencida: boolean; diasDeRetraso: number })[]> {
  const porDia = new Map<string, (T & { vencida: boolean; diasDeRetraso: number })[]>();
  for (const dia of dias) porDia.set(dia, []);

  for (const tarea of tareas) {
    const dia = diaEnQueSePinta(tarea, dias, hoy);
    if (!dia) continue;
    const vencida = !tarea.hecha && tarea.vence < hoy;
    porDia.get(dia)!.push({
      ...tarea,
      vencida,
      diasDeRetraso: vencida ? diasEntre(tarea.vence, hoy) : 0,
    });
  }

  return porDia;
}

/**
 * Los días enteros que hay entre dos fechas `YYYY-MM-DD`.
 *
 * Se cuentan en UTC a propósito: dos medianoches locales separadas por un
 * cambio de horario distan 23 o 25 horas, y dividir entre 24 devolvería 0 días
 * de retraso para algo que lleva uno.
 */
export function diasEntre(desde: string, hasta: string): number {
  const dia = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / dia);
}

/** Los siete días de una semana que empieza en `lunes`, como texto ISO. */
export function diasDeLaSemana(lunes: string): string[] {
  const inicio = Date.parse(`${lunes}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(inicio + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
}

/**
 * El día de una fecha, en el reloj de quien mira y no en UTC.
 *
 * `toISOString().slice(0, 10)` parece lo obvio y está mal cinco horas al día
 * en Ecuador: a las siete de la tarde del 22 ya es día 23 en UTC, así que
 * «hoy» cambiaría cada tarde y lo pendiente de mañana se pintaría como
 * vencido hoy.
 */
export function diaLocal(fecha: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}
