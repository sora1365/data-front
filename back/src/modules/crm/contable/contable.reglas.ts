/**
 * Las reglas de la frontera con el contable.
 *
 * Puras: deciden qué se escribe cuando llega un lote del otro sistema, y eso
 * hay que poder probarlo sin levantar nada. Lo que se equivoque aquí no da
 * error, cambia precios y comisiones en silencio.
 */

export interface ArticuloEntrante {
  codigo?: string;
  nombre?: string;
  descripcion?: string | null;
  unidad?: string | null;
  precio?: number | string | null;
  iva?: number | string | null;
  stock?: number | string | null;
  activo?: boolean;
}

export interface ArticuloLimpio {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  unidad: string | null;
  precio: number | null;
  iva: number | null;
  stock: number | null;
  activo: boolean;
}

export interface Rechazo {
  fila: number;
  codigo: string | null;
  motivo: string;
}

const numero = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * Qué artículos del lote se pueden guardar y cuáles no.
 *
 * Un lote con una fila mala **no se tira entero**: el contable manda su
 * catálogo completo, y rechazar las mil por una sin código deja al CRM sin
 * inventario. Se guarda lo bueno y se devuelve lo rechazado con su motivo,
 * que es lo que permite arreglarlo del otro lado.
 */
export function revisarArticulos(lote: ArticuloEntrante[]): {
  validos: ArticuloLimpio[];
  rechazos: Rechazo[];
} {
  const validos: ArticuloLimpio[] = [];
  const rechazos: Rechazo[] = [];
  const vistos = new Set<string>();

  lote.forEach((entrada, i) => {
    const fila = i + 1;
    const codigo = String(entrada?.codigo ?? '').trim();
    const nombre = String(entrada?.nombre ?? '').trim();

    if (!codigo) {
      rechazos.push({ fila, codigo: null, motivo: 'Sin código.' });
      return;
    }
    if (!nombre) {
      rechazos.push({ fila, codigo, motivo: 'Sin nombre.' });
      return;
    }
    // El mismo código dos veces en el mismo lote: el segundo pisaría al
    // primero sin que nadie lo supiera, y cuál gana dependería del orden.
    if (vistos.has(codigo)) {
      rechazos.push({ fila, codigo, motivo: 'Repetido en este mismo lote.' });
      return;
    }

    const precio = numero(entrada.precio);
    if (precio !== null && precio < 0) {
      rechazos.push({ fila, codigo, motivo: 'Precio negativo.' });
      return;
    }

    const iva = numero(entrada.iva);
    if (iva !== null && (iva < 0 || iva > 100)) {
      rechazos.push({ fila, codigo, motivo: 'IVA fuera de rango.' });
      return;
    }

    vistos.add(codigo);
    validos.push({
      codigo,
      nombre,
      descripcion: entrada.descripcion?.toString().trim() || null,
      unidad: entrada.unidad?.toString().trim() || null,
      precio,
      iva,
      stock: numero(entrada.stock),
      activo: entrada.activo !== false,
    });
  });

  return { validos, rechazos };
}

/**
 * Qué artículos del CRM ya no vienen en el lote.
 *
 * Se devuelven para **desactivarlos, no para borrarlos**: un artículo borrado
 * se lleva por delante las líneas de proforma que lo citaban, y una oferta de
 * hace dos meses tiene que seguir diciendo qué se ofreció aunque el producto
 * ya no se venda.
 */
export function aDesactivar(enElCrm: string[], enElLote: string[]): string[] {
  const llegaron = new Set(enElLote);
  return enElCrm.filter((codigo) => !llegaron.has(codigo));
}

/**
 * El costo de una hora de un perfil, a partir de lo que cuesta al mes.
 *
 * Sueldo más carga patronal, repartido entre las horas que se trabajan. Si el
 * contable ya manda el costo hora calculado, manda el suyo: es él quien sabe
 * qué beneficios entran en el cálculo de esa empresa.
 */
export function costoHoraDeNomina(entrada: {
  costo_hora?: number | null;
  sueldo_mes?: number | null;
  carga_pct?: number | null;
  horas_mes?: number | null;
}): number | null {
  const directo = numero(entrada.costo_hora);
  if (directo !== null && directo >= 0) return redondear(directo);

  const sueldo = numero(entrada.sueldo_mes);
  const horas = numero(entrada.horas_mes);
  if (sueldo === null || horas === null || horas <= 0) return null;

  const carga = numero(entrada.carga_pct) ?? 0;
  return redondear((sueldo * (1 + carga / 100)) / horas);
}

/**
 * De qué sale el costo de una tarea: lo fijado a mano, el perfil, o el
 * cotizador.
 *
 * El orden importa y es el que menos sorprende: un número escrito a propósito
 * en una tarea gana siempre, porque alguien lo puso sabiendo lo que hacía;
 * por debajo manda la nómina, que es la que se actualiza sola.
 */
export function costoHoraDeTarea(
  tarea: { costo_hora?: number | null; perfil?: string | null },
  costosPorPerfil: Record<string, number>,
  costoDelCotizador: number,
): { costo: number; origen: 'tarea' | 'perfil' | 'cotizador' } {
  const propio = numero(tarea.costo_hora);
  if (propio !== null) return { costo: propio, origen: 'tarea' };

  if (tarea.perfil && costosPorPerfil[tarea.perfil] !== undefined) {
    return { costo: costosPorPerfil[tarea.perfil], origen: 'perfil' };
  }

  return { costo: costoDelCotizador, origen: 'cotizador' };
}

export type TipoDeMovimiento = 'facturada' | 'cobrada' | 'anulada';

/**
 * En qué estado queda una venta cuando el contable avisa.
 *
 * Devuelve el estado nuevo o `null` si el aviso no cambia nada, para no
 * reescribir una fila por cada reintento. Cobrar sin haber facturado **sí
 * vale**: hay ventas que se cobran por adelantado y el documento sale
 * después, y rechazarlo obligaría al contable a inventarse una factura para
 * poder registrar el dinero que ya entró.
 */
export function estadoTrasMovimiento(
  estadoActual: string,
  tipo: TipoDeMovimiento,
): string | null {
  if (estadoActual === 'anulada' && tipo !== 'anulada') return null;
  if (tipo === 'anulada') return estadoActual === 'anulada' ? null : 'anulada';
  if (tipo === 'cobrada') return estadoActual === 'cobrada' ? null : 'cobrada';
  // Facturar una venta ya cobrada no la devuelve a «facturada»: el dinero ya
  // entró, y retroceder el estado haría desaparecer la comisión del mes.
  if (estadoActual === 'cobrada') return null;
  return estadoActual === 'facturada' ? null : 'facturada';
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
