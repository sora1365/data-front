/**
 * Las reglas de la lista de trabajo.
 *
 * Deciden a quién se llama hoy y cuándo vuelve quien no contestó. Puras,
 * porque el fallo aquí no se ve: una lista mal ordenada no da error, sólo hace
 * que todos los días se llame a los mismos veinte y el resto del segmento no
 * se toque nunca.
 */

export const RESULTADOS = [
  'contactado',
  'no_contesta',
  'volver_a_llamar',
  'no_interesa',
  'no_contactar',
  'oportunidad',
] as const;

export type Resultado = (typeof RESULTADOS)[number];

export function esResultado(valor: unknown): valor is Resultado {
  return typeof valor === 'string' && (RESULTADOS as readonly string[]).includes(valor);
}

/**
 * Cuántos días pasan hasta que un sujeto vuelve a la lista.
 *
 * `null` es «nunca más». Los números no son caprichosos: quien no contesta
 * vuelve pronto porque lo normal es que estuviera ocupado; a quien ya dijo que
 * no se le deja descansar medio año, porque insistir antes es lo que hace que
 * la gente pida no ser llamada; y quien lo pide expresamente no vuelve, que
 * además es lo que manda la ley de protección de datos.
 *
 * Quien ya tiene oportunidad abierta tampoco vuelve: a partir de ahí se
 * trabaja desde el tablero, y tenerlo en los dos sitios duplica la llamada.
 */
export const DIAS_HASTA_VOLVER: Record<Resultado, number | null> = {
  contactado: 30,
  no_contesta: 2,
  volver_a_llamar: 7,
  no_interesa: 180,
  no_contactar: null,
  oportunidad: null,
};

/**
 * Cuándo vuelve, con el castigo de insistir.
 *
 * Cada intento seguido sin respuesta aleja un poco el siguiente: dos días, y
 * si tampoco está, cuatro. Llamar siete veces en una semana al mismo número
 * no consigue nada que no consiga llamar tres veces en un mes, y quema el
 * contacto.
 *
 * El tope son treinta días para lo que no es definitivo: pasado ese punto, más
 * que esperar lo que hay que hacer es decidir que no se le llama.
 */
export function siguienteIntento(
  resultado: Resultado,
  hoy: string,
  intentosSeguidos = 1,
): string | null {
  const base = DIAS_HASTA_VOLVER[resultado];
  if (base === null) return null;

  const espera =
    resultado === 'no_contesta'
      ? Math.min(base * Math.max(intentosSeguidos, 1), 30)
      : base;

  return sumarDias(hoy, espera);
}

export interface MiembroDeLista {
  tipo_sujeto: string;
  clave: string;
  nombre?: string | null;
  telefono?: string | null;
  correo?: string | null;
  estado_comercial?: string | null;
  /** Lo que el CRM ya sabe de él. */
  reintentar_en?: string | null;
  ultimo_resultado?: string | null;
  intentos?: number | null;
  oportunidad_abierta?: boolean;
}

/**
 * Qué sale en la lista de hoy y en qué orden.
 *
 * Se quedan fuera los que todavía no toca volver a llamar, los que ya tienen
 * una oportunidad abierta —se trabajan desde el tablero— y los marcados como
 * `no_contactar`. Esto último es lo que hace que la lista sea segura de usar:
 * si un segmento vuelve a calcularse e incluye a alguien que pidió no ser
 * llamado, la lista no lo enseña aunque el segmento sí lo tenga.
 *
 * El orden pone primero **a quien nunca se ha llamado**: es lo contrario de lo
 * que pasa solo, que es volver sobre los conocidos y no tocar nunca el final
 * del segmento. Después, los que ya tocaba y llevan más tiempo esperando.
 */
export function listaDeHoy<T extends MiembroDeLista>(
  miembros: T[],
  hoy: string,
  opciones: { soloConContacto?: boolean } = {},
): T[] {
  return miembros
    .filter((m) => {
      if (m.estado_comercial === 'no_contactar') return false;
      if (m.oportunidad_abierta) return false;
      if (m.reintentar_en && m.reintentar_en > hoy) return false;
      if (opciones.soloConContacto && !m.telefono && !m.correo) return false;
      return true;
    })
    .sort((a, b) => {
      const nuncaA = a.ultimo_resultado ? 1 : 0;
      const nuncaB = b.ultimo_resultado ? 1 : 0;
      if (nuncaA !== nuncaB) return nuncaA - nuncaB;

      // Entre los ya intentados, el que lleva más tiempo esperando.
      const esperaA = a.reintentar_en ?? '9999-12-31';
      const esperaB = b.reintentar_en ?? '9999-12-31';
      if (esperaA !== esperaB) return esperaA < esperaB ? -1 : 1;

      return (a.nombre ?? '').localeCompare(b.nombre ?? '');
    });
}

/**
 * Qué estado comercial le corresponde al gestor tras una gestión.
 *
 * Es la devolución que enriquece la base: el gestor sabe a quién llamar y el
 * CRM le dice qué pasó. `null` significa no tocar nada, que es el caso más
 * común —haber llamado sin respuesta no cambia lo que ese sujeto es—.
 *
 * `no_interesa` **no** marca `no_contactar`: no es lo mismo «ahora no» que «no
 * me vuelvas a llamar», y confundirlos borra del mercado a medio segmento por
 * una conversación de treinta segundos.
 */
export function estadoParaElGestor(resultado: Resultado): string | null {
  if (resultado === 'no_contactar') return 'no_contactar';
  if (resultado === 'oportunidad' || resultado === 'contactado') return 'en_gestion';
  return null;
}

export function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
