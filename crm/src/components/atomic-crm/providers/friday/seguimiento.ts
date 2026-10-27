import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/seguimiento`;

export interface Paso {
  orden: number;
  dia: number;
  canal: string;
  texto: string;
  vence?: string;
  movido?: boolean;
}

export interface Secuencia {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  marca: string | null;
  producto: string | null;
  etapa_disparo: string | null;
  activa: boolean;
  pasos: Paso[];
  vivos: number;
}

export interface SeguimientoVivo {
  id: string;
  secuencia: string;
  secuencia_nombre: string;
  oportunidad: string;
  oportunidad_nombre: string;
  empresa: string | null;
  etapa: string;
  comercial: string | null;
  iniciado_en: string;
  iniciado_por: string;
  pasos: number;
  hechos: number;
  proximo: string | null;
}

export interface SeguimientoDeOportunidad {
  id: string;
  secuencia: string;
  secuencia_nombre: string;
  estado: "vivo" | "terminado" | "cortado";
  motivo_corte: string | null;
  iniciado_en: string;
  iniciado_por: string;
  tareas: { id: string; texto: string; canal: string; vence: string; hecha: boolean }[];
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

export const listarSecuencias = (): Promise<Secuencia[]> => pedir("/secuencias");
export const listarVivos = (): Promise<SeguimientoVivo[]> => pedir("");

export const seguimientoDe = (oportunidad: string | number): Promise<SeguimientoDeOportunidad[]> =>
  pedir(`/oportunidad/${oportunidad}`);

/** Qué días saldrían, sin crear nada: un plan no debería ser una sorpresa. */
export const previoDe = (codigo: string, arranque?: string): Promise<Paso[]> =>
  pedir(`/secuencias/${codigo}/previo${arranque ? `?arranque=${arranque}` : ""}`);

export const iniciarSeguimiento = (secuencia: string, oportunidad: string | number) =>
  pedir("/iniciar", {
    method: "POST",
    body: JSON.stringify({ secuencia, oportunidad: Number(oportunidad) }),
  });

export const cortarSeguimiento = (id: string, motivo: string) =>
  pedir(`/${id}/cortar`, { method: "POST", body: JSON.stringify({ motivo }) });

const NOMBRE_DE_CANAL: Record<string, string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  correo: "Correo",
  reunion: "Reunión",
  visita: "Visita",
};

export const nombreDeCanal = (canal: string) => NOMBRE_DE_CANAL[canal] ?? canal;

/** «Día 1», y «el mismo día» para el cero, que es lo que significa. */
export const nombreDeDia = (dia: number) => (dia === 0 ? "El mismo día" : `Día ${dia}`);
