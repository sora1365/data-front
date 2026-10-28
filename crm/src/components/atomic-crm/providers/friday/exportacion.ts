import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/exportacion`;

export interface Exportacion {
  id: string;
  por: string;
  en: string;
  tablas: number;
  filas: string;
  bytes: string;
  sha256: string;
}

export interface Verificacion {
  valido: boolean;
  problemas: string[];
  tablas: number;
  filas: number;
  generado_en: string;
  por: string;
  esquema: string | null;
  registrada: { id: string; por: string; en: string } | null;
}

async function error(respuesta: Response): Promise<never> {
  const cuerpo = await respuesta.json().catch(() => ({}));
  throw new Error(cuerpo?.message ?? `${respuesta.status} ${respuesta.statusText}`);
}

export async function historialDeExportaciones(): Promise<Exportacion[]> {
  const r = await fetch(BASE, { headers: { "X-Usuario": usuarioActual() } });
  if (!r.ok) return error(r);
  return r.json();
}

/**
 * Pide la exportación y la guarda como archivo.
 *
 * Por `fetch` y no con un enlace: el servidor necesita saber quién la saca
 * (`X-Usuario`), y un enlace del navegador no lleva cabeceras.
 */
export async function descargarExportacion(): Promise<{ nombre: string; sha256: string }> {
  const r = await fetch(`${BASE}/descargar`, {
    method: "POST",
    headers: { "X-Usuario": usuarioActual() },
  });
  if (!r.ok) return error(r);
  const disposicion = r.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? "friday-crm.zip";
  const sha256 = r.headers.get("X-Sha256") ?? "";
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { nombre, sha256 };
}

export async function verificarExportacion(archivo: File): Promise<Verificacion> {
  const datos = new FormData();
  datos.append("archivo", archivo);
  const r = await fetch(`${BASE}/verificar`, {
    method: "POST",
    headers: { "X-Usuario": usuarioActual() },
    body: datos,
  });
  if (!r.ok) return error(r);
  return r.json();
}
