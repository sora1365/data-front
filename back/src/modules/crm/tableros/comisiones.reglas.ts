/**
 * El cálculo de metas y comisiones.
 *
 * Puro, porque es dinero que va a la nómina de alguien: tiene que poder
 * comprobarse con cuatro ventas escritas a mano y sin base de datos delante.
 */

export interface ReglaDeComision {
  codigo: string;
  nombre: string;
  producto: string | null;
  marca: string | null;
  porcentaje: number;
  desde_cumplimiento: number;
}

export interface VentaParaComision {
  producto: string;
  marca: string;
  monto: number | null;
}

/**
 * Qué regla le toca a una venta: la más específica.
 *
 * Producto gana a marca, y marca gana a la general. Sin ese orden, una regla
 * general del 5 % y una de producto del 8 % son dos respuestas correctas a la
 * misma venta, y la comisión depende de en qué orden salieran de la consulta.
 */
export function reglaAplicable(
  reglas: ReglaDeComision[],
  venta: VentaParaComision,
): ReglaDeComision | null {
  const candidatas = reglas.filter(
    (r) =>
      (r.producto === null || r.producto === venta.producto) &&
      (r.marca === null || r.marca === venta.marca),
  );
  if (candidatas.length === 0) return null;

  const peso = (r: ReglaDeComision) => (r.producto ? 2 : 0) + (r.marca ? 1 : 0);
  return [...candidatas].sort((a, b) => peso(b) - peso(a))[0];
}

/** Qué parte de la meta se lleva cumplida. `null` si no hay meta que comparar. */
export function cumplimiento(vendido: number, meta: number | null): number | null {
  if (!meta || meta <= 0) return null;
  return redondear((vendido / meta) * 100);
}

export interface LineaDeComision {
  regla: string | null;
  base: number;
  porcentaje: number;
  comision: number;
  /** Por qué no paga, cuando no paga. */
  motivo: string | null;
}

/**
 * Lo que paga una venta.
 *
 * `cumple` es el porcentaje de la meta alcanzado en el mes. Una regla con
 * `desde_cumplimiento` por encima de eso no paga, y se dice: una comisión en
 * cero sin explicación se lee como un error del sistema y acaba en una
 * reclamación.
 *
 * Sin meta puesta, el umbral no se puede evaluar. Se paga igual, porque lo
 * contrario sería no pagarle a alguien por un dato que la empresa no cargó.
 */
export function comisionDeVenta(
  venta: VentaParaComision,
  reglas: ReglaDeComision[],
  cumple: number | null,
): LineaDeComision {
  const base = Number(venta.monto ?? 0);
  const regla = reglaAplicable(reglas, venta);

  if (!regla) {
    return { regla: null, base, porcentaje: 0, comision: 0, motivo: 'Sin regla aplicable' };
  }

  if (regla.desde_cumplimiento > 0 && cumple !== null && cumple < regla.desde_cumplimiento) {
    return {
      regla: regla.codigo,
      base,
      porcentaje: regla.porcentaje,
      comision: 0,
      motivo: `Paga desde el ${regla.desde_cumplimiento}% de la meta`,
    };
  }

  return {
    regla: regla.codigo,
    base,
    porcentaje: regla.porcentaje,
    comision: redondear((base * regla.porcentaje) / 100),
    motivo: null,
  };
}

export interface ResumenDeComercial {
  comercial: string;
  meta: number | null;
  cobrado: number;
  porCobrar: number;
  cumplimiento: number | null;
  comision: number;
  comisionEnCamino: number;
}

/**
 * Lo de cada comercial en el mes.
 *
 * **La comisión se calcula sobre lo cobrado**, no sobre lo ganado: pagar por
 * una venta que todavía no entró es adelantar dinero contra una factura que
 * puede no cobrarse, y descontarlo después del sueldo de alguien es una
 * conversación que no se quiere tener.
 *
 * Lo ganado y pendiente de cobro se devuelve aparte, como comisión «en
 * camino», porque es lo que el comercial sí quiere ver y lo que evita que el
 * número de arriba parezca un error el mes que se vendió mucho y se cobró
 * tarde.
 *
 * El cumplimiento se mide sobre lo cobrado por lo mismo: si se midiera sobre
 * lo ganado, el umbral de la comisión se destrabaría con ventas que nadie ha
 * pagado.
 */
export function resumenDeComercial(
  comercial: string,
  meta: number | null,
  cobradas: VentaParaComision[],
  porCobrar: VentaParaComision[],
  reglas: ReglaDeComision[],
): ResumenDeComercial {
  const suma = (ventas: VentaParaComision[]) =>
    ventas.reduce((total, v) => total + Number(v.monto ?? 0), 0);

  const cobrado = redondear(suma(cobradas));
  const cumple = cumplimiento(cobrado, meta);

  const comision = cobradas.reduce(
    (total, v) => total + comisionDeVenta(v, reglas, cumple).comision,
    0,
  );
  const enCamino = porCobrar.reduce(
    (total, v) => total + comisionDeVenta(v, reglas, cumple).comision,
    0,
  );

  return {
    comercial,
    meta,
    cobrado,
    porCobrar: redondear(suma(porCobrar)),
    cumplimiento: cumple,
    comision: redondear(comision),
    comisionEnCamino: redondear(enCamino),
  };
}

/**
 * Céntimos, no más.
 *
 * Sin redondear, sumar porcentajes en coma flotante deja comisiones de
 * 148.00000000000003, y ese número acaba impreso en un recibo.
 */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
