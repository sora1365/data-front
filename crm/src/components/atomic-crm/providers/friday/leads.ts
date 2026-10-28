import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm`;

export type EstadoLead = "nuevo" | "contactado" | "calificado" | "convertido" | "descartado";

export interface Lead {
  id: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  empresa_nombre: string | null;
  ruc?: string | null;
  mensaje?: string | null;
  estado: EstadoLead;
  marca: string;
  origen_canal: string | null;
  origen_fuente: string | null;
  origen_medio?: string | null;
  origen_campania: string | null;
  origen_contenido?: string | null;
  origen_termino?: string | null;
  pagina?: string | null;
  asignado_a: string | null;
  puntaje: number;
  /** La pone una persona, a mano o aceptando la que propone la IA. */
  temperatura?: "frio" | "tibio" | "caliente" | null;
  envios: number;
  recibido_en: string;
  ultimo_envio_en: string;
  primera_respuesta_en: string | null;
  contacto_id: string | null;
  empresa_id: string | null;
  oportunidad_id: string | null;
  formulario_nombre: string | null;
  formulario_producto?: string | null;
  consentimiento?: boolean;
  datos?: Record<string, string>;
  motivo_descarte?: string | null;
  empresa_crm?: string | null;
  contacto_nombre?: string | null;
  contacto_apellido?: string | null;
  oportunidad_nombre?: string | null;
  padron_nombre?: string | null;
  padron_actividad?: string | null;
  padron_provincia?: string | null;
  historial?: {
    id: string;
    canal: string;
    direccion: string;
    resultado: string | null;
    texto: string | null;
    ocurrido_en: string;
    autor: string;
  }[];
}

export interface CampoFormulario {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "correo" | "telefono" | "area" | "seleccion" | "casilla";
  obligatorio?: boolean;
  opciones?: string[];
  mostrarSi?: { campo: string; valor: string };
}

export interface Formulario {
  id: string;
  slug: string;
  nombre: string;
  marca: string;
  marca_nombre?: string;
  producto: string | null;
  producto_nombre?: string | null;
  titulo: string | null;
  descripcion: string | null;
  campos: CampoFormulario[];
  texto_consentimiento: string;
  mensaje_gracias: string | null;
  redirigir_a: string | null;
  reparto: string[];
  activo: boolean;
  leads?: number;
  vistas?: number;
  url?: string;
}

export interface FilaEmbudo {
  clave: string | null;
  nombre?: string;
  vistas: number;
  recibidos: number;
  atendidos: number;
  calificados: number;
  convertidos: number;
  descartados: number;
  minutos_respuesta: number | null;
  tasas: {
    envio: number | null;
    abandono: number | null;
    atencion: number | null;
    calificacion: number | null;
    conversion: number | null;
  };
}

export interface Embudo {
  desde: string;
  hasta: string;
  total: Omit<FilaEmbudo, "clave" | "minutos_respuesta">;
  porFormulario: FilaEmbudo[];
  porFuente: FilaEmbudo[];
}

export interface CatalogosLeads {
  productos: { codigo: string; nombre: string }[];
  estados: EstadoLead[];
  canales: string[];
  tiposCampo: CampoFormulario["tipo"][];
  campos: CampoFormulario[];
  texto_consentimiento: string;
  urlPublica: string;
}

/** Los catálogos generales del CRM: marcas, comerciales y canales de interacción. */
export interface CatalogosCrm {
  marcas: { codigo: string; nombre: string }[];
  comerciales: { usuario: string; nombre: string }[];
  canales: string[];
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      "X-Usuario": usuarioActual(),
      ...(opciones.headers as Record<string, string>),
    },
  });

  if (!respuesta.ok) {
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = Array.isArray(cuerpo.message) ? cuerpo.message.join(" ") : cuerpo.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }

  return respuesta.json();
}

const consulta = (filtros: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const catalogosLeads = (): Promise<CatalogosLeads> => pedir("/leads/catalogos");
export const catalogosCrm = (): Promise<CatalogosCrm> => pedir("/catalogos");

export const listarLeads = (filtros: {
  estado?: string;
  asignado?: string;
  formulario?: string;
  q?: string;
}): Promise<{ leads: Lead[]; resumen: Partial<Record<EstadoLead, number>> }> =>
  pedir(`/leads${consulta(filtros)}`);

export const obtenerLead = (id: string): Promise<Lead> => pedir(`/leads/${id}`);

export const crearLead = (datos: Record<string, unknown>): Promise<Lead> =>
  pedir("/leads", { method: "POST", body: JSON.stringify(datos) });

export const cambiarEstadoLead = (id: string, estado: string, motivo?: string): Promise<Lead> =>
  pedir(`/leads/${id}/estado`, { method: "POST", body: JSON.stringify({ estado, motivo }) });

export const asignarLead = (id: string, comercial: string | null): Promise<Lead> =>
  pedir(`/leads/${id}/asignar`, { method: "POST", body: JSON.stringify({ comercial }) });

export const anotarLead = (id: string, datos: Record<string, unknown>): Promise<Lead> =>
  pedir(`/leads/${id}/interaccion`, { method: "POST", body: JSON.stringify(datos) });

export const convertirLead = (id: string, datos: Record<string, unknown>): Promise<Lead> =>
  pedir(`/leads/${id}/convertir`, { method: "POST", body: JSON.stringify(datos) });

export const listarFormularios = (): Promise<Formulario[]> => pedir("/formularios");

export const crearFormulario = (datos: Partial<Formulario>): Promise<Formulario> =>
  pedir("/formularios", { method: "POST", body: JSON.stringify(datos) });

export const editarFormulario = (id: string, datos: Partial<Formulario>): Promise<Formulario> =>
  pedir(`/formularios/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const embudoLeads = (filtros: { desde?: string; hasta?: string; marca?: string }): Promise<Embudo> =>
  pedir(`/leads/embudo${consulta(filtros)}`);
