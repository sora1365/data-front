/**
 * Las cuentas del embudo.
 *
 * Puras y sin base de datos: lo que decide si un embudo dice la verdad no es
 * la consulta sino qué se cuenta como «llegó hasta aquí», y eso hay que poder
 * probarlo con cuatro filas en la mano.
 */

export interface PasoDeEtapa {
  oportunidad: number | string;
  hasta: string;
  ocurrido_en: string | Date;
}

export interface Etapa {
  codigo: string;
  nombre: string;
  orden: number;
  es_ganada: boolean;
  es_perdida: boolean;
}

export interface TramoDelEmbudo {
  codigo: string;
  nombre: string;
  /** Oportunidades que llegaron a esta etapa o a cualquiera posterior. */
  llegaron: number;
  /** De las que llegaron a la etapa anterior, qué parte llegó a esta. */
  conversion: number | null;
  /** Las que se quedaron aquí: llegaron y no pasaron de aquí. */
  atascadas: number;
}

/**
 * El embudo: cuántas oportunidades alcanzaron cada etapa.
 *
 * «Alcanzó la etapa X» significa haber estado en X **o en cualquier etapa
 * posterior**, y no haber pasado por un asiento con ese código. Es la
 * diferencia entre un embudo y una lista de anécdotas: una venta que salta de
 * «por contactar» a «negociación» pasó por propuesta aunque nadie moviera la
 * tarjeta hasta ahí, y contándola sólo donde se registró, el embudo enseñaría
 * un agujero en propuesta que no existe.
 *
 * Las etapas terminales —ganada y perdida— se dejan fuera del recorrido: no
 * son escalones del embudo sino los dos desenlaces, y mezclar «perdida» en la
 * secuencia haría que perder contara como avanzar.
 */
export function embudo(etapas: Etapa[], pasos: PasoDeEtapa[]): TramoDelEmbudo[] {
  const recorrido = etapas
    .filter((e) => !e.es_ganada && !e.es_perdida)
    .sort((a, b) => a.orden - b.orden);
  const terminales = new Set(etapas.filter((e) => e.es_ganada).map((e) => e.codigo));

  const ordenDe = new Map(recorrido.map((e, i) => [e.codigo, i]));

  // Hasta dónde llegó cada oportunidad. Ganarla es haber llegado al final:
  // una venta cerrada recorrió el embudo entero por definición.
  const masLejos = new Map<string, number>();
  const ganadas = new Set<string>();
  for (const paso of pasos) {
    const clave = String(paso.oportunidad);
    if (terminales.has(paso.hasta)) ganadas.add(clave);
    const indice = terminales.has(paso.hasta)
      ? recorrido.length - 1
      : ordenDe.get(paso.hasta);
    if (indice === undefined) continue;
    masLejos.set(clave, Math.max(masLejos.get(clave) ?? -1, indice));
  }

  const lejanias = [...masLejos.entries()];

  return recorrido.map((etapa, i) => {
    const llegaron = lejanias.filter(([, lejos]) => lejos >= i).length;
    const anteriores = i === 0 ? null : lejanias.filter(([, l]) => l >= i - 1).length;
    // Una venta ganada nunca está atascada, aunque su último asiento caiga en
    // la última etapa del recorrido: terminó, que es lo contrario de pararse.
    const atascadas = lejanias.filter(
      ([id, lejos]) => lejos === i && !ganadas.has(id),
    ).length;

    return {
      codigo: etapa.codigo,
      nombre: etapa.nombre,
      llegaron,
      conversion: anteriores ? redondear(llegaron / anteriores) : null,
      atascadas,
    };
  });
}

/**
 * Qué parte de las oportunidades de un grupo se ganó.
 *
 * El denominador son las **cerradas**, no todas: contar las que siguen
 * abiertas como si se hubieran perdido hace que el porcentaje suba solo
 * cuando se cierran cosas viejas y baje cada vez que se abre una nueva, que
 * es justo lo contrario de lo que debería medir.
 */
export function tasaDeCierre(ganadas: number, perdidas: number): number | null {
  const cerradas = ganadas + perdidas;
  return cerradas === 0 ? null : redondear(ganadas / cerradas);
}

/** Dos decimales, que es toda la precisión que tiene un porcentaje así. */
function redondear(fraccion: number): number {
  return Math.round(fraccion * 10000) / 100;
}

/**
 * Ordena un desglose de mayor a menor y deja el resto en «otros».
 *
 * Una tabla de veinte filas no se lee; y cortar por las diez primeras sin
 * decirlo deja al que mira sumando mal, porque los totales dejan de cuadrar.
 */
export function conResto<T extends { monto?: number | null; cuenta?: number | null }>(
  filas: (T & { etiqueta: string })[],
  cuantas = 8,
): (T & { etiqueta: string })[] {
  if (filas.length <= cuantas) return filas;

  const ordenadas = [...filas].sort(
    (a, b) => Number(b.monto ?? b.cuenta ?? 0) - Number(a.monto ?? a.cuenta ?? 0),
  );
  const principales = ordenadas.slice(0, cuantas);
  const sobrantes = ordenadas.slice(cuantas);

  const resto = {
    ...sobrantes[0],
    etiqueta: `Otros (${sobrantes.length})`,
    monto: sobrantes.reduce((suma, f) => suma + Number(f.monto ?? 0), 0),
    cuenta: sobrantes.reduce((suma, f) => suma + Number(f.cuenta ?? 0), 0),
  };

  return [...principales, resto];
}
