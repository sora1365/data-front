import { firma } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/campanias`;

export interface Campania {
  id: string;
  nombre: string;
  marca: string | null;
  segmento: string | null;
  segmento_nombre: string | null;
  asunto: string;
  cuerpo: string;
  remitente: string | null;
  estado: "borrador" | "preparada" | "enviando" | "enviada" | "cancelada";
  creada_en: string;
  destinatarios?: number;
  enviados?: number;
  abiertos?: number;
  resumen?: {
    total: number;
    pendientes: number;
    enviados: number;
    descartados: number;
    fallidos: number;
    abiertos: number;
  };
}

export interface Destinatario {
  id: string;
  correo: string;
  nombre: string | null;
  estado: string;
  motivo: string | null;
  enviado_en: string | null;
  abierto_en: string | null;
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

export const estadoCorreo = (): Promise<{ conectado: boolean }> => pedir("/estado");
export const listarCampanias = (): Promise<Campania[]> => pedir("");
export const obtenerCampania = (id: string): Promise<Campania> => pedir(`/${id}`);

export const crearCampania = (datos: Record<string, unknown>): Promise<Campania> =>
  pedir("", { method: "POST", body: JSON.stringify(datos) });

export const prepararCampania = (
  id: string,
  opciones: { exigirConsentimientoExpreso?: boolean } = {},
): Promise<Campania> =>
  pedir(`/${id}/preparar`, { method: "POST", body: JSON.stringify(opciones) });

export const enviarCampania = (id: string): Promise<Campania> =>
  pedir(`/${id}/enviar`, { method: "POST" });

export const listarDestinatarios = (id: string, estado?: string): Promise<Destinatario[]> =>
  pedir(`/${id}/destinatarios${estado ? `?estado=${estado}` : ""}`);

/**
 * Los segmentos a los que se puede escribir.
 *
 * Vienen del gestor comercial, que es quien los define. El CRM los lee para
 * elegir destinatario y no los toca: las condiciones de un segmento se
 * escriben en migraciones revisadas, nunca desde una pantalla.
 */
export const listarSegmentos = async (): Promise<
  { codigo: string; nombre: string; miembros: number; activo: boolean }[]
> => {
  const respuesta = await fetch(`${API}/segmentos`);
  if (!respuesta.ok) return [];
  const segmentos = await respuesta.json();
  return segmentos.filter((s: any) => s.activo);
};

export interface PlantillaCorreo {
  id: string;
  nombre: string;
  asunto: string;
  cuerpo: string;
  producto: string | null;
  producto_nombre: string | null;
  marca: string | null;
  remitente: string | null;
}

export interface Adjunto {
  id: string;
  nombre: string;
  tipo: string | null;
  tamano: string;
  subido_por: string;
}

/** Las plantillas, normalmente las del producto que se va a ofrecer. */
export const listarPlantillas = (producto?: string): Promise<PlantillaCorreo[]> =>
  pedir(`/plantillas${producto ? `?producto=${encodeURIComponent(producto)}` : ""}`);

export const crearPlantilla = (datos: Record<string, unknown>): Promise<PlantillaCorreo> =>
  pedir("/plantillas", { method: "POST", body: JSON.stringify(datos) });

export const listarAdjuntos = (campania: string): Promise<Adjunto[]> =>
  pedir(`/${campania}/adjuntos`);

export const quitarAdjunto = (campania: string, id: string): Promise<Adjunto[]> =>
  pedir(`/${campania}/adjuntos/${id}`, { method: "DELETE" });

/**
 * Sube un archivo a la campaña.
 *
 * No pasa por `pedir` porque va como `multipart/form-data` y el navegador
 * tiene que poner él la cabecera con su `boundary`: fijarla a mano rompe la
 * subida con un error que no menciona el tipo de contenido.
 */
export async function subirAdjunto(campania: string, archivo: File): Promise<Adjunto[]> {
  const cuerpo = new FormData();
  cuerpo.append("file", archivo);

  const respuesta = await fetch(`${BASE}/${campania}/adjuntos`, {
    method: "POST",
    headers: { ...firma() },
    body: cuerpo,
  });

  if (!respuesta.ok) {
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const datos = await respuesta.json();
      if (datos?.message) mensaje = datos.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }

  return respuesta.json();
}

/**
 * Los productos del catálogo, para elegir qué se ofrece.
 *
 * Se piden al API del CRM y no al de segmentos: la frontera entre los dos
 * módulos pasa por el servicio del CRM, y así hay un solo sitio que cambiar.
 */
export const listarProductos = async (): Promise<{ codigo: string; nombre: string }[]> => {
  const respuesta = await fetch(`${API}/crm/api/productos?range=%5B0,200%5D`);
  if (!respuesta.ok) return [];
  const filas = await respuesta.json();
  return filas.map((p: any) => ({ codigo: p.id, nombre: p.nombre }));
};
