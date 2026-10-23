/**
 * Las reglas de la captación de leads.
 *
 * Todo lo que decide algo —qué campos se aceptan, quién recibe el lead, si es
 * el mismo que ya estaba, cuánto promete— vive aquí como funciones puras. Es
 * lo único de este módulo que se puede probar sin base de datos, y es donde
 * un fallo no se ve: un lead duplicado o mal repartido no da error, sólo hace
 * que dos comerciales llamen a la misma persona o que nadie la llame.
 */
import { correoPlausible, normalizarCorreo } from '../campanias/campanias.reglas';
import { normalizarTelefono } from '../whatsapp/whatsapp.reglas';
import { coerceRuc } from '../../imports/transform/coercions';

/**
 * El RUC tal como lo guarda el padrón, a partir de lo que teclea una persona.
 *
 * En un formulario se pide «RUC o cédula», y llega de las dos formas. Una
 * cédula (10 dígitos) es el RUC de la persona natural sin el `001` del
 * establecimiento; el resto pasa por `coerceRuc`, que repone el cero inicial
 * que se pierde cuando el número viajó por una hoja de cálculo. Sin esto el
 * RUC no enlaza con el padrón y el lead parece de alguien desconocido.
 *
 * Lo que no tiene forma de RUC ecuatoriano se deja en dígitos: puede ser un
 * identificador extranjero, y adivinar sería peor.
 */
export function normalizarRuc(crudo: string | null | undefined): string | null {
  const digitos = (crudo ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length === 9) return `0${digitos}001`;
  if (digitos.length === 10) return `${digitos}001`;
  if (digitos.length === 12 || digitos.length === 13) return coerceRuc(digitos).value as string;
  return digitos;
}

export const ESTADOS_LEAD = [
  'nuevo',
  'contactado',
  'calificado',
  'convertido',
  'descartado',
] as const;
export type EstadoLead = (typeof ESTADOS_LEAD)[number];

/**
 * Por dónde entra un lead que no viene de un formulario.
 *
 * Lista cerrada por la misma razón que los canales de interacción: con texto
 * libre, «feria», «Feria» y «evento» son tres orígenes y la pregunta de por
 * dónde entran los clientes deja de tener respuesta.
 */
export const CANALES_LEAD = [
  'formulario',
  'evento',
  'referido',
  'llamada',
  'whatsapp',
  'correo',
  'otro',
] as const;
export type CanalLead = (typeof CANALES_LEAD)[number];

export function esEstadoLead(valor: unknown): valor is EstadoLead {
  return typeof valor === 'string' && (ESTADOS_LEAD as readonly string[]).includes(valor);
}

export function esCanalLead(valor: unknown): valor is CanalLead {
  return typeof valor === 'string' && (CANALES_LEAD as readonly string[]).includes(valor);
}

/**
 * A qué estado se puede pasar desde cada uno.
 *
 * `convertido` no está en ningún destino a mano: un lead sólo se convierte
 * creando su oportunidad, que es lo que lo hace verdad. Si se pudiera marcar
 * sin más, el embudo contaría ventas que no están en el tablero.
 *
 * Un descartado se puede recuperar —se descarta por error, o vuelve a
 * interesarse—; un convertido no, porque ya tiene su oportunidad y es ahí
 * donde se sigue trabajando.
 */
const TRANSICIONES: Record<EstadoLead, EstadoLead[]> = {
  nuevo: ['contactado', 'calificado', 'descartado'],
  contactado: ['calificado', 'descartado'],
  calificado: ['contactado', 'descartado'],
  convertido: [],
  descartado: ['nuevo', 'contactado'],
};

export function puedePasarLead(desde: EstadoLead, hasta: EstadoLead): boolean {
  return TRANSICIONES[desde]?.includes(hasta) ?? false;
}

/**
 * Si este cambio es la primera respuesta al lead.
 *
 * El tiempo de primera respuesta es el indicador que más pesa en si un lead se
 * convierte, y sólo se mide si se marca en el momento: salir de `nuevo` por
 * primera vez, hacia donde sea, es haberlo atendido. Descartarlo también
 * cuenta, porque alguien lo miró.
 */
