/**
 * Las reglas de WhatsApp que impone Meta.
 *
 * No son decisiones nuestras: son las condiciones bajo las que su API acepta
 * o rechaza un envío. Viven aquí, separadas del conector, porque son lo único
 * que se puede comprobar sin hablar con Meta — y porque enterarse de que un
 * mensaje no se podía mandar **antes** de intentarlo es la diferencia entre
 * avisar a la persona que lo está escribiendo y enseñarle un error del API
 * cuando ya le dio a enviar.
 */

/**
 * La ventana de atención: 24 horas desde el último mensaje del cliente.
 *
 * Dentro de ella se puede responder lo que sea. Fuera, Meta sólo acepta
 * plantillas aprobadas, y cobra la conversación aparte. Es la regla que más
 * sorprende a quien viene de usar WhatsApp normal: no se puede retomar una
 * charla de anteayer escribiendo «¿qué tal?».
 */
export const VENTANA_MS = 24 * 60 * 60 * 1000;

export type TipoEnvio = 'libre' | 'plantilla';

export interface EstadoVentana {
  abierta: boolean;
  /** Milisegundos que quedan. Cero si está cerrada. */
  restanteMs: number;
}

export function estadoVentana(
  ultimaEntranteEn: Date | string | null | undefined,
  ahora: Date = new Date(),
): EstadoVentana {
  if (!ultimaEntranteEn) return { abierta: false, restanteMs: 0 };

  const ultima = new Date(ultimaEntranteEn).getTime();
  if (Number.isNaN(ultima)) return { abierta: false, restanteMs: 0 };

  const restante = ultima + VENTANA_MS - ahora.getTime();
  return restante > 0
    ? { abierta: true, restanteMs: restante }
    : { abierta: false, restanteMs: 0 };
}

/**
 * Qué se puede enviar ahora mismo por esta conversación.
 *
 * Devuelve el motivo además del veredicto: «fuera de la ventana de 24 horas»
 * es accionable —hay que elegir una plantilla— y «no se puede enviar» no lo es.
 */
export function puedeEnviar(
  tipo: TipoEnvio,
  ultimaEntranteEn: Date | string | null | undefined,
  ahora: Date = new Date(),
): { permitido: boolean; motivo?: string } {
  // Una plantilla aprobada se puede mandar siempre: es justo para lo que
  // existen, para iniciar o retomar una conversación.
  if (tipo === 'plantilla') return { permitido: true };

  const ventana = estadoVentana(ultimaEntranteEn, ahora);
  if (ventana.abierta) return { permitido: true };

  return {
    permitido: false,
    motivo: ultimaEntranteEn
      ? 'Pasaron más de 24 horas desde el último mensaje del cliente. Para retomar hace falta una plantilla aprobada.'
      : 'Este cliente todavía no ha escrito. El primer mensaje tiene que ser una plantilla aprobada.',
  };
}

/**
 * Normaliza un número de teléfono ecuatoriano al formato que espera Meta.
 *
 * Meta quiere el número con código de país y sin signos: `593992154545`. Lo que
 * teclea la gente es `0992154545`, `099 215 4545` o `+593 99 215 4545`, y el
 * cero inicial del formato nacional **no va** cuando se antepone el código de
 * país: `5930992154545` es un número que no existe y el mensaje se pierde sin
 * error visible.
 *
 * Un número que no parezca ecuatoriano se deja como esté, sólo sin signos: el
 * CRM va a tener clientes de fuera y adivinar su país sería peor.
 */
export function normalizarTelefono(crudo: string, codigoPais = '593'): string {
  const digitos = (crudo ?? '').replace(/\D/g, '');
  if (!digitos) return '';

  // Ya viene con código de país.
  if (digitos.startsWith(codigoPais)) {
    const resto = digitos.slice(codigoPais.length);
    // `593` + `0987654321`: el cero es del formato nacional y sobra.
    return resto.startsWith('0') ? codigoPais + resto.slice(1) : digitos;
  }

  // Formato nacional: 0987654321 (celular) o 042345678 (fijo).
  if (digitos.startsWith('0')) return codigoPais + digitos.slice(1);

  // Nueve dígitos sin cero: 987654321.
  if (digitos.length === 9) return codigoPais + digitos;

  // Cualquier otra cosa es de fuera: se respeta tal cual.
  return digitos;
}

/**
 * Cuántas variables espera el cuerpo de una plantilla.
 *
 * Meta las numera `{{1}}`, `{{2}}`… y rechaza el envío si faltan o sobran. Se
 * cuentan las distintas, no las apariciones: una plantilla que saluda y se
 * despide con el mismo nombre usa `{{1}}` dos veces y necesita un solo valor.
 */
export function variablesDePlantilla(cuerpo: string): number {
  const encontradas = new Set((cuerpo ?? '').match(/\{\{\s*\d+\s*\}\}/g) ?? []);
  return encontradas.size;
}

export function rellenarPlantilla(cuerpo: string, valores: string[]): string {
  return (cuerpo ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => valores[Number(n) - 1] ?? '');
}
