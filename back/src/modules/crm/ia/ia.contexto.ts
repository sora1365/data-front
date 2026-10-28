import { createHash } from 'node:crypto';

/**
 * Cómo se le cuenta a la IA una ficha del CRM.
 *
 * Funciones puras: reciben filas ya leídas y devuelven texto. Así se puede
 * probar qué se manda sin base de datos, y sobre todo qué **no** se manda.
 *
 * **No van correos ni teléfonos.** La IA no los necesita para resumir ni para
 * calificar, y lo que no se manda no puede filtrarse ni quedar en un registro
 * ajeno. Es lo que pide la Ley Orgánica de Protección de Datos Personales:
 * tratar sólo lo necesario para el fin. Los nombres sí van —sin ellos «dijo
 * que lo pensaría» no dice quién— y el RUC de una empresa es público.
 *
 * Los textos largos se recortan **por elemento** y se avisa, en vez de cortar el
 * total: cortar el total se llevaría justo lo más reciente, que es lo que más
 * importa para decidir qué hacer mañana.
 */

const MAX_TEXTO = 1500;
const MAX_ELEMENTOS = 40;

const fecha = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : 'sin fecha');

function recortar(texto: unknown, max = MAX_TEXTO): string {
  const t = String(texto ?? '').trim();
  return t.length > max ? `${t.slice(0, max)} […recortado]` : t;
}

/** Los últimos `n`, en orden cronológico, diciendo cuántos se omitieron. */
function ultimos<T>(filas: T[], n = MAX_ELEMENTOS): { filas: T[]; omitidos: number } {
  return filas.length > n
    ? { filas: filas.slice(filas.length - n), omitidos: filas.length - n }
    : { filas, omitidos: 0 };
}

function bloque(titulo: string, lineas: string[], omitidos = 0): string {
  if (lineas.length === 0) return `## ${titulo}\n(nada registrado)`;
  const aviso = omitidos ? `\n(${omitidos} anteriores omitidos)` : '';
  return `## ${titulo}${aviso}\n${lineas.join('\n')}`;
}

/**
 * Quita lo que parece un correo o un teléfono de un texto libre.
 *
 * El teléfono tiene que estar suelto —sin cifras pegadas delante ni detrás—:
 * un RUC son trece cifras y dentro de cualquiera hay una tira de diez que
 * empieza por cero. Sin esa condición, el filtro se comía el RUC, que es
 * público y es justo lo que identifica a la empresa.
 */
export function sinContacto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/(?<![\d+])(?:\+?593[\s-]?|0)\d(?:[\s-]?\d){7,8}(?!\d)/g, '[teléfono]');
}

export function envolver(hoy: string, cuerpo: string): string {
  return `Hoy es ${hoy}.\n\n<datos>\n${sinContacto(cuerpo)}\n</datos>`;
}

/** Lo que se le mandó, resumido: si no cambió, no se vuelve a pagar. */
export function huella(consigna: string, datos: string, modelo: string): string {
  return createHash('sha256').update(`${modelo}\n${consigna}\n${datos}`).digest('hex');
}

// ------------------------------------------------------------ las fichas

export interface Empresa {
  name?: string | null;
  tax_identifier?: string | null;
  sector?: string | null;
  city?: string | null;
  /** Del padrón, si la empresa está enlazada. */
  perfil?: Record<string, any> | null;
}