export function esPrimeraRespuesta(
  desde: EstadoLead,
  primeraRespuestaEn: Date | string | null | undefined,
): boolean {
  return desde === 'nuevo' && !primeraRespuestaEn;
}

// ---------------------------------------------------------------- formularios

export const TIPOS_CAMPO = ['texto', 'correo', 'telefono', 'area', 'seleccion', 'casilla'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

export interface CampoFormulario {
  /** Nombre del campo en el envío. Los reservados van a su columna. */
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio?: boolean;
  opciones?: string[];
  /** Sólo se muestra —y sólo se exige— si otro campo tiene este valor. */
  mostrarSi?: { campo: string; valor: string };
}

/**
 * Los campos que van a una columna propia y no al `jsonb` de datos.
 *
 * Son los que se buscan, se cruzan o se normalizan: el correo y el teléfono
 * deciden si el lead es un duplicado; el RUC, si ya es cliente. Guardarlos
 * dentro del `jsonb` obligaría a cada consulta a saber cómo los llamó quien
 * diseñó cada formulario.
 */
export const CAMPOS_RESERVADOS = ['nombre', 'correo', 'telefono', 'empresa', 'ruc', 'mensaje'] as const;

/** Los campos que no se pueden usar como clave porque los usa el envío. */
const CLAVES_DEL_SISTEMA = new Set([
  'consentimiento',
  'sitio_web_hp',
  'abierto_en',
  'pagina',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
]);

/**
 * Qué está mal en la definición de un formulario, o una lista vacía.
 *
 * Se comprueba al guardar el formulario y no al recibir envíos: un campo mal
 * definido que se descubre cuando ya hay una campaña pagada apuntando a la
 * landing son leads perdidos.
 */
export function problemasDeFormulario(campos: CampoFormulario[]): string[] {
  const problemas: string[] = [];
  if (!Array.isArray(campos) || campos.length === 0) {
    return ['El formulario no tiene ningún campo.'];
  }

  const claves = new Set<string>();
  for (const campo of campos) {
    const nombre = campo?.etiqueta || campo?.clave || '(sin nombre)';
    if (!campo?.clave || !/^[a-z][a-z0-9_]{0,40}$/.test(campo.clave)) {
      problemas.push(
        `«${nombre}»: la clave tiene que ir en minúsculas, sin espacios ni tildes.`,
      );
      continue;
    }
    if (CLAVES_DEL_SISTEMA.has(campo.clave)) {
      problemas.push(`«${nombre}»: la clave «${campo.clave}» la usa el sistema.`);
    }
    if (claves.has(campo.clave)) {
      problemas.push(`La clave «${campo.clave}» está repetida.`);
    }
    claves.add(campo.clave);

    if (!(TIPOS_CAMPO as readonly string[]).includes(campo.tipo)) {
      problemas.push(`«${nombre}»: el tipo «${campo.tipo}» no existe.`);
    }
    if (campo.tipo === 'seleccion' && !(campo.opciones?.length)) {
      problemas.push(`«${nombre}»: una selección necesita opciones.`);
    }
  }

  for (const campo of campos) {
    if (!campo?.mostrarSi) continue;
    if (campo.mostrarSi.campo === campo.clave) {
      problemas.push(`«${campo.etiqueta}» no puede depender de sí mismo.`);
    } else if (!claves.has(campo.mostrarSi.campo)) {
      problemas.push(
        `«${campo.etiqueta}» depende de «${campo.mostrarSi.campo}», que no está en el formulario.`,
      );
    }
  }

  // Sin correo ni teléfono el lead no se puede contactar ni deduplicar: es
  // una fila que nadie va a poder trabajar.
  if (!claves.has('correo') && !claves.has('telefono')) {
    problemas.push('El formulario necesita al menos un campo «correo» o «telefono».');
  }

  return problemas;
}

/** Si un campo condicional está visible con lo que se ha respondido. */
export function campoVisible(campo: CampoFormulario, respuestas: Record<string, unknown>): boolean {
  if (!campo.mostrarSi) return true;
  const valor = respuestas[campo.mostrarSi.campo];
  return String(valor ?? '') === campo.mostrarSi.valor;
}

/** Un envío ya limpio, listo para guardarse. */
export interface EnvioLimpio {
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  empresa: string | null;
  ruc: string | null;
  mensaje: string | null;
  /** Lo que no es un campo reservado, con la etiqueta del formulario. */
  datos: Record<string, string>;
  correoNorm: string | null;
  telefonoNorm: string | null;
  consentimiento: boolean;
}

/**
 * Un texto recortado, o nulo. Lo que llega de un formulario público se acota.
 *
 * Se normaliza a NFC: un Mac escribe la «í» como «i» más una tilde suelta, y
 * sin normalizar «Auditoría» no coincide con la opción «Auditoría» del
 * formulario aunque se vean iguales.
 */
function texto(valor: unknown, max = 500): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(Array.isArray(valor) ? valor[0] : valor)
    .normalize('NFC')
    .trim();
  return limpio === '' ? null : limpio.slice(0, max);
}

