import { firma } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/postventa`;

export interface Renovacion {
  id: string;
  razon_social: string;
  producto: string;
  producto_nombre: string | null;
  comercial: string | null;
  monto: number;
  periodicidad: string | null;
  renueva_en: string;
  dias: number;
  vencida: boolean;
}

export interface Encuesta {
  id: string;
  venta: string;
  razon_social: string;
  producto_nombre: string | null;
  comercial: string | null;
  correo: string | null;
  token: string;
  puntaje: number | null;
  comentario: string | null;
  respondida_por: string | null;
  enviada_en: string | null;
  vista_en: string | null;
  respondida_en: string | null;
}

export interface Nps {
  respuestas: number;
  promotores: number;
  pasivos: number;
  detractores: number;
  nps: number | null;
  promedio: number | null;
}

export interface VentaSinEncuesta {
  id: string;
  razon_social: string;
  producto_nombre: string | null;
  comercial: string | null;
  cobrada_en: string | null;
}

export interface ResumenDePostventa {
  renovaciones: Renovacion[];
  nps: Nps;
  encuestas: Encuesta[];
  sinEncuesta: VentaSinEncuesta[];
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

export const resumenDePostventa = (dias?: number): Promise<ResumenDePostventa> =>
  pedir(dias ? `?dias=${dias}` : "");

export const renovar = (venta: string) =>
  pedir(`/renovaciones/${venta}/renovar`, { method: "POST" });

export const fijarRenovacion = (venta: string, periodicidad: string | null) =>
  pedir(`/renovaciones/${venta}`, { method: "POST", body: JSON.stringify({ periodicidad }) });

export const crearEncuesta = (venta: string, correo?: string): Promise<Encuesta> =>
  pedir("/encuestas", { method: "POST", body: JSON.stringify({ venta: Number(venta), correo }) });

export const enviarEncuesta = (id: string): Promise<{ enlace: string; simulado: boolean }> =>
  pedir(`/encuestas/${id}/enviar`, { method: "POST" });

export const enlaceDeEncuesta = (token: string) => `${API}/crm/postventa/encuesta/${token}`;

/** Promotor, pasivo o detractor, con los cortes de siempre del NPS. */
export const claseDePuntaje = (puntaje: number) =>
  puntaje >= 9 ? "promotor" : puntaje >= 7 ? "pasivo" : "detractor";

// ------------------------------------------------------------ venta cruzada

export interface SugerenciaDeCruce {
  codigo: string;
  nombre: string;
  marca: string | null;
  marca_nombre: string | null;
  motivo: string;
  prioridad: number;
  otraMarca: boolean;
}

export interface ClienteParaCruzar {
  company_id: string;
  razon_social: string;
  tipo_sujeto: string | null;
  clave: string | null;
  facturado: number;
  ventas: number;
  ultima_venta: string | null;
  marcas: string[];
  sugerencias: SugerenciaDeCruce[];
}

export const ventaCruzada = (limite?: number): Promise<ClienteParaCruzar[]> =>
  pedir(`/cruzada${limite ? `?limite=${limite}` : ""}`);