function lineasDeEmpresa(e: Empresa | null): string[] {
  if (!e) return ['(sin empresa enlazada)'];
  const p = e.perfil ?? {};
  const fila = (etiqueta: string, valor: unknown) =>
    valor === null || valor === undefined || valor === ''
      ? null
      : `- ${etiqueta}: ${valor === true ? 'sí' : valor === false ? 'no' : valor}`;
  return [
    fila('Nombre', e.name ?? p.nombre),
    fila('RUC', e.tax_identifier ?? p.ruc),
    fila('Sector', e.sector),
    fila('Ciudad', e.city ?? p.canton),
    fila('Actividad (CIIU)', p.actividad),
    fila('Provincia', p.provincia),
    fila('Tipo de compañía', p.tipo_compania),
    fila('Constituida', p.fecha_constitucion ? fecha(p.fecha_constitucion) : null),
    fila('Situación legal', p.situacion_legal),
    fila('Obligada a llevar contabilidad', p.obligado_contabilidad),
    fila('Contribuyente especial', p.contribuyente_especial),
    fila('Agente de retención', p.agente_retencion),
    fila('Establecimientos', p.num_establecimientos),
    fila(`Ingresos ${p.anio_ult ?? ''}`.trim(), p.ingresos_ult),
    fila(`Activos ${p.anio_ult ?? ''}`.trim(), p.activos_ult),
    fila(`Utilidad ${p.anio_ult ?? ''}`.trim(), p.utilidad_ult),
    fila(`Ingresos ${p.anio_prev ?? ''}`.trim(), p.ingresos_prev),
    fila('Exportador de bienes (años)', p.exportador_bienes_iva_anios?.length ? p.exportador_bienes_iva_anios.join(', ') : null),
    fila('Registros de turismo', p.turismo_registros || null),
    fila('Tiene sitio web', p.sitio_web ? 'sí' : null),
  ].filter((x): x is string => x !== null);
}

function lineasDeInteracciones(filas: any[]) {
  const { filas: ult, omitidos } = ultimos(filas);
  return {
    lineas: ult.map(
      (i) =>
        `- ${fecha(i.ocurrido_en)} · ${i.canal} ${i.direccion ?? ''}${i.autor ? ` · ${i.autor}` : ''}` +
        `${i.resultado ? ` · resultado: ${i.resultado}` : ''}: ${recortar(i.texto)}`,
    ),
    omitidos,
  };
}

export function contextoOportunidad(d: {
  oportunidad: any;
  empresa: Empresa | null;
  contactos: any[];
  interacciones: any[];
  notas: any[];
  tareas: any[];
  proformas: any[];
}): string {
  const o = d.oportunidad;
  const inter = lineasDeInteracciones(d.interacciones);
  const notas = ultimos(d.notas, 20);
  return [
    bloque('Oportunidad', [
      `- Nombre: ${o.name ?? '(sin nombre)'}`,
      `- Producto: ${o.producto_nombre ?? o.producto ?? 'no consta'}`,
      `- Etapa: ${o.etapa_nombre ?? o.etapa}`,
      `- Importe estimado: ${o.monto ?? 'no consta'}`,
      `- Cierre estimado: ${o.cierre_estimado ? fecha(o.cierre_estimado) : 'no consta'}`,
      `- Abierta el: ${fecha(o.creada_en)}`,
      `- Último movimiento de etapa: ${o.ultima_etapa_en ? fecha(o.ultima_etapa_en) : 'no consta'}`,
      `- Comercial: ${o.comercial ?? 'sin asignar'}`,
      o.description ? `- Descripción: ${recortar(o.description)}` : null,
    ].filter((x): x is string => !!x)),
    bloque('Empresa', lineasDeEmpresa(d.empresa)),
    bloque(
      'Contactos',
      d.contactos.map((c) => `- ${[c.first_name, c.last_name].filter(Boolean).join(' ')}${c.title ? ` (${c.title})` : ''}`),
    ),
    bloque('Historial de contactos', inter.lineas, inter.omitidos),
    bloque(
      'Notas',
      notas.filas.map((n) => `- ${fecha(n.date)}${n.sales_id ? ` · ${n.sales_id}` : ''}: ${recortar(n.text)}`),
      notas.omitidos,
    ),
    bloque(
      'Tareas',
      d.tareas.map(
        (t) => `- ${t.done_date ? 'hecha' : 'pendiente'} · vence ${fecha(t.due_date)} · ${t.type ?? ''}: ${recortar(t.text, 300)}`,
      ),
    ),
    bloque(
      'Proformas',
      d.proformas.map(
        (p) => `- ${p.numero ?? p.id} · ${p.estado} · total ${p.total} · válida hasta ${fecha(p.valida_hasta)}${p.motivo ? ` · motivo: ${recortar(p.motivo, 300)}` : ''}`,
      ),
    ),
  ].join('\n\n');
}

