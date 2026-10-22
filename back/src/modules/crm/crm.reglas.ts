/**
 * Las reglas del CRM que no se ven al leer una consulta.
 *
 * Viven fuera del servicio porque son las únicas partes con decisiones de
 * negocio de verdad —el resto es SQL— y porque así se pueden probar sin
 * levantar una base de datos.
 */

export interface EtapaDestino {
  es_ganada: boolean;
  es_perdida: boolean;
}

export type EstadoComercial = 'cliente' | 'en_gestion' | 'no_contactar';

/**
 * Qué estado comercial queda tras mover una oportunidad de etapa.
 *
 * - **Ganar deja al sujeto como cliente.** Es el único punto del sistema donde
 *   alguien pasa a cliente sin que nadie lo marque a mano.
 * - **Perder no devuelve a nadie a la lista de trabajo.** Perder una venta no
 *   borra que se habló con ese cliente, y puede tener otras oportunidades
 *   abiertas; devolverlo a «sin gestionar» haría que lo volvieran a llamar
 *   cinco unidades distintas.
 * - **`no_contactar` no se pisa nunca.** Si alguien pidió no ser contactado,
 *   ganar o perder una venta vieja no revoca esa petición.
 *
 * Devuelve `null` cuando no hay que tocar nada.
 */
export function estadoTrasEtapa(
  etapa: EtapaDestino,
  estadoActual: EstadoComercial | null,
): EstadoComercial | null {
  if (estadoActual === 'no_contactar') return null;
  if (etapa.es_ganada) return estadoActual === 'cliente' ? null : 'cliente';
  return null;
}

/**
 * Qué estado comercial queda al abrir una oportunidad.
 *
 * Abrirla es, por definición, empezar a gestionar. A quien ya es cliente no se
 * le degrada a «en gestión» por venderle algo más.
 */
export function estadoAlAbrir(estadoActual: EstadoComercial | null): EstadoComercial | null {
  if (estadoActual === 'cliente' || estadoActual === 'no_contactar') return null;
  return 'en_gestion';
}

/** Una etapa con las oportunidades que le tocan y lo que suman. */
export interface ColumnaTablero<T> {
  codigo: string;
  oportunidades: T[];
  monto: number;
}

/**
 * Reparte las oportunidades en sus columnas.
 *
 * Las etapas mandan, no los datos: una etapa sin ninguna oportunidad sigue
 * siendo una columna. Si se agrupara por lo que viene, «propuesta enviada»
 * desaparecería del tablero justo el día en que no hay ninguna, que es el día
 * en que hay que mirarla.
 *
 * Una oportunidad en una etapa que ya no existe no se pierde: cae en la
 * primera. Descartarla la haría invisible sin que nada fallara.
 */
export function repartirEnColumnas<
  T extends { etapa: string; monto?: string | number | null },
>(etapas: { codigo: string }[], oportunidades: T[]): ColumnaTablero<T>[] {
  const porEtapa = new Map<string, T[]>(etapas.map((e) => [e.codigo, []]));
  for (const o of oportunidades) {
    const destino = porEtapa.has(o.etapa) ? o.etapa : etapas[0]?.codigo;
    if (destino !== undefined) porEtapa.get(destino)!.push(o);
  }
  return etapas.map((e) => {
    const suyas = porEtapa.get(e.codigo) ?? [];
    return {
      codigo: e.codigo,
      oportunidades: suyas,
      // Se suma aquí y no en la pantalla: con los montos en nulo, sumarlos en
      // JavaScript del lado del cliente da NaN sin que nada falle.
      monto: suyas.reduce((acc, o) => acc + Number(o.monto ?? 0), 0),
    };
  });
}
