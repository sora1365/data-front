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
  /** Una opción que el cliente puede añadir al aceptar. */
  opcional?: boolean;
  /** Si el cliente la eligió. En nulo, todavía no ha contestado. */
  incluida?: boolean | null;
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

/**
 * Si la línea entra en la suma.
 *
 * Una opcional sólo suma cuando el cliente la eligió. Mientras no conteste,
 * el total que ve es el de lo que no es opcional: ofrecerle un precio que ya
 * incluye los extras es cobrarle por defecto lo que no ha pedido.
 */
export function cuentaEnElTotal(linea: Pick<LineaDeProforma, 'opcional' | 'incluida'>): boolean {
  return !linea.opcional || linea.incluida === true;
}

export function calcularTotales(lineas: LineaDeProforma[]): TotalesDeProforma {
  const calculadas = lineas.filter(cuentaEnElTotal).map((l) => {
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

export type EstadoProforma =
  | 'borrador'
  | 'enviada'
  | 'aceptada'
  | 'rechazada'
  | 'anulada'
  | 'reemplazada';

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
  /** Qué firma le falta al descuento, si le falta alguna. */
  aprobacion_pendiente?: NivelDeDescuento | null;
}, hoy: string, canal: CanalDeEnvio = 'correo'): string[] {
  const problemas: string[] = [];
  // Por WhatsApp el correo sobra, pero el que la manda necesita un teléfono:
  // eso lo comprueba quien compone el enlace, que es quien lo tiene.
  if (canal === 'correo' && !proforma.correo?.trim()) {
    problemas.push('No hay correo a donde mandarla.');
  }
  if (proforma.lineas.length === 0) problemas.push('No tiene ninguna línea.');
  if (!(proforma.total > 0)) problemas.push('El total es cero.');
  if (estaVencida(proforma.valida_hasta, hoy)) {
    problemas.push('La fecha de validez ya pasó: ponle una nueva antes de enviarla.');
  }
  if (proforma.aprobacion_pendiente) {
    problemas.push(
      `El descuento necesita la firma de ${NOMBRE_DE_NIVEL[proforma.aprobacion_pendiente]} antes de salir.`,
    );
  }
  return problemas;
}

export const CANALES_DE_ENVIO = ['correo', 'whatsapp'] as const;
export type CanalDeEnvio = (typeof CANALES_DE_ENVIO)[number];

// ---------------------------------------------------------------- versiones

/**
 * Sobre qué proforma se puede hacer una versión nueva.
 *
 * Sobre la que el cliente ya tiene —enviada, vencida o rechazada—, que es
 * cuando se negocia. Un borrador se edita, no se versiona; una aceptada ya es
 * una venta, y cambiarla es una nota de crédito o una venta nueva; una anulada
 * fue un error nuestro, y copiarla copia el error.
 */
export function sePuedeVersionar(estado: EstadoProforma): boolean {
  return estado === 'enviada' || estado === 'rechazada';
}

/**
 * El número de una versión: `P-2026-0007-v2`.
 *
 * Mantiene el número de la primera para que cliente y comercial hablen de «la
 * 0007» durante toda la negociación, y el sufijo dice cuál de ellas. La
 * primera no lleva sufijo: es el número que el cliente ya conoce.
 */
export function numeroDeVersion(numeroOriginal: string, version: number): string {
  const base = numeroOriginal.replace(/-v\d+$/, '');
  return version <= 1 ? base : `${base}-v${version}`;
}

// ---------------------------------------------------------- motivos de rechazo

/**
 * Por qué dijo que no, de una lista cerrada.
 *
 * Con texto libre, «caro», «el precio», «muy costoso» y «presupuesto» son
 * cuatro motivos, y la pregunta de por qué se pierden las propuestas no tiene
 * respuesta. Lo que el cliente quiera añadir con sus palabras va aparte, en
 * `motivo`.
 */
export const MOTIVOS_DE_RECHAZO = {
  precio: 'El precio',
  competencia: 'Eligió a otro proveedor',
  presupuesto: 'No tiene presupuesto ahora',
  alcance: 'No es lo que necesita',
  plazo: 'Los plazos no le sirven',
  pospuesto: 'Lo deja para más adelante',
  otro: 'Otro motivo',
} as const;

export type MotivoDeRechazo = keyof typeof MOTIVOS_DE_RECHAZO;

export function esMotivoDeRechazo(valor: unknown): valor is MotivoDeRechazo {
  return (
    typeof valor === 'string' && Object.prototype.hasOwnProperty.call(MOTIVOS_DE_RECHAZO, valor)
  );
}

// --------------------------------------------------- aprobación de descuentos

export type NivelDeDescuento = 'libre' | 'supervisor' | 'direccion';

export const NOMBRE_DE_NIVEL: Record<NivelDeDescuento, string> = {
  libre: 'nadie',
  supervisor: 'su supervisor',
  direccion: 'dirección',
};

/**
 * El descuento que hay que justificar: el mayor de las líneas.
 *
 * El de la línea y no el medio de la proforma. Con el medio, un 60 % sobre
 * una línea pequeña se diluye entre las grandes y pasa sin firma, y es
 * justo el que alguien querrá explicar después.
 *
 * Las opcionales cuentan aunque el cliente aún no las haya elegido: si las
 * elige, el descuento ya estaba ofrecido.
 */
export function descuentoMayor(lineas: Pick<LineaDeProforma, 'descuento_pct'>[]): number {
  return lineas.reduce((mayor, l) => Math.max(mayor, Number(l.descuento_pct ?? 0)), 0);
}

/**
 * Quién tiene que firmar un descuento.
 *
 * `topes` dice hasta qué porcentaje llega cada nivel. Se recorre de menor a
 * mayor y gana el primero que lo cubre; por encima de todos los topes manda
 * dirección, que es quien puede decidir regalar el servicio.
 */
export function nivelRequerido(
  descuentoPct: number,
  topes: { nivel: NivelDeDescuento; hasta_pct: number }[],
): NivelDeDescuento {
  const orden: NivelDeDescuento[] = ['libre', 'supervisor', 'direccion'];
  for (const nivel of orden) {
    const tope = topes.find((t) => t.nivel === nivel);
    if (tope && descuentoPct <= Number(tope.hasta_pct)) return nivel;
  }
  return 'direccion';
}

/**
 * Si la firma que hay sigue cubriendo el descuento de ahora.
 *
 * Se aprobó un porcentaje, no la proforma: si después alguien sube el
 * descuento, la firma vieja no lo cubre. Bajarlo, en cambio, no pide firmar
 * otra vez.
 */
export function firmaVigente(descuentoPct: number, aprobadoPct: number | null): boolean {
  return aprobadoPct !== null && aprobadoPct !== undefined && descuentoPct <= Number(aprobadoPct);
}

/**
 * Si `aprobador` puede firmar el descuento de una proforma de `autor`.
 *
 * `cadena` son los supervisores de quien la hizo, del más cercano al más
 * alto. La jerarquía es la de `crm.comercial.supervisor` y no un rol: el CRM
 * no tiene roles —la autenticación la pone la plataforma—, y lo que se
 * comprueba aquí es un circuito de firmas, no un permiso.
 *
 * - **supervisor**: cualquiera por encima en su cadena.
 * - **dirección**: el de arriba del todo, el que no responde a nadie.
 * - Quien no tiene a nadie por encima firma lo suyo: ya es dirección, y
 *   exigirle otra firma lo deja sin poder vender.
 * - Nadie firma lo suyo teniendo a alguien por encima. Es la regla entera.
 */
export function puedeAprobar(
  nivel: NivelDeDescuento,
  autor: string,
  aprobador: string,
  cadena: string[],
): { permitido: boolean; motivo?: string } {
  if (nivel === 'libre') return { permitido: true };

  if (cadena.length === 0) {
    return aprobador === autor
      ? { permitido: true }
      : {
          permitido: false,
          motivo: `${autor} no responde a nadie: el descuento lo firma ${autor}.`,
        };
  }

  if (aprobador === autor) {
    return { permitido: false, motivo: 'Nadie firma el descuento de su propia proforma.' };
  }

  if (nivel === 'supervisor') {
    return cadena.includes(aprobador)
      ? { permitido: true }
      : {
          permitido: false,
          motivo: `Lo firma alguien por encima de ${autor}: ${cadena.join(', ')}.`,
        };
  }

  const cima = cadena[cadena.length - 1];
  return aprobador === cima
    ? { permitido: true }
    : { permitido: false, motivo: `Un descuento así lo firma dirección (${cima}).` };
}

/**
 * La cadena de supervisores de alguien, del más cercano al más alto.
 *
 * Se corta si da la vuelta: la tabla impide supervisarse a uno mismo, pero no
 * un círculo de dos, y un bucle aquí colgaría la aprobación entera.
 */
export function cadenaDeSupervisores(
  usuario: string,
  supervisorDe: Map<string, string | null>,
): string[] {
  const cadena: string[] = [];
  const vistos = new Set([usuario]);
  let actual = supervisorDe.get(usuario) ?? null;
  while (actual && !vistos.has(actual)) {
    cadena.push(actual);
    vistos.add(actual);
    actual = supervisorDe.get(actual) ?? null;
  }
  return cadena;
}

// ----------------------------------------------------------------- WhatsApp

/**
 * El teléfono en el formato que entiende `wa.me`: sólo dígitos, con país.
 *
 * Los números de aquí se guardan como se dictan —`099 123 4567`—, y `wa.me`
 * con el cero delante abre un chat con nadie. Un número local de diez dígitos
 * que empieza por cero es de Ecuador: se cambia el cero por 593.
 */
export function telefonoParaWhatsapp(telefono: string | null | undefined): string | null {
  const digitos = String(telefono ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return null;
  if (digitos.length === 10 && digitos.startsWith('0')) return `593${digitos.slice(1)}`;
  if (digitos.length === 9 && digitos.startsWith('9')) return `593${digitos}`;
  return digitos;
}
