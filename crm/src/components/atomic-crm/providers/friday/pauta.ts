import { firma } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/pauta`;

export type Plataforma = "meta" | "google" | "tiktok" | "linkedin" | "otra";
export type EstadoRitmo = "sin_empezar" | "bajo" | "en_linea" | "sobre" | "terminada" | "excedida";

export interface Indicadores {
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
  conversionLead: number | null;
  cac: number | null;
  roas: number | null;
  roi: number | null;
  roiCobrado: number | null;
}

export interface CifrasPauta {
  presupuesto: number;
  gasto: number;
  impresiones: number;
  clics: number;
  leads: number;
  oportunidades: number;
  ventas: number;
  clientes: number;
  ingresos: number;
  cobrado: number;
  indicadores: Indicadores;
}

export interface Pauta extends CifrasPauta {
  id: string;
  nombre: string;
  marca: string;
  marca_nombre: string;
  plataforma: Plataforma;
  producto: string | null;
  producto_nombre: string | null;
  utm_campaign: string;
  utm_source: string | null;
  desde: string;
  hasta: string;
  activa: boolean;
  nota: string | null;
  ultimo_dia_cargado: string | null;
  ritmo: {
    estado: EstadoRitmo;
    ejecucion: number | null;
    esperado: number;
    proyeccion: number | null;
    transcurridos: number;
    total: number;
  };
  gasto_diario?: {
    dia: string;
    gasto: number;
    impresiones: number | null;
    clics: number | null;
    origen: "manual" | "archivo";
    cargado_por: string;
  }[];
  leads_diarios?: { dia: string; leads: number; convertidos: number }[];
}

export interface ResultadoInforme {
  cargados: number;
  gasto: number;
  fuera: string[];
  avisos: string[];
  encoding: string;
  pauta: Pauta;
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const json = !(opciones.body instanceof FormData);
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...firma(),
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

export const listarPautas = (): Promise<{ pautas: Pauta[]; total: CifrasPauta; hoy: string }> => pedir("");
export const obtenerPauta = (id: string): Promise<Pauta> => pedir(`/${id}`);
export const sinPauta = (): Promise<
  { utm_campaign: string; utm_source: string | null; leads: number; ultimo: string }[]
> => pedir("/sin-pauta");

export const crearPauta = (datos: Record<string, unknown>): Promise<Pauta> =>
  pedir("", { method: "POST", body: JSON.stringify(datos) });

export const editarPauta = (id: string, datos: Record<string, unknown>): Promise<Pauta> =>
  pedir(`/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const anotarGasto = (id: string, datos: Record<string, unknown>): Promise<Pauta> =>
  pedir(`/${id}/gasto`, { method: "POST", body: JSON.stringify(datos) });

export const borrarGasto = (id: string, dia: string): Promise<Pauta> =>
  pedir(`/${id}/gasto/${dia}`, { method: "DELETE" });

export const subirInforme = (id: string, archivo: File): Promise<ResultadoInforme> => {
  const cuerpo = new FormData();
  cuerpo.append("file", archivo);
  return pedir(`/${id}/informe`, { method: "POST", body: cuerpo });
};

/** Los formularios de captación, para armar el enlace etiquetado del anuncio. */
export const formulariosPublicados = async (): Promise<{ id: string; nombre: string; url: string; activo: boolean }[]> => {
  const r = await fetch(`${API}/crm/formularios`);
  if (!r.ok) return [];
  return (await r.json()).filter((f: any) => f.activo);
};