export function contextoLead(d: {
  lead: any;
  empresa: Empresa | null;
  interacciones: any[];
  catalogo: { codigo: string; nombre: string; descripcion?: string | null }[];
}): string {
  const l = d.lead;
  // Las respuestas del formulario van tal cual, salvo los campos de contacto:
  // el nombre de cada pregunta lo puso quien diseñó el formulario y dice más
  // que cualquier resumen.
  const PRIVADOS = /correo|email|mail|tel[eé]fono|celular|phone|whatsapp/i;
  const respuestas = Object.entries(l.datos ?? {})
    .filter(([k, v]) => !PRIVADOS.test(k) && v !== null && v !== '' && !k.endsWith('_hp') && k !== 'abierto_en')
    .map(([k, v]) => `- ${k}: ${recortar(Array.isArray(v) ? v.join(', ') : v, 500)}`);
  const inter = lineasDeInteracciones(d.interacciones);
  return [
    bloque('Lead', [
      `- Nombre: ${l.nombre ?? 'no consta'}`,
      `- Empresa que escribió: ${l.empresa_nombre ?? 'no consta'}`,
      `- RUC que escribió: ${l.ruc ?? 'no consta'}`,
      `- Recibido el: ${fecha(l.recibido_en)}`,
      `- Veces que ha escrito: ${l.envios ?? 1}`,
      `- Origen: ${[l.origen_canal, l.origen_fuente, l.origen_medio, l.origen_campania].filter(Boolean).join(' / ') || 'no consta'}`,
      `- Dejó teléfono: ${l.telefono ? 'sí' : 'no'} · dejó correo: ${l.correo ? 'sí' : 'no'}`,
      `- Aceptó comunicaciones: ${l.consentimiento ? 'sí' : 'no'}`,
      `- Estado en el CRM: ${l.estado}`,
      l.mensaje ? `- Mensaje: ${recortar(l.mensaje)}` : null,
      l.nota ? `- Nota del equipo: ${recortar(l.nota)}` : null,
    ].filter((x): x is string => !!x)),
    bloque('Respuestas del formulario', respuestas),
    bloque('Empresa (padrón)', lineasDeEmpresa(d.empresa)),
    bloque('Historial de contactos', inter.lineas, inter.omitidos),
    bloque(
      'Catálogo (usa el código en producto_sugerido)',
      d.catalogo.map((p) => `- ${p.codigo}: ${p.nombre}${p.descripcion ? ` — ${recortar(p.descripcion, 200)}` : ''}`),
    ),
  ].join('\n\n');
}

export function contextoTicket(d: { ticket: any; eventos: any[]; anteriores: number }): string {
  const t = d.ticket;
  const ev = ultimos(d.eventos);
  return [
    bloque('Ticket', [
      `- Número: #${t.id}`,
      `- Asunto: ${recortar(t.asunto, 300)}`,
      `- Tipo: ${t.tipo} · prioridad: ${t.prioridad} · estado: ${t.estado}`,
      `- Entró por: ${t.canal} el ${fecha(t.creado_en)}`,
      `- Cliente: ${t.empresa ?? t.solicitante_nombre ?? 'sin identificar'}`,
      `- Otros tickets de este cliente: ${d.anteriores}`,
      `- Lo que pidió: ${recortar(t.descripcion) || 'no consta'}`,
    ]),
    bloque(
      'Historial',
      ev.filas.map(
        (e) =>
          `- ${fecha(e.en)} · ${
            e.tipo === 'cliente'
              ? 'cliente'
              : e.tipo === 'respuesta'
                ? `respuesta al cliente (${e.autor})`
                : e.tipo === 'nota'
                  ? `nota interna (${e.autor})`
                  : `${e.tipo} (${e.autor})`
          }: ${recortar(e.texto)}`,
      ),
      ev.omitidos,
    ),
  ].join('\n\n');
}
