import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/tickets`;

export type EstadoSla = "en_plazo" | "por_vencer" | "incumplido" | "cumplido";
export type EstadoTicket = "abierto" | "en_curso" | "esperando_cliente" | "resuelto" | "cerrado";
export type Vista = "abiertos" | "vencidos" | "mios" | "esperando" | "terminados" | "todos";

export interface Plazo {
  limite: string;
  estado: EstadoSla;
  restantesMin: number | null;
}

export interface Ticket {
  id: string;
  asunto: string;
  descripcion: string | null;
  tipo: string;
  prioridad: string;
  estado: EstadoTicket;
  canal: string;
  empresa_id: string | null;
  empresa: string | null;
  ruc: string | null;
  contacto: string | null;
  solicitante_nombre: string | null;
  solicitante_correo: string | null;
  solicitante_telefono: string | null;
  responsable: string | null;
  responsable_nombre: string | null;
  primera_respuesta_en: string | null;
  resuelto_en: string | null;
  reabierto: number;
  csat_enviada_en: string | null;
  csat_puntaje: number | null;
  csat_comentario: string | null;
  creado_por: string;
  creado_en: string;
  sla: { respuesta: Plazo; resolucion: Plazo };
  sla_estado: EstadoSla;
}

export interface EventoTicket {
  id: string;
  tipo: string;
  texto: string | null;
  interna: boolean;
  autor: string;
  en: string;
}

export interface FichaTicket extends Ticket {
  eventos: EventoTicket[];
  anteriores: { id: string; asunto: string; tipo: string; estado: string; creado_en: string }[];
}

export interface CatalogosTickets {
  tipos: string[];
  prioridades: string[];
  estados: EstadoTicket[];
  sla: { prioridad: string; horas_respuesta: number; horas_resolucion: number }[];
  comerciales: { usuario: string; nombre: string }[];
}

export interface ResumenTickets {
  dias: number;
  abiertos: number;
  vencidos: number;
  porVencer: number;
  sinResponsable: number;
  esperandoCliente: number;
  porTipo: Record<string, number>;
  resueltos: number;
  minutosRespuesta: number | null;
  minutosResolucion: number | null;
  slaCumplido: number | null;
  respuestaATiempo: number | null;
  reabiertos: number;
  csat: { respuestas: number; satisfechos: number | null; promedio: number | null };
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
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }
  return respuesta.json();
}

const post = (ruta: string, cuerpo: unknown) =>
  pedir(ruta, { method: "POST", body: JSON.stringify(cuerpo) });

export const catalogosTickets = (): Promise<CatalogosTickets> => pedir("/catalogos");
export const resumenTickets = (): Promise<ResumenTickets> => pedir("/resumen");

export const listarTickets = (vista: Vista, q?: string): Promise<Ticket[]> => {
  const params = new URLSearchParams({ vista, usuario: usuarioActual() });
  if (q?.trim()) params.set("q", q.trim());
  return pedir(`?${params}`);
};

export const obtenerTicket = (id: string): Promise<FichaTicket> => pedir(`/${id}`);
export const crearTicket = (datos: Record<string, unknown>): Promise<{ id: number }> => post("", datos);
export const ticketDesdeWhatsapp = (conversacion: string): Promise<{ id: number; yaExistia?: boolean }> =>
  post(`/desde-whatsapp/${conversacion}`, {});
export const actualizarTicket = (id: string, datos: Record<string, unknown>): Promise<FichaTicket> =>
  pedir(`/${id}`, { method: "PATCH", body: JSON.stringify(datos) });
export const cambiarEstadoTicket = (id: string, estado: EstadoTicket, nota?: string): Promise<FichaTicket> =>
  post(`/${id}/estado`, { estado, nota });
export const anotarEnTicket = (
  id: string,
  tipo: "respuesta" | "nota" | "cliente",
  texto: string,
): Promise<FichaTicket> => post(`/${id}/eventos`, { tipo, texto });
export const enviarCsatTicket = (id: string): Promise<{ enlace: string; simulado: boolean }> =>
  post(`/${id}/csat`, {});

/** El enlace del formulario público, para pegarlo en la web o en una firma. */
export const enlaceDeSoporte = () => `${API}/crm/publico/soporte`;

// ---------------------------------------------------------------- nombres

export const NOMBRE_DE_ESTADO: Record<EstadoTicket, string> = {
  abierto: "Abierto",
  en_curso: "En curso",
  esperando_cliente: "Esperando al cliente",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

export const NOMBRE_DE_TIPO: Record<string, string> = {
  consulta: "Consulta",
  solicitud: "Solicitud",
  incidencia: "Incidencia",
  queja: "Queja",
  reclamo: "Reclamo",
};

export const NOMBRE_DE_SLA: Record<EstadoSla, string> = {
  en_plazo: "En plazo",
  por_vencer: "Por vencer",
  incumplido: "Vencido",
  cumplido: "Cumplido",
};

/** «3 h 20 min», «2 d 4 h»: lo que queda o lo que se pasó. */
export function duracion(minutos: number | null): string {
  if (minutos === null) return "—";
  const m = Math.abs(Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

/** Siguientes estados que la pantalla ofrece, en el mismo orden que el back. */
export const SIGUIENTES: Record<EstadoTicket, EstadoTicket[]> = {
  abierto: ["en_curso", "esperando_cliente", "resuelto"],
  en_curso: ["esperando_cliente", "resuelto"],
  esperando_cliente: ["en_curso", "resuelto"],
  resuelto: ["cerrado", "en_curso"],
  cerrado: [],
};
