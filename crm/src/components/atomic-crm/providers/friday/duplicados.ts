import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/duplicados`;

export type TipoDuplicado = "contacto" | "empresa";
export type Motivo = "correo" | "telefono" | "nombre" | "ruc";

export interface FichaDuplicada {
  id: number;
  nombre: string;
  relacionados: Record<string, number>;
  // contacto
  cargo?: string | null;
  empresa?: string | null;
  correos?: string[];
  telefonos?: string[];
  // empresa
  ruc?: string | null;
  ciudad?: string | null;
  sector?: string | null;
  enlazada_al_padron?: boolean;
}

export interface ParDuplicado {
  motivos: Motivo[];
  a: FichaDuplicada;
  b: FichaDuplicada;
}

export interface Fusion {
  id: string;
  tipo: TipoDuplicado;
  ganador: string;
  perdedor: string;
  perdedor_nombre: string;
  movidos: Record<string, number>;
  autor: string;
  en: string;
}

async function pedir(ruta: string, cuerpo?: unknown) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Usuario": usuarioActual() },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos?.message ?? `${respuesta.status} ${respuesta.statusText}`);
  return datos;
}

export const buscarDuplicados = (): Promise<{ contactos: ParDuplicado[]; empresas: ParDuplicado[] }> =>
  pedir("");
export const fusiones = (): Promise<Fusion[]> => pedir("/fusiones");
export const fusionar = (tipo: TipoDuplicado, ganador: number, perdedor: number) =>
  pedir(`/${tipo}/fusionar`, { ganador, perdedor });
export const noSonLaMisma = (tipo: TipoDuplicado, a: number, b: number) => pedir(`/${tipo}/no-son`, { a, b });

export const NOMBRE_DE_MOTIVO: Record<Motivo, string> = {
  correo: "mismo correo",
  telefono: "mismo teléfono",
  nombre: "mismo nombre",
  ruc: "mismo RUC",
};
