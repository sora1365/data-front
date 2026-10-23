/**
 * Las reglas de una secuencia de seguimiento.
 *
 * Puras: lo que decide si un plan de seguimiento sirve es en qué días caen sus
 * pasos y cuándo hay que parar, y las dos cosas se pueden probar sin base de
 * datos ni reloj.
 */

export interface Paso {
  orden: number;
  dia: number;
  canal: string;
  texto: string;
}

export interface PasoConFecha extends Paso {
  /** El día en que vence, como texto `YYYY-MM-DD`. */
  vence: string;
  /** Si se movió por caer en fin de semana. */
  movido: boolean;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Un día `YYYY-MM-DD` como instante UTC, que es donde se cuentan los días. */
function aUtc(dia: string): number {
  return Date.parse(`${dia}T00:00:00Z`);
}

function comoDia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * El día de la semana, contando el lunes como 0.
 *
 * Se mira en UTC porque los días ya vienen como texto sin zona: convertirlos
 * a hora local aquí los correría un día en medio mundo.
 */
function diaDeLaSemana(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * En qué día cae cada paso, contando desde el arranque.
 *
 * Los días se cuentan **desde el arranque y no desde el paso anterior**, que
 * es como está guardado y por una razón: encadenando desde el anterior, un
 * retraso de tres días en la primera llamada corre todo lo que viene detrás y
 * el plan de una semana dura diez días sin que nadie lo decida.
 *
 * Lo que cae en sábado o domingo se mueve al lunes. Una tarea comercial con
 * vencimiento en fin de semana no se hace: se mira el lunes ya vencida, en
 * rojo, y el rojo deja de significar que algo va mal.
 */
export function fechasDePasos(pasos: Paso[], arranque: string): PasoConFecha[] {
  const base = aUtc(arranque);
  if (Number.isNaN(base)) throw new Error(`Fecha de arranque inválida: ${arranque}`);

  return [...pasos]
    .sort((a, b) => a.dia - b.dia || a.orden - b.orden)
    .map((paso) => {
      const caeEn = base + paso.dia * DIA_MS;
      const dia = diaDeLaSemana(caeEn);
      // 5 es sábado y 6 domingo: dos días y uno, respectivamente, hasta el lunes.
      const empuje = dia === 5 ? 2 : dia === 6 ? 1 : 0;
      return {
        ...paso,
        vence: comoDia(caeEn + empuje * DIA_MS),
        movido: empuje > 0,
      };
    });
}

/**
 * Si un seguimiento tiene que cortarse por lo que pasó con la venta.
 *
 * Ganada o perdida, el plan sobra: seguir llamando a quien ya compró —o a
 * quien ya dijo que no— es la forma más rápida de que el equipo deje de mirar
 * las tareas del CRM. Devuelve el motivo, que se guarda, porque «se cortó»
 * sin más no distingue haber vendido de haberse rendido.
 */
export function motivoDeCorte(etapa: {
  codigo: string;
  es_ganada: boolean;
  es_perdida: boolean;
}): string | null {
  if (etapa.es_ganada) return 'La venta se ganó';
  if (etapa.es_perdida) return 'La venta se perdió';
  return null;
}

/**
 * Si una secuencia puede arrancar sobre esta oportunidad.
 *
 * Devuelve el impedimento, en palabras, o null. Es una función y no cuatro
 * `if` repartidos porque el disparo automático y el botón de la pantalla
 * tienen que decidir lo mismo: si no, una secuencia que no se puede iniciar a
 * mano salta sola igual.
 */
export function impedimentoParaIniciar(
  secuencia: { activa: boolean; marca: string | null; producto: string | null },
  oportunidad: { marca: string; producto: string; archivada: boolean; cerrada: boolean },
): string | null {
  if (!secuencia.activa) return 'Esa secuencia está desactivada.';
  if (oportunidad.archivada) return 'La oportunidad está archivada.';
  if (oportunidad.cerrada) return 'La oportunidad ya está cerrada.';
  if (secuencia.marca && secuencia.marca !== oportunidad.marca) {
    return 'Esa secuencia es de otra marca.';
  }
  if (secuencia.producto && secuencia.producto !== oportunidad.producto) {
    return 'Esa secuencia es de otro producto.';
  }
  return null;
}

/**
 * Si el seguimiento ya terminó: no le queda ningún paso por hacer.
 *
 * Se mira sobre las tareas y no sobre las fechas: un plan cuyo último día ya
 * pasó no está terminado si nadie hizo la llamada, y darlo por terminado
 * borraría justo el pendiente que importa.
 */
export function estaTerminado(tareas: { hecha: boolean }[]): boolean {
  return tareas.length > 0 && tareas.every((t) => t.hecha);
}
