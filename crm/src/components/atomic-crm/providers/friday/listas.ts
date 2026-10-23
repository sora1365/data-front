import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/listas`;

export interface MiembroDeLista {
  tipo_sujeto: string;
  clave: string;
  nombre: string | null;
  ruc: string | null;
  provincia: string | null;
  canton: string | null;
  actividad: string | null;
  telefono: string | null;
  correo: string | null;
  sitio_web: string | null;
  ingresos_ult: string | number | null;
  estado_comercial: string | null;
  ultimo_resultado: string | null;
  ultima_en: string | null;
  intentos: number;
  reintentar_en: string | null;
  oportunidad_abierta: boolean;
  oportunidad: string | null;
}

export interface Lista {
  segmento: string;
  producto: string | null;
  total?: number;
  miembros: MiembroDeLista[];
}

export interface RendimientoDeSegmento {
  segmento: string | null;
  segmento_nombre: string | null;
  gestiones: number;
  sujetos: number;
  oportunidades: number;
  no_interesa: number;
  no_contesta: number;
  no_contactar: number;
}

export type Resultado =
  | "contactado"
  | "no_contesta"
  | "volver_a_llamar"
  | "no_interesa"
  | "no_contactar"
  | "oportunidad";

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

export const listaDeTrabajo = (
  segmento: string,
  opciones: { producto?: string; limite?: number; conContacto?: boolean } = {},
): Promise<Lista> => {
  const busca = new URLSearchParams();
  if (opciones.producto) busca.set("producto", opciones.producto);
  if (opciones.limite) busca.set("limite", String(opciones.limite));
  if (opciones.conContacto) busca.set("conContacto", "true");
  return pedir(`/${segmento}?${busca}`);
};

export const anotarGestion = (datos: {
  tipoSujeto: string;
  clave: string;
  resultado: Resultado;
  segmento?: string;
  producto?: string;
  canal?: string;
  nota?: string;
}) => pedir("/gestion", { method: "POST", body: JSON.stringify(datos) });

export const abrirDesdeLista = (datos: {
  tipoSujeto: string;
  clave: string;
  producto: string;
  marca: string;
  segmento?: string;
  monto?: number;
  nota?: string;
}) => pedir("/abrir", { method: "POST", body: JSON.stringify(datos) });

export const rendimientoDeSegmentos = (): Promise<RendimientoDeSegmento[]> =>
  pedir("/rendimiento");

export const historialDeSujeto = (tipo: string, clave: string) =>
  pedir(`/historial/${tipo}/${clave}`);

/**
 * Los segmentos a los que se puede llamar.
 *
 * Vienen del gestor comercial, que es quien los define. El CRM los lee y no
 * los toca: las condiciones de un segmento se escriben en migraciones
 * revisadas, nunca desde una pantalla.
 */
export const listarSegmentos = async (): Promise<
  { codigo: string; nombre: string; miembros: number }[]
> => {
  const respuesta = await fetch(`${API}/segmentos`);
  if (!respuesta.ok) return [];
  const segmentos = await respuesta.json();
  return segmentos.filter((s: any) => s.activo);
};

export const NOMBRE_DE_RESULTADO: Record<string, string> = {
  contactado: "Hablé con alguien",
  no_contesta: "No contesta",
  volver_a_llamar: "Volver a llamar",
  no_interesa: "No le interesa",
  no_contactar: "Que no lo llamen",
  oportunidad: "Abrí oportunidad",
};

// ------------------------------------------------------------------ guiones

export interface Objecion {
  objecion: string;
  respuesta: string;
}

export interface Guion {
  codigo: string;
  nombre: string;
  producto: string | null;
  segmento: string | null;
  producto_nombre?: string | null;
  segmento_nombre?: string | null;
  apertura: string | null;
  preguntas: string[];
  objeciones: Objecion[];
  cierre: string | null;
  activo: boolean;
}

/**
 * El guion de esta llamada, o null si no hay ninguno que encaje.
 *
 * Que no haya es un caso normal: se llama igual, sólo que sin ayuda. Por eso
 * un 404 aquí no es un error que haya que enseñar.
 */
export const guionAplicable = async (
  producto?: string,
  segmento?: string,
): Promise<Guion | null> => {
  const busca = new URLSearchParams();
  if (producto) busca.set("producto", producto);
  if (segmento) busca.set("segmento", segmento);
  const respuesta = await fetch(`${API}/crm/guiones/aplicable?${busca}`, {
    headers: { "X-Usuario": usuarioActual() },
  });
  if (!respuesta.ok) return null;
  const guion = await respuesta.json();
  return guion && guion.codigo ? guion : null;
};

export const listarGuiones = async (): Promise<Guion[]> => {
  const respuesta = await fetch(`${API}/crm/guiones`, {
    headers: { "X-Usuario": usuarioActual() },
  });
  if (!respuesta.ok) return [];
  return respuesta.json();
};

export const guardarGuion = async (def: Record<string, unknown>): Promise<Guion> => {
  const respuesta = await fetch(`${API}/crm/guiones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Usuario": usuarioActual() },
    body: JSON.stringify(def),
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
};
