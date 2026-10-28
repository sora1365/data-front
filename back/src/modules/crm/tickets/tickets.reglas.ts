/**
 * Las reglas de los tickets, sin base de datos por medio, para probarlas solas.
 */

export const TIPOS = ['consulta', 'solicitud', 'incidencia', 'queja', 'reclamo'] as const;
export const PRIORIDADES = ['urgente', 'alta', 'media', 'baja'] as const;
export const ESTADOS = ['abierto', 'en_curso', 'esperando_cliente', 'resuelto', 'cerrado'] as const;
export const CANALES = ['manual', 'formulario', 'whatsapp', 'correo', 'telefono'] as const;

export type Tipo = (typeof TIPOS)[number];
export type Prioridad = (typeof PRIORIDADES)[number];
export type Estado = (typeof ESTADOS)[number];

/** Lo que ya no cuenta como trabajo pendiente. */
export const TERMINADOS: Estado[] = ['resuelto', 'cerrado'];

// ---------------------------------------------------------------- prioridad

/**
 * La prioridad con la que nace un ticket si nadie dice otra.
 *
 * Una queja o un reclamo salen en `alta`: son los tickets en que el cliente ya
 * está molesto, y dejarlos en la cola con las consultas es cómo una queja
 * pequeña se convierte en un cliente perdido. Se puede bajar a mano; lo que
 * no puede pasar es que llegue baja por omisión.
 */
export function prioridadInicial(tipo: Tipo, pedida?: string | null): Prioridad {
  if (pedida && (PRIORIDADES as readonly string[]).includes(pedida)) return pedida as Prioridad;
  return tipo === 'queja' || tipo === 'reclamo' ? 'alta' : 'media';
}

// ------------------------------------------------------------------ estados

const SIGUIENTES: Record<Estado, Estado[]> = {
  abierto: ['en_curso', 'esperando_cliente', 'resuelto'],
  en_curso: ['esperando_cliente', 'resuelto'],
  esperando_cliente: ['en_curso', 'resuelto'],
  // Reabrir vuelve a «en curso»: el cliente dijo que no estaba resuelto, y eso
  // es trabajo en marcha, no un ticket nuevo sin tocar.
  resuelto: ['cerrado', 'en_curso'],
  // Cerrado es final. Si vuelve a pasar, es otro ticket: reabrir uno cerrado
  // hace que el tiempo de resolución de hace tres meses cambie hoy.
  cerrado: [],
};

export function puedePasar(de: Estado, a: Estado): boolean {
  return SIGUIENTES[de]?.includes(a) ?? false;
}

export interface Reloj {
  estado: Estado;
  pausado_seg: number;
  en_espera_desde: Date | null;
  resuelto_en: Date | null;
  cerrado_en: Date | null;
  reabierto: number;
}

/**
 * Lo que cambia en el ticket al pasar de estado.
 *
 * El reloj de la resolución se para mientras se espera al cliente: al entrar en
 * `esperando_cliente` se anota desde cuándo, y al salir —a lo que sea— se suma
 * lo esperado a `pausado_seg`.
 */
export function alCambiarEstado(t: Reloj, a: Estado, ahora: Date): Partial<Reloj> {
  const cambios: Partial<Reloj> = { estado: a };

  if (t.estado === 'esperando_cliente' && t.en_espera_desde) {
    const esperado = Math.max(0, Math.round((ahora.getTime() - t.en_espera_desde.getTime()) / 1000));
    cambios.pausado_seg = t.pausado_seg + esperado;
    cambios.en_espera_desde = null;
  }
  if (a === 'esperando_cliente') cambios.en_espera_desde = ahora;

  if (a === 'resuelto') cambios.resuelto_en = ahora;
  if (a === 'cerrado') {
    cambios.cerrado_en = ahora;
    // Cerrar sin pasar por resuelto (el cliente no contestó, se cerró por
    // inactividad) también es dejar de trabajarlo: sin fecha de resolución el
    // ticket quedaría fuera de los tiempos medios para siempre.
    if (!t.resuelto_en) cambios.resuelto_en = ahora;
  }
  if (t.estado === 'resuelto' && a === 'en_curso') {
    cambios.resuelto_en = null;
    cambios.reabierto = t.reabierto + 1;
  }
  return cambios;
}

// ---------------------------------------------------------------------- SLA

export type EstadoSla = 'en_plazo' | 'por_vencer' | 'incumplido' | 'cumplido';

