const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export interface Coincidencia {
  origen: "crm" | "padron";
  id: string;
  name: string;
  tax_identifier: string | null;
  sector: string | null;
  city: string | null;
  tipo_sujeto?: string | null;
  clave?: string | null;
  motivo: "ruc" | "nombre";
  ya_enlazada?: boolean;
}

/**
 * Si la empresa que se está escribiendo ya existe, en el CRM o en el padrón.
 *
 * No pasa por el proveedor de datos de react-admin a propósito: no es un
 * recurso con lista, ficha y formulario, es una consulta puntual mientras
 * alguien teclea. Meterla ahí obligaría a declararla como recurso y a que la
 * caché de react-admin guardara respuestas que caducan en cuanto se escribe
 * otra letra.
 */
export async function buscarCoincidencias(params: {
  nombre?: string;
  ruc?: string;
  excluir?: string;
}): Promise<Coincidencia[]> {
  const busca = new URLSearchParams();
  if (params.nombre) busca.set("nombre", params.nombre);
  if (params.ruc) busca.set("ruc", params.ruc);
  if (params.excluir) busca.set("excluir", params.excluir);
  if ([...busca.keys()].length === 0) return [];

  const respuesta = await fetch(`${API}/crm/api/coincidencias/empresa?${busca}`);
  if (!respuesta.ok) return [];
  return respuesta.json();
}
