import { firma } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/whatsapp`;

export interface Ventana {
  abierta: boolean;
  restanteMs: number;
}

export interface Conversacion {
  id: string;
  telefono: string;
  nombre_perfil: string | null;
  estado: string;
  asignada_a: string | null;
  sin_leer: number;
  ultimo_mensaje_en: string | null;
  ultima_entrante_en: string | null;
  ultimo_texto: string | null;
  canal_nombre: string;
  canal_numero: string;
  first_name: string | null;
  last_name: string | null;
  empresa: string | null;
  ventana: Ventana;
}

export interface Mensaje {
  id: string;
  direccion: "entrante" | "saliente";
  tipo: string;
  texto: string | null;
  plantilla: string | null;
  estado: string;
  error: string | null;
  enviado_por: string | null;
  ocurrido_en: string;
}

export interface Plantilla {
  id: string;
  nombre: string;
  idioma: string;
  estado: string;
  cuerpo: string;
  variables: number;
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...firma(),
      ...(opciones.headers as Record<string, string>),
    },
  });

  if (!respuesta.ok) {
    // El servidor explica por qué no se puede enviar —fuera de la ventana,
    // faltan datos de la plantilla— y eso es justo lo que hay que enseñar.
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

/** Si los mensajes salen de verdad o se quedan registrados sin enviar. */
export const estadoWhatsapp = (): Promise<{ conectado: boolean }> => pedir("/estado");

export const listarConversaciones = (filtros: Record<string, string> = {}): Promise<Conversacion[]> => {
  const busca = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v) as [string, string][],
  );
  return pedir(`/bandeja${busca.toString() ? `?${busca}` : ""}`);
};

export const abrirConversacion = (
  id: string,
): Promise<Conversacion & { mensajes: Mensaje[]; phone_number_id: string }> =>
  pedir(`/conversaciones/${id}`);

export const enviarMensaje = (
  id: string,
  datos: { texto?: string; plantilla?: string; variables?: string[] },
) => pedir(`/conversaciones/${id}/mensajes`, { method: "POST", body: JSON.stringify(datos) });

export const marcarLeida = (id: string) =>
  pedir(`/conversaciones/${id}/leida`, { method: "POST" });

export const asignarConversacion = (id: string, comercial: string | null) =>
  pedir(`/conversaciones/${id}/asignar`, {
    method: "POST",
    body: JSON.stringify({ comercial }),
  });

export const listarPlantillas = (): Promise<Plantilla[]> => pedir("/plantillas");

/**
 * Cuánto queda de la ventana de 24 horas, en palabras.
 *
 * Se dice en horas y minutos y no con la hora de cierre: quien está
 * contestando necesita saber si le corre prisa, no hacer la resta.
 */
export function restanteEnPalabras(ventana: Ventana): string {
  if (!ventana.abierta) return "Cerrada";
  const minutos = Math.floor(ventana.restanteMs / 60000);
  const horas = Math.floor(minutos / 60);
  if (horas >= 1) return `${horas} h ${minutos % 60} min`;
  return `${minutos} min`;
}
