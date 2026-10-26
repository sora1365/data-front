/**
 * Venta cruzada: qué más venderle a quien ya es cliente.
 *
 * Puras, porque el error aquí es caro de las dos formas. Si sobra, se le
 * ofrece a alguien lo que ya compró —y queda claro que no se le conoce—. Si
 * falta, se deja de vender lo más fácil que hay: lo segundo a quien ya dijo
 * que sí una vez.
 */

export interface ProductoDelCatalogo {
  codigo: string;
  nombre: string;
  /** La marca que lo vende, deducida de lo que ya se ha vendido u ofrecido. */
  marca?: string | null;
  marca_nombre?: string | null;
}

export interface LoQueTiene {
  /** Productos ya comprados y vivos. */
  comprados: string[];
  /** Productos con oportunidad abierta: ya se están trabajando. */
  enCurso: string[];
  /** Productos ofrecidos y rechazados, con la fecha en que se puede volver. */
  rechazados: Record<string, string | null>;
}

export interface Sugerencia extends ProductoDelCatalogo {
  /** Por qué se sugiere, en palabras, para que no sea una lista mágica. */
  motivo: string;
  prioridad: number;
  /** Si es de otra marca que la que ya le vende: eso es la venta cruzada. */
  otraMarca: boolean;
}

/**
 * Qué ofrecerle a un cliente que ya compró.
 *
 * Fuera quedan tres cosas: lo que ya tiene, lo que ya se le está ofreciendo
 * —una oportunidad abierta es alguien trabajándolo, y ofrecerlo otra vez es
 * llamarle dos veces— y lo que rechazó hasta que pase su plazo.
 *
 * El orden es el que convierte: primero lo que el gestor comercial sugiere
 * para esa empresa (cae en un segmento que lo pide), después lo de la misma
 * marca que ya le vende —hay confianza y una sola factura— y al final lo de
 * las otras marcas.
 */
export function cruzadasPara(
  catalogo: ProductoDelCatalogo[],
  tiene: LoQueTiene,
  opciones: {
    sugeridosPorElGestor?: string[];
    marcasDelCliente?: string[];
    hoy: string;
  },
): Sugerencia[] {
  const sugeridos = new Set(opciones.sugeridosPorElGestor ?? []);
  const suyas = new Set(opciones.marcasDelCliente ?? []);
  const comprados = new Set(tiene.comprados);
  const enCurso = new Set(tiene.enCurso);

  return catalogo
    .filter((p) => {
      if (comprados.has(p.codigo)) return false;
      if (enCurso.has(p.codigo)) return false;

      const vuelve = tiene.rechazados[p.codigo];
      // `null` en rechazados es «nunca más»: lo pidió expresamente.
      if (vuelve === null && p.codigo in tiene.rechazados) return false;
      if (vuelve && vuelve > opciones.hoy) return false;

      return true;
    })
    .map((p) => {
      const otraMarca = Boolean(p.marca && suyas.size > 0 && !suyas.has(p.marca));

      if (sugeridos.has(p.codigo)) {
        return {
          ...p,
          motivo: 'El gestor lo propone para esta empresa',
          prioridad: 1,
          otraMarca,
        };
      }
      if (p.marca && suyas.has(p.marca)) {
        return {
          ...p,
          motivo: `Ya le vende ${p.marca_nombre ?? p.marca}`,
          prioridad: 2,
          otraMarca: false,
        };
      }
      return {
        ...p,
        motivo: p.marca_nombre ? `Lo vende ${p.marca_nombre}` : 'Del catálogo',
        prioridad: 3,
        otraMarca,
      };
    })
    .sort((a, b) => a.prioridad - b.prioridad || a.nombre.localeCompare(b.nombre));
}

/**
 * Si vale la pena llamar a este cliente.
 *
 * Un cliente sin nada que ofrecerle no es un problema: es que ya le vendemos
 * todo. Sacarlo de la lista evita que la pantalla se llene de filas sin
 * acción, que es lo que hace que se deje de mirar.
 */
export function valeLaPena(sugerencias: Sugerencia[]): boolean {
  return sugerencias.length > 0;
}

/**
 * Cuánto pesa un cliente para ordenarlos entre sí.
 *
 * Primero quien más compra: no porque los demás no importen, sino porque la
 * siguiente venta a quien ya gasta diez mil es más probable y más grande que
 * la de quien gastó cien. Entre iguales, el que tiene más huecos.
 */
export function ordenarClientes<
  T extends { facturado: number; sugerencias: Sugerencia[] },
>(clientes: T[]): T[] {
  return [...clientes].sort(
    (a, b) => b.facturado - a.facturado || b.sugerencias.length - a.sugerencias.length,
  );
}
