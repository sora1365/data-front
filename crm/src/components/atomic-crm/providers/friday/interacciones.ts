import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/oportunidades`;

/**
 * Por dónde se habló con el cliente.
 *
 * Es la misma lista blanca que `back/src/modules/crm/crm.reglas.ts`, escrita
 * otra vez porque los dos proyectos no comparten código. Si divergen, el back
 * contesta 400 y la pantalla no sabría por qué: por eso el desplegable sale de
 * aquí y no de texto libre, y por eso `sistema` no está —ese canal lo escribe
 * el servidor al mover una tarjeta, y poder teclearlo sería poder fabricar un
 * cambio de etapa que nunca ocurrió.
 */
export const CANALES = [
  { codigo: "llamada", nombre: "Llamada" },
  { codigo: "whatsapp", nombre: "WhatsApp" },
  { codigo: "correo", nombre: "Correo" },
  { codigo: "reunion", nombre: "Reunión" },
  { codigo: "visita", nombre: "Visita" },
  { codigo: "otro", nombre: "Otro" },
] as const;

export const CANAL_SISTEMA = "sistema";

/** Cómo se nombra un canal, incluido el del sistema, que no se puede teclear. */
export const nombreDeCanal = (canal: string): string =>
  canal === CANAL_SISTEMA
    ? "Sistema"
    : (CANALES.find((c) => c.codigo === canal)?.nombre ?? canal);

export type Direccion = "entrante" | "saliente";

export interface Interaccion {
  id: number;
  canal: string;
  direccion: Direccion;
  resultado: string | null;
  texto: string | null;
  ocurrido_en: string;
  autor: string;
}

export interface Contacto {
  id: number;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

export interface Oportunidad {
  id: number;
  interacciones: Interaccion[];
  contactos: Contacto[];
}

export interface NuevaInteraccion {
  canal: string;
  direccion: Direccion;
  contacto?: number | null;
  resultado?: string;
  texto?: string;
  ocurridoEn?: string;
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

/**
 * El historial de una venta.
 *
 * Se pide al API propio del CRM y no como recurso de react-admin porque la
 * ficha viene con todo —contactos, interacciones, notas y tareas— en una sola
 * consulta, y porque las interacciones no se editan ni se borran: un contacto
 * que ocurrió no se deshace.
 */
export const obtenerOportunidad = (id: string | number): Promise<Oportunidad> =>
  pedir(`/${id}`);

export const registrarInteraccion = (
  id: string | number,
  datos: NuevaInteraccion,
): Promise<Oportunidad> =>
  pedir(`/${id}/interaccion`, { method: "POST", body: JSON.stringify(datos) });

/**
 * La fecha y hora que acepta un `input[type=datetime-local]`.
 *
 * Se compone a mano en hora local: `toISOString()` devuelve UTC, y en Ecuador
 * eso pone el campo cinco horas adelantado, así que la llamada de las nueve de
 * la mañana se anotaría a las dos de la tarde.
 */
export function paraCampoLocal(fecha: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
    `T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  );
}
