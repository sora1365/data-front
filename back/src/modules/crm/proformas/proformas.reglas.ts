/**
 * Las cuentas de una proforma.
 *
 * Puras, porque son el número que el cliente va a leer y comparar con su
 * factura. Un céntimo de diferencia entre lo que dice la proforma y lo que
 * dice el contable es una llamada, y el que llama tiene razón.
 */

export interface LineaDeProforma {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  iva_pct: number;
}

export interface LineaCalculada extends LineaDeProforma {
  /** Cantidad por precio, antes del descuento. */
  bruto: number;
  descuento: number;
  /** Lo que entra en el subtotal: bruto menos descuento. */
  base: number;
  iva: number;
  total: number;
}

export interface TotalesDeProforma {
  lineas: LineaCalculada[];
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
}

/**
 * Céntimos.
 *
 * Se redondea **en cada línea** y después se suma, no al revés. Sumando los
 * valores largos y redondeando al final, el total no coincide con la suma de
 * lo que el cliente ve impreso línea a línea, y esa diferencia de un céntimo
 * es exactamente la que hace que alguien llame.
 */
function centimos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function calcularTotales(lineas: LineaDeProforma[]): TotalesDeProforma {
  const calculadas = lineas.map((l) => {
    const bruto = centimos(Number(l.cantidad) * Number(l.precio_unitario));
    const descuento = centimos((bruto * Number(l.descuento_pct ?? 0)) / 100);
    const base = centimos(bruto - descuento);
    const iva = centimos((base * Number(l.iva_pct ?? 0)) / 100);
    return { ...l, bruto, descuento, base, iva, total: centimos(base + iva) };
  });

  const suma = (saca: (l: LineaCalculada) => number) =>
    centimos(calculadas.reduce((total, l) => total + saca(l), 0));

  return {
    lineas: calculadas,
    // El subtotal es el bruto, antes de descuentos: es como se lee un
    // documento comercial, con el descuento visible como una resta y no
    // escondido dentro de un subtotal que ya no cuadra con los precios.
    subtotal: suma((l) => l.bruto),
    descuento: suma((l) => l.descuento),
    iva: suma((l) => l.iva),
    total: suma((l) => l.total),
  };
}

export type EstadoProforma = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'anulada';

/**
 * Qué se puede hacer con una proforma según cómo esté.
 *
 * Una enviada **no se edita**. El cliente tiene en la mano un documento con un
 * número; cambiarle los precios por detrás y que siga llamándose igual es la
 * forma más rápida de perder una discusión sobre lo que se acordó. Para
 * cambiarla se hace otra.
 */
export function sePuedeEditar(estado: EstadoProforma): boolean {
  return estado === 'borrador';
}

export function sePuedeEnviar(estado: EstadoProforma): boolean {
  return estado === 'borrador' || estado === 'enviada';
}

/** Sólo una enviada se acepta o se rechaza: lo que nadie recibió, nadie contesta. */
export function sePuedeResponder(estado: EstadoProforma): boolean {
  return estado === 'enviada';
}

/**
 * Si una proforma ya no vale por la fecha.
 *
 * `valida_hasta` es el último día en que vale, incluido: una oferta «válida
 * hasta el 30» que caduca el 30 por la mañana es una trampa.
 *
 * El vencimiento **no es un estado guardado** sino una comparación con hoy. Un
 * estado `vencida` en la tabla obligaría a un proceso que pase cada noche a
 * cambiarlo, y mientras no pasara, la proforma diría que sigue viva.
 */
export function estaVencida(validaHasta: string, hoy: string): boolean {
  return validaHasta < hoy;
}

/**
 * Lo que una persona ve como estado, que no es sólo la columna.
 *
 * Una enviada cuya fecha pasó se lee «vencida», aunque en la tabla siga
 * diciendo «enviada». Una aceptada no vence nunca: ya se cerró.
 */
export function estadoVisible(
  estado: EstadoProforma,
  validaHasta: string,
  hoy: string,
): EstadoProforma | 'vencida' {
  if (estado === 'enviada' && estaVencida(validaHasta, hoy)) return 'vencida';
  return estado;
}

/**
 * El número del documento: `P-2026-0001`.
 *
 * La numeración se reinicia cada año y se rellena con ceros para que ordene
 * bien como texto. No es la numeración de la factura —esa la lleva el
 * contable, con control del SRI—: esto sólo tiene que identificar una oferta
 * sin ambigüedad.
 */
export function numeroDeProforma(anio: number, correlativo: number): string {
  return `P-${anio}-${String(correlativo).padStart(4, '0')}`;
}

/**
 * Si hay algo que impida mandarla.
 *
 * Se comprueba antes de enviar y se dice todo junto: enviar es irreversible
 * —el correo ya salió— y descubrir de uno en uno que falta el correo, luego
 * que no hay líneas, lleva a mandar la tercera versión por si acaso.
 */
export function problemasParaEnviar(proforma: {
  correo: string | null;
  lineas: unknown[];
  total: number;
  valida_hasta: string;
}, hoy: string): string[] {
  const problemas: string[] = [];
  if (!proforma.correo?.trim()) problemas.push('No hay correo a donde mandarla.');
  if (proforma.lineas.length === 0) problemas.push('No tiene ninguna línea.');
  if (!(proforma.total > 0)) problemas.push('El total es cero.');
  if (estaVencida(proforma.valida_hasta, hoy)) {
    problemas.push('La fecha de validez ya pasó: ponle una nueva antes de enviarla.');
  }
  return problemas;
}