export interface Plazo {
  limite: Date;
  estado: EstadoSla;
  /** Minutos que quedan (negativos si ya pasó). Nulo si ya se cumplió. */
  restantesMin: number | null;
}

/** A partir de qué fracción del plazo consumido se avisa. */
const AVISO = 0.75;

function plazo(inicio: Date, horas: number, extraSeg: number, hecho: Date | null, ahora: Date): Plazo {
  const ventanaMs = horas * 3_600_000;
  const limite = new Date(inicio.getTime() + ventanaMs + extraSeg * 1000);
  if (hecho) {
    return { limite, estado: hecho <= limite ? 'cumplido' : 'incumplido', restantesMin: null };
  }
  const restanteMs = limite.getTime() - ahora.getTime();
  const restantesMin = Math.floor(restanteMs / 60_000);
  if (restanteMs < 0) return { limite, estado: 'incumplido', restantesMin };
  return {
    limite,
    estado: restanteMs <= ventanaMs * (1 - AVISO) ? 'por_vencer' : 'en_plazo',
    restantesMin,
  };
}

export interface TicketConSla {
  creado_en: Date;
  horas_respuesta: number;
  horas_resolucion: number;
  pausado_seg: number;
  en_espera_desde: Date | null;
  primera_respuesta_en: Date | null;
  resuelto_en: Date | null;
}

/**
 * Cómo va un ticket contra lo prometido.
 *
 * La primera respuesta no se pausa: esperar al cliente sólo tiene sentido
 * después de haberle dicho algo. La resolución sí, por lo esperado y por la
 * espera en curso.
 */
export function sla(t: TicketConSla, ahora: Date = new Date()) {
  const esperaEnCurso = t.en_espera_desde
    ? Math.max(0, (ahora.getTime() - t.en_espera_desde.getTime()) / 1000)
    : 0;
  const resolucion = plazo(
    t.creado_en,
    t.horas_resolucion,
    t.pausado_seg + esperaEnCurso,
    t.resuelto_en,
    ahora,
  );
  // Esperando al cliente no hay nada que se pueda incumplir mientras dure.
  if (t.en_espera_desde && !t.resuelto_en && resolucion.estado === 'por_vencer') {
    resolucion.estado = 'en_plazo';
  }
  return {
    respuesta: plazo(t.creado_en, t.horas_respuesta, 0, t.primera_respuesta_en, ahora),
    resolucion,
  };
}

/**
 * El que se pinta en la lista: el peor de lo que **todavía está pendiente**.
 *
 * Una primera respuesta que salió tarde ya no tiene arreglo; si contara, el
 * ticket saldría como vencido hasta el final aunque la resolución vaya en
 * plazo, y la vista de vencidos se llenaría de cosas en las que no hay nada
 * que hacer. Ese retraso se cuenta en los indicadores, no aquí. Terminado
 * todo, manda cómo fue la resolución.
 */
export function slaQueManda(s: ReturnType<typeof sla>): EstadoSla {
  const orden: EstadoSla[] = ['incumplido', 'por_vencer', 'en_plazo'];
  const pendientes = [s.respuesta, s.resolucion].filter((p) => p.restantesMin !== null);
  if (pendientes.length === 0) return s.resolucion.estado;
  return orden.find((e) => pendientes.some((p) => p.estado === e)) ?? 'en_plazo';
}

// --------------------------------------------------------------------- CSAT

export function csatValido(puntaje: unknown): puntaje is number {
  return Number.isInteger(puntaje) && (puntaje as number) >= 1 && (puntaje as number) <= 5;
}

/**
 * CSAT como porcentaje de satisfechos (4 o 5), que es como se publica en
 * todas partes. El promedio esconde lo que importa: un 3,8 puede ser «todos
 * más o menos» o «la mitad encantados y la otra mitad furiosos».
 */
export function csat(puntajes: number[]): { respuestas: number; satisfechos: number | null; promedio: number | null } {
  if (puntajes.length === 0) return { respuestas: 0, satisfechos: null, promedio: null };
  const buenos = puntajes.filter((p) => p >= 4).length;
  const suma = puntajes.reduce((a, b) => a + b, 0);
  return {
    respuestas: puntajes.length,
    satisfechos: Math.round((buenos / puntajes.length) * 100),
    promedio: Math.round((suma / puntajes.length) * 10) / 10,
  };
}