function marcado(valor: unknown): boolean {
  const v = String(Array.isArray(valor) ? valor[0] : valor ?? '').toLowerCase();
  return ['on', 'true', '1', 'si', 'sí', 'yes'].includes(v);
}

/**
 * Valida un envío contra la definición del formulario.
 *
 * Devuelve los errores para enseñárselos a quien lo rellena o el envío
 * limpio. Lo que llega y no está en el formulario se ignora: el endpoint es
 * público, y guardar cualquier clave que alguien decida mandar es abrir el
 * `jsonb` a basura de tamaño arbitrario.
 *
 * Un campo condicional oculto no se exige ni se guarda: si quien rellena
 * cambió de opción después de escribirlo, lo que escribió ya no aplica.
 */
export function validarEnvio(
  campos: CampoFormulario[],
  respuestas: Record<string, unknown>,
): { errores: string[]; envio?: EnvioLimpio } {
  const errores: string[] = [];
  const valores: Record<string, string | null> = {};

  for (const campo of campos) {
    if (!campoVisible(campo, respuestas)) continue;

    const crudo = respuestas[campo.clave];
    let valor =
      campo.tipo === 'casilla'
        ? marcado(crudo)
          ? 'sí'
          : null
        : texto(crudo, campo.tipo === 'area' ? 4000 : 500);

    if (valor && campo.tipo === 'correo' && !correoPlausible(valor)) {
      errores.push(`«${campo.etiqueta}» no parece un correo válido.`);
      valor = null;
    }
    if (valor && campo.tipo === 'telefono' && valor.replace(/\D/g, '').length < 7) {
      errores.push(`«${campo.etiqueta}» no parece un teléfono válido.`);
      valor = null;
    }
    if (
      valor &&
      campo.tipo === 'seleccion' &&
      !campo.opciones?.some((o) => o.normalize('NFC') === valor)
    ) {
      errores.push(`«${campo.etiqueta}»: esa opción no está en la lista.`);
      valor = null;
    }
    if (!valor && campo.obligatorio && !errores.some((e) => e.startsWith(`«${campo.etiqueta}»`))) {
      errores.push(`Falta «${campo.etiqueta}».`);
    }
    valores[campo.clave] = valor;
  }

  if (errores.length) return { errores };

  const correo = valores.correo ?? null;
  const telefono = valores.telefono ?? null;
  if (!correo && !telefono) {
    return { errores: ['Deja al menos un correo o un teléfono para poder contactarte.'] };
  }

  const datos: Record<string, string> = {};
  for (const campo of campos) {
    if ((CAMPOS_RESERVADOS as readonly string[]).includes(campo.clave)) continue;
    const v = valores[campo.clave];
    if (v) datos[campo.etiqueta || campo.clave] = v;
  }

  return {
    errores: [],
    envio: {
      nombre: valores.nombre ?? null,
      correo,
      telefono,
      empresa: valores.empresa ?? null,
      ruc: normalizarRuc(valores.ruc),
      mensaje: valores.mensaje ?? null,
      datos,
      correoNorm: correo ? normalizarCorreo(correo) : null,
      telefonoNorm: telefono ? normalizarTelefono(telefono) || null : null,
      consentimiento: marcado(respuestas.consentimiento),
    },
  };
}

