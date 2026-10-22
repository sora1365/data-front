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

export type EstadoVenta = 'pendiente_facturacion' | 'facturada' | 'cobrada' | 'anulada';

/**
 * Si se puede sacar una oportunidad de «ganada».
 *
 * Mientras la venta sólo está pendiente de facturar, rectificar es gratis: no
 * ha salido nada al mundo. En cuanto el contable emitió la factura deja de
 * serlo —existe un documento con efectos tributarios—, y un cambio de etapa en
 * el CRM no puede fingir que no pasó. A partir de ahí la corrección es una nota
 * de crédito en el contable, no un arrastre de tarjeta.
 *
 * Una venta anulada no bloquea: ya se deshizo por el camino bueno.
 */
export function puedeDesgalardonar(estadoVenta: EstadoVenta | null): boolean {
  return estadoVenta === null || estadoVenta === 'pendiente_facturacion' || estadoVenta === 'anulada';
}

/**
 * Qué transiciones de la venta admite el módulo contable.
 *
 * Es una máquina de estados pequeña y explícita porque la alternativa —aceptar
 * cualquier `estado` que llegue por el cuerpo— deja marcar como cobrada una
 * venta que nadie facturó, y entonces el pendiente de cobro miente.
 */
const TRANSICIONES: Record<EstadoVenta, EstadoVenta[]> = {
  pendiente_facturacion: ['facturada', 'anulada'],
  facturada: ['cobrada', 'anulada'],
  cobrada: [],
  anulada: [],
};

export function puedePasarA(desde: EstadoVenta, hasta: EstadoVenta): boolean {
  return TRANSICIONES[desde]?.includes(hasta) ?? false;
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

// --------------------------------------------------------------- interacciones

/**
 * El canal con el que el sistema firma lo que hace él.
 *
 * `registrarInteraccionDeEtapa` escribe con este canal cuando una tarjeta se
 * mueve. Nadie puede escribirlo a mano: si se pudiera, cualquiera podría
 * fabricar un «de propuesta a ganada» que nunca pasó, y el historial dejaría
 * de servir precisamente para lo que se guarda —reconstruir qué ocurrió sin
 * tener que creerle a nadie.
 */
export const CANAL_SISTEMA = 'sistema';

/**
 * Por dónde se habló con el cliente.
 *
 * Es una lista blanca y no un `CHECK` en la tabla a propósito. WhatsApp y
 * correo van a entrar solos, desde la integración y no desde un formulario, y
 * cada canal nuevo sería una migración con `ALTER TABLE` sobre una tabla que
 * sólo crece. Aquí es una línea.
 *
 * Lo que no es negociable es que sea cerrada: con texto libre, «llamada»,
 * «Llamada», «tel» y «telefónica» son cuatro canales distintos, y la pregunta
 * de por dónde entran las ventas deja de tener respuesta.
 */
export const CANALES = [
  'llamada',
  'whatsapp',
  'correo',
  'reunion',
  'visita',
  'otro',
] as const;

export type Canal = (typeof CANALES)[number];

export type Direccion = 'entrante' | 'saliente';

export const DIRECCIONES: Direccion[] = ['entrante', 'saliente'];

/**
 * Si una persona puede anotar una interacción con este canal.
 *
 * Deja fuera `sistema` aunque llegue bien escrito: el canal del sistema no se
 * teclea.
 */
export function esCanalDeMano(canal: unknown): canal is Canal {
  return typeof canal === 'string' && (CANALES as readonly string[]).includes(canal);
}

export function esDireccion(direccion: unknown): direccion is Direccion {
  return typeof direccion === 'string' && DIRECCIONES.includes(direccion as Direccion);
}

/**
 * Hasta cuándo se admite la fecha de una interacción.
 *
 * Anotar hacia atrás es el caso normal: se llama el viernes y se apunta el
 * lunes. Hacia adelante no, porque una llamada que todavía no ha ocurrido no
 * es historial sino una tarea, que tiene su propia tabla con `due_date`. Si se
 * admitiera, el historial de una venta parada enseñaría actividad futura y
 * «¿desde cuándo no se le llama?» pasaría a contestarse con una llamada que
 * nadie hizo.
 *
 * El margen de un minuto absorbe el desfase entre el reloj del navegador, que
 * es quien manda la fecha, y el del servidor, que es quien la juzga.
 */
const MARGEN_RELOJ_MS = 60_000;

export function fechaDeInteraccionValida(ocurridoEn: Date, ahora: Date): boolean {
  return ocurridoEn.getTime() <= ahora.getTime() + MARGEN_RELOJ_MS;
}
