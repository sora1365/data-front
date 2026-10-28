import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/ia`;

export type EntidadIa = "oportunidad" | "lead" | "ticket";
export type Aplicacion = "tarea" | "temperatura" | "borrador" | "descartado";

export interface SiguientePaso {
  accion: string;
  canal: string;
  en_dias: number;
  por_que: string;
  mensaje_sugerido: string;
}

export interface Analisis {
  id: string;
  entidad: EntidadIa;
  entidad_id: string;
  resultado: Record<string, any>;
  modelo: string;
  tokens_entrada: number;
  tokens_salida: number;
  pedido_por: string;
  creado_en: string;
  aplicado: Aplicacion | null;
  aplicado_por: string | null;
  aplicado_en: string | null;
  reutilizado?: boolean;
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
  // `ultimo` devuelve null cuando no hay análisis, y Nest lo manda vacío.
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

export const estadoIa = (): Promise<{ disponible: boolean; modelo: string | null }> => pedir("/estado");

export const ultimoAnalisis = (entidad: EntidadIa, id: string | number): Promise<Analisis | null> =>
  pedir(`/${entidad}/${id}`);

export const analizar = (entidad: EntidadIa, id: string | number, forzar = false): Promise<Analisis> =>
  pedir(`/${entidad}/${id}/analizar`, { method: "POST", body: JSON.stringify({ forzar }) });

export const aplicarAnalisis = (
  id: string,
  accion: Aplicacion,
): Promise<{ aplicado: Aplicacion; tarea?: number; vence?: string; temperatura?: string }> =>
  pedir(`/analisis/${id}/aplicar`, { method: "POST", body: JSON.stringify({ accion }) });

/**
 * Si el servidor tiene IA. Se pregunta una vez por sesión: no cambia mientras
 * la pantalla está abierta, y cada ficha que lo preguntara por su cuenta sería
 * una petición más por cada oportunidad que se abre.
 */
let estadoEnCache: Promise<{ disponible: boolean; modelo: string | null }> | null = null;
export const iaDisponible = () => {
  estadoEnCache ??= estadoIa().catch(() => ({ disponible: false, modelo: null }));
  return estadoEnCache;
};