// ------------------------------------------------------------------ anti-spam

/**
 * Si el envío lo hizo, con mucha probabilidad, un programa.
 *
 * Dos señales baratas que no molestan a una persona:
 *
 * - **El campo trampa**: un input oculto que una persona no ve y un robot
 *   rellena porque rellena todo.
 * - **La prisa**: nadie lee y completa un formulario en menos de dos
 *   segundos. `abiertoEn` lo pone la página al pintarse.
 *
 * No es seguridad —quien quiera saltárselo puede—; es quitar el ruido de los
 * robots genéricos, que son casi todo el spam de un formulario.
 */
export function pareceRobot(
  respuestas: Record<string, unknown>,
  ahora: number = Date.now(),
): boolean {
  if (texto(respuestas.sitio_web_hp)) return true;

  const abierto = Number(respuestas.abierto_en);
  if (Number.isFinite(abierto) && abierto > 0) {
    if (ahora - abierto < 2000) return true;
  }
  return false;
}

// -------------------------------------------------------------------- origen

export interface Origen {
  fuente: string | null;
  medio: string | null;
  campania: string | null;
  contenido: string | null;
  termino: string | null;
  pagina: string | null;
}

/**
 * Los `utm_*` del envío, recortados.
 *
 * Sin `utm_source` pero con página de origen, la fuente es el dominio de esa
 * página: un lead que llega de `blog.ascendra.ec` sin parámetros no es «sin
 * origen», y dejarlo así infla esa fila del informe con lo que en realidad
 * es tráfico propio.
 */
export function origenDe(respuestas: Record<string, unknown>): Origen {
  const pagina = texto(respuestas.pagina, 1000);
  let fuente = texto(respuestas.utm_source, 100);
  if (!fuente && pagina) {
    try {
      fuente = new URL(pagina).hostname.replace(/^www\./, '') || null;
    } catch {
      /* no era una URL */
    }
  }
  return {
    fuente: fuente?.toLowerCase() ?? null,
    medio: texto(respuestas.utm_medium, 100)?.toLowerCase() ?? null,
    campania: texto(respuestas.utm_campaign, 200),
    contenido: texto(respuestas.utm_content, 200),
    termino: texto(respuestas.utm_term, 200),
    pagina,
  };
}

// ---------------------------------------------------------------- duplicados

export interface LeadVivo {
  id: number;
  correo_norm: string | null;
  telefono_norm: string | null;
  recibido_en: Date | string;
}

/**
 * Con qué lead vivo coincide un envío, si coincide con alguno.
 *
 * Vale el correo **o** el teléfono: es la misma persona si escribe desde otro
 * correo con el mismo celular. Si coinciden varios, gana el más antiguo,
 * porque es el que alguien ya puede estar trabajando y el que tiene la
 * asignación que hay que respetar.
 */
export function duplicadoDe(
  envio: Pick<EnvioLimpio, 'correoNorm' | 'telefonoNorm'>,
  vivos: LeadVivo[],
): LeadVivo | null {
  const coincidentes = vivos.filter(
    (l) =>
      (envio.correoNorm && l.correo_norm === envio.correoNorm) ||
      (envio.telefonoNorm && l.telefono_norm === envio.telefonoNorm),
  );
  if (coincidentes.length === 0) return null;
  return coincidentes.sort(
    (a, b) => new Date(a.recibido_en).getTime() - new Date(b.recibido_en).getTime(),
  )[0];
}

