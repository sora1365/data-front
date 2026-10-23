/**
 * La cuenta de un cotizador.
 *
 * Tareas con tiempos, por el costo de la hora, más el margen. Puro y probado
 * porque es el precio que se le va a ofrecer a un cliente: si esta función se
 * equivoca, se equivoca en dinero y nadie lo nota hasta que el servicio sale
 * a pérdida.
 */

export interface TareaDeCotizador {
  orden: number;
  nombre: string;
  horas_fijas: number;
  horas_por_unidad: number;
  /** El código de la variable que multiplica, o null si la tarea es fija. */
  variable: string | null;
  /** El costo de esta tarea, si su perfil no cuesta lo mismo que el resto. */
  costo_hora: number | null;
}

export interface Cotizador {
  costo_hora: number;
  margen: number;
  modo_margen: 'sobre_costo' | 'sobre_precio';
}

export interface LineaCalculada {
  orden: number;
  nombre: string;
  horas: number;
  costo_hora: number;
  costo: number;
  /** Qué variable la movió y con qué valor, para poder explicar el número. */
  variable: string | null;
  valor: number | null;
}

export interface Cotizacion {
  detalle: LineaCalculada[];
  horas: number;
  costo: number;
  margen: number;
  modo_margen: Cotizador['modo_margen'];
  /** Lo que se cobra, sin IVA. */
  precio: number;
  /** La ganancia en dinero, que es lo que se mira al negociar un descuento. */
  ganancia: number;
}

function centimos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function horas(valor: number): number {
  // Dos decimales: un cuarto de hora es la unidad más pequeña que alguien
  // defiende en una reunión, y más decimales sólo ensucian la explicación.
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Las horas de una tarea con los valores de esta empresa.
 *
 * `horas_fijas` es lo que cuesta hacerla aunque la empresa no mueva nada, y
 * `horas_por_unidad` lo que añade cada transacción, empleado o sucursal. Una
 * tarea que apunta a una variable que no existe cuenta **sólo sus horas
 * fijas**: es un error de configuración, y la alternativa —multiplicar por
 * cero sin avisar o reventar— esconde el problema o tira la cotización.
 */
export function horasDeTarea(tarea: TareaDeCotizador, valores: Record<string, number>): number {
  const fijas = Number(tarea.horas_fijas ?? 0);
  if (!tarea.variable) return horas(fijas);

  const valor = Number(valores[tarea.variable] ?? 0);
  return horas(fijas + Number(tarea.horas_por_unidad ?? 0) * valor);
}

/**
 * Qué está mal configurado en un cotizador.
 *
 * Se comprueba al calcular y se devuelve junto al resultado, no en lugar de
 * él: un cotizador a medio configurar tiene que poder probarse, pero quien lo
 * use tiene que ver que una tarea está multiplicando por una variable que
 * nadie pregunta.
 */
export function problemasDeConfiguracion(
  tareas: TareaDeCotizador[],
  variables: { codigo: string }[],
): string[] {
  const conocidas = new Set(variables.map((v) => v.codigo));
  const problemas: string[] = [];

  for (const tarea of tareas) {
    if (tarea.variable && !conocidas.has(tarea.variable)) {
      problemas.push(
        `«${tarea.nombre}» multiplica por «${tarea.variable}», que no es una variable de este cotizador.`,
      );
    }
    if (tarea.variable && !(Number(tarea.horas_por_unidad) > 0)) {
      problemas.push(
        `«${tarea.nombre}» apunta a «${tarea.variable}» pero no suma horas por unidad: la variable no cambia nada.`,
      );
    }
  }

  if (tareas.length === 0) problemas.push('El cotizador no tiene ninguna tarea.');
  return problemas;
}

/**
 * El precio a partir del costo.
 *
 * «30 % de margen» significa dos cosas distintas y las dos son normales:
 * cargar un 30 % sobre el costo (100 → 130) o que la ganancia sea el 30 % del
 * precio (100 → 142,86). Dejarlo implícito es cotizar un 10 % por debajo de lo
 * que alguien cree, así que el modo se declara y se guarda con la cotización.
 */
export function precioDesdeCosto(
  costo: number,
  margen: number,
  modo: Cotizador['modo_margen'],
): number {
  if (modo === 'sobre_precio') {
    // Un margen del 100 % sobre el precio no tiene solución: la ganancia sería
    // el precio entero y el costo cero. Se trata como «sin margen» antes de
    // dividir por cero y devolver infinito.
    if (margen >= 100) return centimos(costo);
    return centimos(costo / (1 - margen / 100));
  }
  return centimos(costo * (1 + margen / 100));
}

/**
 * La cotización completa.
 *
 * El costo se redondea **por tarea** y después se suma, por lo mismo que en
 * las proformas: el total tiene que cuadrar con lo que se ve escrito línea a
 * línea, o la conversación se va a lo que no es.
 */
export function calcularCotizacion(
  cotizador: Cotizador,
  tareas: TareaDeCotizador[],
  valores: Record<string, number>,
): Cotizacion {
  const detalle = [...tareas]
    .sort((a, b) => a.orden - b.orden)
    .map((tarea) => {
      const suyas = horasDeTarea(tarea, valores);
      const costoHora = Number(tarea.costo_hora ?? cotizador.costo_hora);
      return {
        orden: tarea.orden,
        nombre: tarea.nombre,
        horas: suyas,
        costo_hora: costoHora,
        costo: centimos(suyas * costoHora),
        variable: tarea.variable,
        valor: tarea.variable ? Number(valores[tarea.variable] ?? 0) : null,
      };
    });

  const totalHoras = horas(detalle.reduce((suma, l) => suma + l.horas, 0));
  const costo = centimos(detalle.reduce((suma, l) => suma + l.costo, 0));
  const precio = precioDesdeCosto(costo, Number(cotizador.margen), cotizador.modo_margen);

  return {
    detalle,
    horas: totalHoras,
    costo,
    margen: Number(cotizador.margen),
    modo_margen: cotizador.modo_margen,
    precio,
    ganancia: centimos(precio - costo),
  };
}

/**
 * Los valores con los que se va a calcular: lo que escribió la persona, y el
 * valor por defecto de la variable para lo que no escribió.
 *
 * Faltando una variable, lo que se calcula es un precio con un cero dentro, y
 * un cero en «transacciones al mes» da una cotización baratísima que nadie
 * mira dos veces. El defecto es un número plausible, no cero.
 */
export function valoresConDefecto(
  variables: { codigo: string; valor_defecto: number }[],
  entradas: Record<string, unknown>,
): Record<string, number> {
  const valores: Record<string, number> = {};
  for (const variable of variables) {
    const entrada = Number(entradas?.[variable.codigo]);
    valores[variable.codigo] = Number.isFinite(entrada) ? entrada : Number(variable.valor_defecto);
  }
  return valores;
}
