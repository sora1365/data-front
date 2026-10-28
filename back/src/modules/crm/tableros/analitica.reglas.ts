/**
 * Las cuentas de la analítica que mira hacia delante.
 *
 * Puras, como las del embudo: un pronóstico que dice un número equivocado no
 * falla, sólo se cree. Lo que decide si dice la verdad —qué entra en cada
 * mes, qué se descuenta, cuándo algo es una alerta— tiene que poder probarse
 * con cinco filas en la mano.
 */

import type { Etapa, PasoDeEtapa } from './tableros.reglas';

// ---------------------------------------------------------------- utilidades

/** El mes de una fecha `YYYY-MM-DD`, como `YYYY-MM`. */
export function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

/** `YYYY-MM` más `n` meses. */
export function sumarMeses(mes: string, n: number): string {
  const [anio, m] = mes.split('-').map(Number);
  const total = anio * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function dias(desde: Date | string, hasta: Date | string): number {
  return (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000;
}

function redondear(valor: number, decimales = 2): number {
  const f = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * f) / f;
}

/** Variación porcentual, o nulo si no hay base con la que comparar. */
export function variacion(actual: number, anterior: number): number | null {
  if (!anterior) return null;
  return redondear(((actual - anterior) / anterior) * 100, 1);
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

// ---------------------------------------------------------------- pronóstico

/**
 * Lo que se tarda en ver si una etapa predice bien.
 *
 * Con menos cerradas que esto, la probabilidad observada es ruido: dos
 * ganadas de tres dan un 67 % que nadie debería creerse. Por debajo se dice
 * «sin datos» en vez de enseñar un número.
 */
export const MUESTRA_MINIMA = 10;

export interface ProbabilidadObservada {
  codigo: string;
  /** Porcentaje de las cerradas que pasaron por aquí y se ganaron. */
  probabilidad: number | null;
  /** Cuántas cerradas pasaron por aquí. */
  muestra: number;
}

/**
 * Qué parte de lo que pasó por cada etapa terminó ganándose.
 *
 * Es la otra mitad del pronóstico: la probabilidad de la etapa la pone
 * alguien, y ésta la ponen los hechos. Se cuentan sólo las **cerradas**
 * —ganadas o perdidas—: las abiertas todavía no han dicho cómo acaban, y
 * contarlas como perdidas hundiría todas las cifras.
 *
 * «Pasó por la etapa» tiene el mismo sentido que en el embudo: haber llegado
 * a ella o a cualquiera posterior.
 */
export function probabilidadObservada(
  etapas: Etapa[],
  pasos: PasoDeEtapa[],
  minimo = MUESTRA_MINIMA,
): ProbabilidadObservada[] {
  const recorrido = etapas
    .filter((e) => !e.es_ganada && !e.es_perdida)
    .sort((a, b) => a.orden - b.orden);
  const ordenDe = new Map(recorrido.map((e, i) => [e.codigo, i]));
  const ganadoras = new Set(etapas.filter((e) => e.es_ganada).map((e) => e.codigo));
  const perdedoras = new Set(etapas.filter((e) => e.es_perdida).map((e) => e.codigo));

  const masLejos = new Map<string, number>();
  const desenlace = new Map<string, 'ganada' | 'perdida'>();
  const porOrden = [...pasos].sort(
    (a, b) => new Date(a.ocurrido_en).getTime() - new Date(b.ocurrido_en).getTime(),
  );
  for (const paso of porOrden) {
    const clave = String(paso.oportunidad);
    // El último desenlace manda: una perdida que se reabrió y se ganó es
    // una ganada.
    if (ganadoras.has(paso.hasta)) desenlace.set(clave, 'ganada');
    else if (perdedoras.has(paso.hasta)) desenlace.set(clave, 'perdida');
    else if (desenlace.has(clave)) desenlace.delete(clave);

    const indice = ganadoras.has(paso.hasta) ? recorrido.length - 1 : ordenDe.get(paso.hasta);
    if (indice === undefined) continue;
    masLejos.set(clave, Math.max(masLejos.get(clave) ?? -1, indice));
  }

  return recorrido.map((etapa, i) => {
    let cerradas = 0;
    let ganadas = 0;
    for (const [clave, lejos] of masLejos) {
      const final = desenlace.get(clave);
      if (!final || lejos < i) continue;
      cerradas += 1;
      if (final === 'ganada') ganadas += 1;
    }
    return {
      codigo: etapa.codigo,
      probabilidad: cerradas >= minimo ? redondear((ganadas / cerradas) * 100, 1) : null,
      muestra: cerradas,
    };
  });
}

export interface OportunidadAbierta {
  id: number | string;
  monto: number | null;
  etapa: string;
  /** La probabilidad declarada de su etapa, de 0 a 100. */
  probabilidad: number;
  cierre_estimado: string | null;
  comercial?: string | null;
}

export interface MesDePronostico {
  mes: string;
  cuenta: number;
  /** Todo lo abierto que dice cerrar ese mes. */
  abierto: number;
  /** Cada una por la probabilidad de su etapa. */
  ponderado: number;
  /** Cada una por lo que de verdad se gana desde su etapa, cuando se sabe. */
  ponderadoObservado: number | null;
  /** Lo que está en etapas de 75 % o más: lo que se puede prometer. */
  comprometido: number;
}

export interface Pronostico {
  meses: MesDePronostico[];
  /** Cierre previsto ya pasado y sin ganar: fechas que ya no son ciertas. */
  atrasadas: { cuenta: number; monto: number };
  /** Sin fecha de cierre: no se pueden poner en ningún mes. */
  sinFecha: { cuenta: number; monto: number };
}

/** Desde qué probabilidad lo abierto cuenta como «comprometido». */
export const UMBRAL_COMPROMETIDO = 75;

/**
 * El pipeline repartido por el mes en que dice que va a cerrar.
 *
 * Las atrasadas **no se mueven al mes actual**. Es la tentación: «si no cerró
 * en agosto, cerrará este mes», y así el mes en curso se infla con cada
 * oportunidad abandonada que nadie actualizó. Se enseñan aparte, que es donde
 * alguien las ve y les pone fecha.
 */
export function pronostico(
  abiertas: OportunidadAbierta[],
  observada: Map<string, number | null>,
  hoy: string,
  meses = 3,
): Pronostico {
  const primero = mesDe(hoy);
  const lista: MesDePronostico[] = Array.from({ length: meses }, (_, i) => ({
    mes: sumarMeses(primero, i),
    cuenta: 0,
    abierto: 0,
    ponderado: 0,
    ponderadoObservado: 0,
    comprometido: 0,
  }));
  const porMes = new Map(lista.map((m) => [m.mes, m]));
  const atrasadas = { cuenta: 0, monto: 0 };
  const sinFecha = { cuenta: 0, monto: 0 };

  for (const o of abiertas) {
    const monto = Number(o.monto ?? 0);
    if (!o.cierre_estimado) {
      sinFecha.cuenta += 1;
      sinFecha.monto += monto;
      continue;
    }
    if (o.cierre_estimado < hoy) {
      atrasadas.cuenta += 1;
      atrasadas.monto += monto;
      continue;
    }
    const mes = porMes.get(mesDe(o.cierre_estimado));
    if (!mes) continue;

    mes.cuenta += 1;
    mes.abierto += monto;
    mes.ponderado += (monto * o.probabilidad) / 100;
    if (o.probabilidad >= UMBRAL_COMPROMETIDO) mes.comprometido += monto;

    // Si una sola etapa del mes no tiene probabilidad observada, el mes
    // entero se queda sin ella: mezclar observadas y declaradas en una suma
    // da un número que no es ni lo uno ni lo otro.
    const real = observada.get(o.etapa);
    if (real === null || real === undefined || mes.ponderadoObservado === null) {
      mes.ponderadoObservado = null;
    } else {
      mes.ponderadoObservado += (monto * real) / 100;
    }
  }

  return {
    meses: lista.map((m) => ({
      ...m,
      abierto: redondear(m.abierto),
      ponderado: redondear(m.ponderado),
      ponderadoObservado: m.ponderadoObservado === null ? null : redondear(m.ponderadoObservado),
      comprometido: redondear(m.comprometido),
    })),
    atrasadas: { cuenta: atrasadas.cuenta, monto: redondear(atrasadas.monto) },
    sinFecha: { cuenta: sinFecha.cuenta, monto: redondear(sinFecha.monto) },
  };
}

// ---------------------------------------------------------- cuellos de botella

export interface TiempoEnEtapa {
  codigo: string;
  /** Cuántas veces se salió de la etapa en la muestra. */
  salidas: number;
  diasMedios: number | null;
  diasMediana: number | null;
}

/**
 * Cuánto se queda una oportunidad en cada etapa antes de salir de ella.
 *
 * Se mide con las estancias **terminadas** —entró y salió—. Contar las que
 * siguen dentro mide la edad del pipeline y no la velocidad de la etapa, y
 * una etapa nueva sin salidas aún saldría como la más lenta.
 *
 * La mediana va al lado de la media porque una sola venta parada un año
 * arrastra la media de una etapa entera.
 */
export function tiemposPorEtapa(
  pasos: { oportunidad: number | string; hasta: string; ocurrido_en: string | Date }[],
  etapas: Pick<Etapa, 'codigo' | 'orden' | 'es_ganada' | 'es_perdida'>[],
): TiempoEnEtapa[] {
  const porOportunidad = new Map<string, typeof pasos>();
  for (const paso of pasos) {
    const clave = String(paso.oportunidad);
    if (!porOportunidad.has(clave)) porOportunidad.set(clave, []);
    porOportunidad.get(clave)!.push(paso);
  }

  const estancias = new Map<string, number[]>();
  for (const recorrido of porOportunidad.values()) {
    recorrido.sort((a, b) => new Date(a.ocurrido_en).getTime() - new Date(b.ocurrido_en).getTime());
    for (let i = 0; i < recorrido.length - 1; i++) {
      const etapa = recorrido[i].hasta;
      const duracion = dias(recorrido[i].ocurrido_en, recorrido[i + 1].ocurrido_en);
      if (!estancias.has(etapa)) estancias.set(etapa, []);
      estancias.get(etapa)!.push(Math.max(0, duracion));
    }
  }

  return etapas
    .filter((e) => !e.es_ganada && !e.es_perdida)
    .sort((a, b) => a.orden - b.orden)
    .map((e) => {
      const valores = estancias.get(e.codigo) ?? [];
      const media = valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
      const med = mediana(valores);
      return {
        codigo: e.codigo,
        salidas: valores.length,
        diasMedios: media === null ? null : redondear(media, 1),
        diasMediana: med === null ? null : redondear(med, 1),
      };
    });
}

/**
 * La etapa donde más se tarda, si hay datos para decirlo.
 *
 * Por la mediana y con un mínimo de salidas: con dos casos, cualquier etapa
 * puede ser «el cuello de botella».
 */
export function cuelloDeBotella(tiempos: TiempoEnEtapa[], minimo = 5): TiempoEnEtapa | null {
  // De una etapa de la que casi todo sale el mismo día no se dice que atasca.
  const candidatas = tiempos.filter(
    (t) => t.salidas >= minimo && t.diasMediana !== null && t.diasMediana >= 1,
  );
  if (candidatas.length === 0) return null;
  return candidatas.reduce((peor, t) => (t.diasMediana! > peor.diasMediana! ? t : peor));
}

/**
 * Días sin movimiento a partir de los cuales una oportunidad está estancada.
 *
 * Dos semanas: lo que tarda un cliente normal en contestar una propuesta y
 * que alguien lo llame. Más corto marca como parado lo que sólo está
 * esperando; más largo avisa cuando ya se enfrió.
 */
export const DIAS_PARA_ESTANCADA = 14;

// ------------------------------------------------------------------- alertas

export interface Alerta {
  codigo: string;
  nivel: 'alta' | 'media';
  titulo: string;
  detalle: string;
  /** Qué hacer. Una alerta sin acción sólo añade ansiedad. */
  recomendacion: string;
}

export interface DatosDeAlertas {
  hoy: string;
  /** Meta del mes sumada de quienes entren en el filtro; nulo si no hay. */
  meta: number | null;
  vendidoMes: number;
  /** Lo vendido en el mismo tramo del mes, un año antes. */
  vendidoAnioAnterior: number;
  /** Ponderado de lo que dice cerrar en lo que queda de mes. */
  ponderadoRestante: number;
  abiertas: number;
  estancadas: number;
  atrasadas: number;
  proformasSinAbrir: number;
  aprobacionesPendientes: number;
  /** Vendido de los últimos meses cerrados, para la anomalía. */
  serieMensual: number[];
}

const usd = (v: number) =>
  `$${Math.round(v).toLocaleString('es-EC', { maximumFractionDigits: 0 })}`;

/**
 * Lo que hay que mirar hoy, con lo que se puede hacer.
 *
 * Cada alerta tiene un umbral que se puede explicar en una frase. Los
 * avisos que nadie sabe por qué saltan se apagan a la segunda semana.
 */
export function alertas(d: DatosDeAlertas): Alerta[] {
  const lista: Alerta[] = [];
  const [anio, mes, dia] = d.hoy.split('-').map(Number);
  const diasDelMes = new Date(anio, mes, 0).getDate();
  const avance = dia / diasDelMes;

  // El ritmo frente a la meta. Los primeros días no dicen nada: una venta
  // del día 2 no hace un mes bueno ni su ausencia uno malo.
  if (d.meta && dia >= 5) {
    const esperado = d.meta * avance;
    const ritmo = d.vendidoMes / esperado;
    if (ritmo < 0.8) {
      lista.push({
        codigo: 'ritmo',
        nivel: ritmo < 0.5 ? 'alta' : 'media',
        titulo: 'Las ventas van por detrás de la meta',
        detalle:
          `Llevan ${usd(d.vendidoMes)} y a estas alturas del mes tocarían ${usd(esperado)} ` +
          `(${Math.round(ritmo * 100)} % del ritmo).`,
        recomendacion:
          'Revisa lo que está en negociación con cierre este mes y adelanta las llamadas de cierre.',
      });
    }
  }

  // Si lo que puede entrar este mes no cubre lo que falta, la meta no se
  // alcanza ni ganando todo lo previsto: hay que abrir más, no apretar más.
  if (d.meta) {
    const falta = d.meta - d.vendidoMes;
    if (falta > 0 && d.ponderadoRestante < falta) {
      lista.push({
        codigo: 'cobertura',
        nivel: d.ponderadoRestante < falta * 0.5 ? 'alta' : 'media',
        titulo: 'El pipeline no cubre la meta',
        detalle:
          `Faltan ${usd(falta)} y lo ponderado que cierra este mes suma ${usd(d.ponderadoRestante)}.`,
        recomendacion:
          'Abre oportunidades nuevas desde las listas de trabajo o adelanta fechas de cierre realistas.',
      });
    }
  }

  // El mismo tramo del año pasado: estacionalidad incluida.
  const anual = variacion(d.vendidoMes, d.vendidoAnioAnterior);
  if (dia >= 10 && anual !== null && anual <= -20) {
    lista.push({
      codigo: 'anual',
      nivel: anual <= -40 ? 'alta' : 'media',
      titulo: 'Por debajo del año pasado',
      detalle: `${usd(d.vendidoMes)} frente a ${usd(d.vendidoAnioAnterior)} en el mismo tramo de hace un año (${anual} %).`,
      recomendacion: 'Compara por producto en Reportes para ver qué línea es la que cae.',
    });
  }

  // La anomalía: el mes proyectado lejos de lo normal. Sólo pasada la
  // mitad del mes; antes, la proyección multiplica el azar de una semana.
  if (d.serieMensual.length >= 6 && avance >= 0.5) {
    const media = d.serieMensual.reduce((s, v) => s + v, 0) / d.serieMensual.length;
    const desviacion = Math.sqrt(
      d.serieMensual.reduce((s, v) => s + (v - media) ** 2, 0) / d.serieMensual.length,
    );
    const proyectado = d.vendidoMes / avance;
    if (desviacion > 0) {
      const z = (proyectado - media) / desviacion;
      if (z <= -2) {
        lista.push({
          codigo: 'anomalia',
          nivel: 'alta',
          titulo: 'Mes anormalmente bajo',
          detalle: `Al ritmo actual el mes cerraría en ${usd(proyectado)}; lo normal es ${usd(media)}.`,
          recomendacion: 'Mira si falta registrar ventas ganadas o si se cortó una fuente de leads.',
        });
      } else if (z >= 2) {
        lista.push({
          codigo: 'anomalia',
          nivel: 'media',
          titulo: 'Mes anormalmente alto',
          detalle: `Al ritmo actual el mes cerraría en ${usd(proyectado)}; lo normal es ${usd(media)}.`,
          recomendacion: 'Comprueba que no haya ventas duplicadas antes de celebrarlo.',
        });
      }
    }
  }

  if (d.estancadas >= 3 && d.abiertas > 0 && d.estancadas / d.abiertas > 0.25) {
    lista.push({
      codigo: 'estancadas',
      nivel: d.estancadas / d.abiertas > 0.5 ? 'alta' : 'media',
      titulo: 'Demasiadas oportunidades paradas',
      detalle: `${d.estancadas} de ${d.abiertas} abiertas llevan más de ${DIAS_PARA_ESTANCADA} días sin moverse.`,
      recomendacion: 'Llama hoy a las de mayor importe o ciérralas como perdidas con su motivo.',
    });
  }

  if (d.atrasadas > 0) {
    lista.push({
      codigo: 'atrasadas',
      nivel: 'media',
      titulo: 'Cierres previstos que ya pasaron',
      detalle: `${d.atrasadas} oportunidad(es) tienen la fecha de cierre en el pasado; el pronóstico no las cuenta.`,
      recomendacion: 'Ponles una fecha nueva o ciérralas: así el pronóstico vuelve a decir la verdad.',
    });
  }

  if (d.proformasSinAbrir > 0) {
    lista.push({
      codigo: 'sin_abrir',
      nivel: 'media',
      titulo: 'Propuestas que nadie abrió',
      detalle: `${d.proformasSinAbrir} proforma(s) enviadas hace más de 3 días siguen sin abrirse.`,
      recomendacion: 'Confirma por teléfono que le llegó: puede estar en spam o en otro buzón.',
    });
  }

  if (d.aprobacionesPendientes > 0) {
    lista.push({
      codigo: 'aprobaciones',
      nivel: 'media',
      titulo: 'Descuentos esperando firma',
      detalle: `${d.aprobacionesPendientes} proforma(s) no pueden salir hasta que alguien firme su descuento.`,
      recomendacion: 'Revísalas en Propuestas → Aprobaciones.',
    });
  }

  return lista.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alta' ? -1 : 1));
}

// ------------------------------------------------------------------ reportes

export const DIMENSIONES = {
  mes: 'Mes',
  producto: 'Producto',
  marca: 'Marca',
  comercial: 'Comercial',
  equipo: 'Equipo',
  origen: 'Segmento de origen',
  etapa: 'Etapa actual',
  cliente: 'Cliente',
} as const;

export type Dimension = keyof typeof DIMENSIONES;

/**
 * Lo que un reporte sabe contar.
 *
 * `fuente` dice de dónde sale y `fecha` qué columna cae en el periodo, y no
 * son detalles: «vendido» se fecha cuando se ganó, «abiertas» cuando se
 * abrió, y «pipeline» no se fecha —es una foto de ahora—. Mezclarlos en una
 * sola consulta con una sola fecha es como un reporte acaba contando ventas
 * de septiembre en octubre.
 */
export const METRICAS = {
  abiertas: { nombre: 'Abiertas', formato: 'numero', fuente: 'oportunidad' },
  ganadas: { nombre: 'Ganadas', formato: 'numero', fuente: 'venta' },
  perdidas: { nombre: 'Perdidas', formato: 'numero', fuente: 'perdida' },
  tasa_cierre: { nombre: 'Tasa de cierre', formato: 'porcentaje', fuente: 'derivada' },
  vendido: { nombre: 'Vendido', formato: 'dinero', fuente: 'venta' },
  ticket_promedio: { nombre: 'Ticket promedio', formato: 'dinero', fuente: 'venta' },
  cobrado: { nombre: 'Cobrado', formato: 'dinero', fuente: 'cobro' },
  pipeline: { nombre: 'Pipeline abierto', formato: 'dinero', fuente: 'pipeline' },
  ponderado: { nombre: 'Pipeline ponderado', formato: 'dinero', fuente: 'pipeline' },
} as const;

export type Metrica = keyof typeof METRICAS;

export interface DefinicionDeReporte {
  dimension: Dimension;
  metricas: Metrica[];
  /** Periodo fijo; un reporte programado lo ignora y usa el anterior al envío. */
  desde?: string;
  hasta?: string;
  marca?: string;
  comercial?: string;
  equipo?: string;
  producto?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Comprueba una definición que llega del cliente y la devuelve limpia.
 *
 * Todo lo que acaba en SQL tiene que pasar por aquí: la dimensión y las
 * métricas se buscan en las listas de arriba y nunca se interpolan tal
 * cual. Los filtros van como parámetros.
 */
export function validarDefinicion(
  entrada: any,
  { exigirPeriodo = true } = {},
): { definicion?: DefinicionDeReporte; errores: string[] } {
  const errores: string[] = [];
  const dimension = entrada?.dimension;
  if (!Object.prototype.hasOwnProperty.call(DIMENSIONES, dimension)) {
    errores.push(`Agrupa por una de: ${Object.keys(DIMENSIONES).join(', ')}.`);
  }
  const metricas: unknown[] = Array.isArray(entrada?.metricas) ? entrada.metricas : [];
  const validas = metricas.filter((m): m is Metrica =>
    typeof m === 'string' && Object.prototype.hasOwnProperty.call(METRICAS, m),
  );
  if (validas.length === 0) errores.push('Elige al menos una métrica.');
  if (validas.length !== metricas.length) {
    errores.push(`Las métricas válidas son: ${Object.keys(METRICAS).join(', ')}.`);
  }

  const { desde, hasta } = entrada ?? {};
  if (exigirPeriodo || desde || hasta) {
    if (!FECHA.test(String(desde ?? '')) || !FECHA.test(String(hasta ?? ''))) {
      errores.push('El periodo va con «desde» y «hasta» en formato AAAA-MM-DD.');
    } else if (hasta <= desde) {
      errores.push('El periodo termina antes de empezar.');
    }
  }

  if (errores.length) return { errores };

  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    errores,
    definicion: {
      dimension,
      metricas: [...new Set(validas)],
      desde: desde || undefined,
      hasta: hasta || undefined,
      marca: texto(entrada.marca),
      comercial: texto(entrada.comercial),
      equipo: texto(entrada.equipo),
      producto: texto(entrada.producto),
    },
  };
}

/** Tasa de cierre de una fila ya agrupada: ganadas sobre cerradas. */
export function tasaDeFila(ganadas: number, perdidas: number): number | null {
  const cerradas = ganadas + perdidas;
  return cerradas === 0 ? null : redondear((ganadas / cerradas) * 100, 1);
}

export type Frecuencia = 'semanal' | 'mensual';

/**
 * El periodo que cubre un envío programado: el anterior completo.
 *
 * El del lunes cuenta la semana pasada de lunes a lunes; el del día 1, el
 * mes pasado. Nunca el periodo en curso: un reporte de «esta semana» enviado
 * el lunes a las siete está vacío, y lo que se aprende es a no abrirlo.
 */
export function periodoAnterior(frecuencia: Frecuencia, hoy: string): { desde: string; hasta: string } {
  const [anio, mes, dia] = hoy.split('-').map(Number);
  const fecha = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (frecuencia === 'mensual') {
    return { desde: fecha(new Date(anio, mes - 2, 1)), hasta: fecha(new Date(anio, mes - 1, 1)) };
  }
  const hoyD = new Date(anio, mes - 1, dia);
  const desdeLunes = (hoyD.getDay() + 6) % 7;
  const lunes = new Date(anio, mes - 1, dia - desdeLunes);
  const anterior = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() - 7);
  return { desde: fecha(anterior), hasta: fecha(lunes) };
}

/** Si una dirección de correo tiene forma de serlo. */
export function esCorreo(valor: unknown): boolean {
  return typeof valor === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
}