// ------------------------------------------------------------------- reparto

/**
 * A quién le toca el siguiente lead.
 *
 * Por turnos, pero sin contador: le toca a quien hace más tiempo que no
 * recibe uno de este formulario, y antes que nadie a quien no ha recibido
 * ninguno. Un contador guardado se desordena en cuanto alguien entra o sale de
 * la lista o se reasigna un lead a mano; mirar la última asignación real no.
 *
 * En empate decide el orden de la lista, para que el resultado sea siempre el
 * mismo con los mismos datos.
 */
export function elegirComercial(
  reparto: string[],
  activos: Set<string>,
  ultimaAsignacion: Map<string, Date | string | null>,
): string | null {
  const candidatos = reparto.filter((u) => activos.has(u));
  if (candidatos.length === 0) return null;

  let elegido: string | null = null;
  let masAntigua = Infinity;
  for (const usuario of candidatos) {
    const ultima = ultimaAsignacion.get(usuario);
    const t = ultima ? new Date(ultima).getTime() : -Infinity;
    if (t < masAntigua) {
      masAntigua = t;
      elegido = usuario;
    }
  }
  return elegido;
}

// ------------------------------------------------------------------- puntaje

/**
 * Cuánto promete un lead, de 0 a 100.
 *
 * Es una calificación por completitud y señales explícitas, no una predicción:
 * cuenta lo que se puede comprobar en el propio lead. Sirve para ordenar la
 * bandeja —qué atender primero— y no para decidir por nadie. La calificación
 * con IA, cuando llegue, se apoya en esto y no lo sustituye.
 */
export function puntajeDe(lead: {
  correo?: string | null;
  telefono?: string | null;
  empresa?: string | null;
  ruc?: string | null;
  mensaje?: string | null;
  consentimiento?: boolean;
  envios?: number;
  enPadron?: boolean;
}): number {
  let puntos = 0;
  if (lead.correo) puntos += 15;
  if (lead.telefono) puntos += 20;
  if (lead.correo && lead.telefono) puntos += 5;
  if (lead.empresa) puntos += 10;
  if (lead.ruc) puntos += 15;
  // Un RUC que existe en el padrón dice que la empresa es real y que FRIDAY
  // ya sabe su actividad y su tamaño.
  if (lead.enPadron) puntos += 10;
  if (lead.mensaje && lead.mensaje.length >= 20) puntos += 10;
  if (lead.consentimiento) puntos += 5;
  // Volver a escribir es la señal de interés más clara que hay.
  if ((lead.envios ?? 1) > 1) puntos += 10;
  return Math.min(100, puntos);
}

// -------------------------------------------------------------------- embudo

/**
 * Las tasas del embudo a partir de los conteos de cada etapa.
 *
 * Cada lead cuenta en la etapa más avanzada a la que llegó, así que «llegaron
 * a calificado» incluye a los convertidos: si no, un formulario que convierte
 * rápido parecería tener menos calificados que uno lento.
 */
export function tasasDelEmbudo(c: {
  vistas: number;
  recibidos: number;
  atendidos: number;
  calificados: number;
  convertidos: number;
}) {
  const tasa = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
  // Más leads que visitas quiere decir que parte de los envíos no pasaron por
  // la página que cuenta las visitas (un formulario propio que manda JSON). Las
  // dos cifras no son comparables, y un «400 % de envío» o un «0 % de
  // abandono» no serían ciertos: mejor no dar el dato.
  const comparables = c.vistas > 0 && c.recibidos <= c.vistas;
  return {
    // Cuántos abrieron el formulario y lo enviaron: el resto es abandono.
    envio: comparables ? tasa(c.recibidos, c.vistas) : null,
    abandono: comparables ? Math.round((1 - c.recibidos / c.vistas) * 1000) / 10 : null,
    atencion: tasa(c.atendidos, c.recibidos),
    calificacion: tasa(c.calificados, c.recibidos),
    conversion: tasa(c.convertidos, c.recibidos),
  };
}
