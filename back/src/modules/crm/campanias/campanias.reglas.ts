/**
 * Quién recibe una campaña y quién no.
 *
 * Son las reglas con consecuencias legales del CRM, así que viven aparte y
 * probadas: aquí un fallo no se ve en pantalla, se ve cuando alguien que pidió
 * no recibir nada recibe algo.
 */

export type EstadoConsentimiento = 'otorgado' | 'sin_declarar' | 'revocado';

export interface Destinatario {
  correo: string;
  nombre?: string | null;
  tipoSujeto?: string | null;
  clave?: string | null;
}

export interface Descartado extends Destinatario {
  motivo: string;
}

/**
 * Si una dirección de correo es plausible.
 *
 * Deliberadamente simple: comprobar de verdad que existe es imposible sin
 * enviarle algo. Lo que se busca es descartar lo que seguro no es un correo
 * —celdas con un guion, un «no tiene», un teléfono— que es lo que llega en los
 * datos del padrón. Pasar esas direcciones al proveedor sube la tasa de
 * rebotes, y la tasa de rebotes es lo que decide si el resto llega o cae en
 * spam.
 */
export function correoPlausible(correo: string): boolean {
  const limpio = (correo ?? '').trim();
  if (limpio.length < 6 || limpio.length > 254) return false;
  if (/\s/.test(limpio)) return false;

  const partes = limpio.split('@');
  if (partes.length !== 2) return false;

  const [usuario, dominio] = partes;
  if (!usuario || !dominio) return false;
  if (!dominio.includes('.')) return false;
  if (dominio.startsWith('.') || dominio.endsWith('.')) return false;
  if (dominio.includes('..')) return false;

  // Una terminación de un solo carácter no existe; dos o más sí (.ec, .com).
  const terminacion = dominio.split('.').pop() ?? '';
  return terminacion.length >= 2 && /^[a-zA-Z]+$/.test(terminacion);
}

/**
 * Normaliza para comparar.
 *
 * El correo no distingue mayúsculas en la práctica, y `Ventas@Empresa.EC` y
 * `ventas@empresa.ec` son la misma persona. Sin normalizar, alguien que se dio
 * de baja volvería a recibir en cuanto el dato llegara escrito distinto, que
 * es exactamente lo que pasa cuando viene de dos fuentes.
 */
export function normalizarCorreo(correo: string): string {
  return (correo ?? '').trim().toLowerCase();
}

/**
 * Reparte a los candidatos entre quienes reciben y quienes no.
 *
 * El orden de las comprobaciones importa para el motivo que se guarda: a quien
 * revocó el consentimiento se le descarta por eso aunque además su correo esté
 * mal escrito, porque lo primero es una decisión suya y lo segundo un problema
 * de datos.
 */
export function repartirDestinatarios(
  candidatos: Destinatario[],
  consentimientos: Map<string, EstadoConsentimiento>,
  opciones: { exigirConsentimientoExpreso?: boolean } = {},
): { envian: Destinatario[]; descartados: Descartado[] } {
  const envian: Destinatario[] = [];
  const descartados: Descartado[] = [];
  const vistos = new Set<string>();

  for (const candidato of candidatos) {
    const correo = normalizarCorreo(candidato.correo);
    const normalizado = { ...candidato, correo };

    if (!correo) {
      descartados.push({ ...normalizado, motivo: 'sin correo' });
      continue;
    }

    const consentimiento = consentimientos.get(correo) ?? 'sin_declarar';

    if (consentimiento === 'revocado') {
      descartados.push({ ...normalizado, motivo: 'se dio de baja' });
      continue;
    }

    if (opciones.exigirConsentimientoExpreso && consentimiento !== 'otorgado') {
      descartados.push({ ...normalizado, motivo: 'sin consentimiento expreso' });
      continue;
    }

    if (!correoPlausible(correo)) {
      descartados.push({ ...normalizado, motivo: 'correo no válido' });
      continue;
    }

    // Una misma persona puede salir dos veces del segmento —representante de
    // dos empresas— y recibir dos copias del mismo correo es la forma más
    // rápida de que se dé de baja.
    if (vistos.has(correo)) {
      descartados.push({ ...normalizado, motivo: 'repetido en la lista' });
      continue;
    }

    vistos.add(correo);
    envian.push(normalizado);
  }

  return { envian, descartados };
}

/**
 * Sustituye las variables del cuerpo y del asunto.
 *
 * Las variables van como `{{nombre}}`. Una que no tenga valor se queda vacía y
 * **no** imprime el hueco: mandar «Estimado {{nombre}}» a mil personas es peor
 * que mandar «Estimado» a secas.
 */
export function personalizar(texto: string, valores: Record<string, string | null | undefined>): string {
  return (texto ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, clave) => {
    const valor = valores[String(clave)];
    return valor === null || valor === undefined ? '' : String(valor);
  });
}

/** Las variables que usa una plantilla, para poder avisar de las que faltan. */
export function variablesUsadas(texto: string): string[] {
  const encontradas = new Set<string>();
  for (const [, clave] of (texto ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    encontradas.add(String(clave));
  }
  return [...encontradas];
}

/**
 * Lo que impide mandar una campaña.
 *
 * Se comprueba antes de preparar nada, porque descubrir que falta el asunto
 * después de materializar cuarenta mil envíos obliga a borrarlos y volver a
 * empezar.
 */
export function problemasDeCampania(campania: {
  asunto?: string;
  cuerpo?: string;
  remitente?: string | null;
}): string[] {
  const problemas: string[] = [];

  if (!campania.asunto?.trim()) problemas.push('Falta el asunto.');
  if (!campania.cuerpo?.trim()) problemas.push('Falta el cuerpo del mensaje.');

  // Sin enlace de baja el envío es ilegal de facto, y además arruina la
  // reputación del dominio: quien no encuentra cómo salir marca como spam.
  if (campania.cuerpo && !campania.cuerpo.includes('{{baja}}')) {
    problemas.push(
      'El cuerpo tiene que incluir {{baja}}, que es el enlace para dejar de recibir.',
    );
  }

  if (campania.remitente && !correoPlausible(campania.remitente)) {
    problemas.push('El remitente no es una dirección válida.');
  }

  return problemas;
}
