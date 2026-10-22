import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/agenda`;

export interface Calendario {
  id: string;
  nombre: string;
  descripcion: string | null;
  color: string;
  marca: string | null;
  puede_editar: boolean;
  miembros?: number;
}

export interface Evento {
  id: string;
  calendario: string;
  calendario_nombre: string;
  calendario_color: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
  todo_el_dia: boolean;
  importante: boolean;
  empresa: string | null;
  contacto_nombre: string | null;
  resultado: string | null;
  asistio: boolean | null;
  participantes: { usuario: string; estado: string }[];
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

export const listarCalendarios = (): Promise<Calendario[]> => pedir("/calendarios");

export const crearCalendario = (datos: {
  nombre: string;
  color?: string;
  descripcion?: string;
  marca?: string;
}): Promise<Calendario> =>
  pedir("/calendarios", { method: "POST", body: JSON.stringify(datos) });

export const compartirCalendario = (id: string, usuario: string, puedeEditar: boolean) =>
  pedir(`/calendarios/${id}/compartir`, {
    method: "POST",
    body: JSON.stringify({ usuario, puedeEditar }),
  });

export const listarEventos = (
  desde: Date,
  hasta: Date,
  calendarios?: string[],
): Promise<Evento[]> => {
  const busca = new URLSearchParams({
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
  });
  if (calendarios?.length) busca.set("calendarios", calendarios.join(","));
  return pedir(`/eventos?${busca}`);
};

export const crearEvento = (datos: Record<string, unknown>): Promise<Evento> =>
  pedir("/eventos", { method: "POST", body: JSON.stringify(datos) });

export const editarEvento = (id: string, datos: Record<string, unknown>): Promise<Evento> =>
  pedir(`/eventos/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const borrarEvento = (id: string) => pedir(`/eventos/${id}`, { method: "DELETE" });

export const buscarConflictos = (datos: {
  inicio: string;
  fin: string;
  usuarios: string[];
}): Promise<{ usuario: string; conflictos: Evento[] }[]> =>
  pedir("/conflictos", { method: "POST", body: JSON.stringify(datos) });

/**
 * El lunes de la semana de una fecha.
 *
 * `getDay()` cuenta desde el domingo, y aquí la semana empieza el lunes. Sin
 * el ajuste, el domingo se va a la semana siguiente y la vista salta un día
 * sólo los domingos, que es cuando nadie lo mira y por eso tarda en verse.
 */
export function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function sumarDias(fecha: Date, dias: number): Date {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

export const MISMO_DIA = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
