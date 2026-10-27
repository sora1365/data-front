import { firma } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/cotizadores`;

export interface VariableDeCotizador {
  id?: string;
  codigo: string;
  nombre: string;
  unidad: string | null;
  valor_defecto: number;
}

export interface TareaDeCotizador {
  id?: string;
  orden?: number;
  nombre: string;
  horas_fijas: number;
  horas_por_unidad: number;
  variable: string | null;
  costo_hora: number | null;
  /** De quién es el tiempo: el perfil de nómina que hace la tarea. */
  perfil?: string | null;
}

export interface Cotizador {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  producto: string | null;
  producto_nombre: string | null;
  costo_hora: number;
  margen: number;
  modo_margen: "sobre_costo" | "sobre_precio";
  iva: number;
  periodicidad: "mensual" | "unica" | "anual";
  activo: boolean;
  variables: VariableDeCotizador[];
  tareas: TareaDeCotizador[];
  problemas: string[];
}

export interface LineaDeCalculo {
  orden: number;
  nombre: string;
  horas: number;
  costo_hora: number;
  costo: number;
  variable: string | null;
  valor: number | null;
}

export interface Calculo {
  cotizador: { codigo: string; nombre: string; periodicidad: string; iva: number };
  valores: Record<string, number>;
  problemas: string[];
  detalle: LineaDeCalculo[];
  horas: number;
  costo: number;
  margen: number;
  modo_margen: Cotizador["modo_margen"];
  precio: number;
  ganancia: number;
  id?: string;
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

export const listarCotizadores = (): Promise<Cotizador[]> => pedir("");

export const guardarCotizador = (def: Record<string, unknown>): Promise<Cotizador> =>
  pedir("", { method: "POST", body: JSON.stringify(def) });

export const calcularCotizacion = (
  codigo: string,
  entradas: Record<string, number>,
): Promise<Calculo> =>
  pedir(`/${codigo}/calcular`, { method: "POST", body: JSON.stringify({ entradas }) });

export const cotizar = (
  codigo: string,
  entradas: Record<string, number>,
  oportunidad?: string | number,
  nota?: string,
): Promise<Calculo> =>
  pedir(`/${codigo}/cotizar`, {
    method: "POST",
    body: JSON.stringify({ entradas, oportunidad: oportunidad ? Number(oportunidad) : undefined, nota }),
  });

export const cotizacionesDe = (oportunidad: string | number): Promise<any[]> =>
  pedir(`/oportunidad/${oportunidad}`);

export const NOMBRE_DE_PERIODICIDAD: Record<string, string> = {
  mensual: "al mes",
  anual: "al año",
  unica: "una sola vez",
};

export const NOMBRE_DE_MODO: Record<string, string> = {
  sobre_costo: "sobre el costo",
  sobre_precio: "sobre el precio",
};

// ----------------------------------------------- lo que llega del contable

export interface Articulo {
  codigo: string;
  nombre: string;
  unidad: string | null;
  precio: number | null;
  iva: number | null;
  stock: number | null;
  sincronizado_en: string;
}

export interface PerfilDeNomina {
  perfil: string;
  nombre: string;
  costo_hora: number;
  personas: number | null;
  sincronizado_en: string;
}

export interface EstadoDelContable {
  conectado: boolean;
  inventario: { total: number; ultima: string | null };
  nomina: { total: number; ultima: string | null };
  movimientos: { total: number; ultima: string | null };
}

const INVENTARIO = `${API}/crm/inventario`;

async function pedirInventario(ruta: string) {
  const respuesta = await fetch(`${INVENTARIO}${ruta}`, {
    headers: { ...firma() },
  });
  if (!respuesta.ok) throw new Error(`${respuesta.status} ${respuesta.statusText}`);
  return respuesta.json();
}

export const listarArticulos = (busqueda?: string): Promise<Articulo[]> =>
  pedirInventario(busqueda ? `?q=${encodeURIComponent(busqueda)}` : "");

export const listarPerfiles = (): Promise<PerfilDeNomina[]> => pedirInventario("/perfiles");

export const estadoDelContable = (): Promise<EstadoDelContable> => pedirInventario("/estado");
