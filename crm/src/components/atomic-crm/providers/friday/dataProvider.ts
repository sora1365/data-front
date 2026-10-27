import {
  type DataProvider,
  type GetListParams,
  type Identifier,
  type RaRecord,
} from "ra-core";
import type { Contact, SalesFormData, SignUpData } from "../../types";
import { getActivityLog } from "../commons/activity";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { defaultConfiguration } from "../../root/defaultConfiguration";

/**
 * El proveedor de datos contra el API de FRIDAY.
 *
 * Atomic venía hablando con Supabase, que expone PostgREST. Aquí habla con
 * NestJS en `/crm/api`, que devuelve el total en la cabecera `Content-Range`
 * como espera react-admin.
 *
 * Cada petición lleva la sesión en `Authorization`. Quién firma lo que se
 * escribe lo saca el servidor de ahí, no de lo que diga el navegador.
 */

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/api`;

/** Lo que devuelve el servidor al entrar, tal cual se guarda. */
export interface SesionCrm {
  token: string;
  usuario: string;
  administrador: boolean;
  debeCambiarClave: boolean;
}

const SESION_KEY = "friday-crm-sesion";

/**
 * La sesión vive en `localStorage` para que sobreviva a cerrar la pestaña: un
 * comercial abre el CRM veinte veces al día y pedirle la clave cada vez es
 * cómo acaba apuntada en un pósit. Caduca sola en el servidor (12 h).
 */
export function sesionActual(): SesionCrm | null {
  try {
    const guardada = localStorage.getItem(SESION_KEY);
    return guardada ? JSON.parse(guardada) : null;
  } catch {
    return null;
  }
}

export const fijarSesion = (sesion: SesionCrm | null) =>
  sesion
    ? localStorage.setItem(SESION_KEY, JSON.stringify(sesion))
    : localStorage.removeItem(SESION_KEY);

export const usuarioActual = () => sesionActual()?.usuario ?? "";

/** La cabecera que identifica cada petición. Vacía si no hay sesión. */
export const firma = (): Record<string, string> => {
  const token = sesionActual()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const cabeceras = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  ...firma(),
  ...extra,
});

/** Las llamadas de entrada, que van a `/crm/auth` y no al API de recursos. */
export async function pedirAuth(ruta: string, cuerpo?: unknown) {
  const respuesta = await fetch(`${API}/crm/auth${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: cabeceras(),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error: any = new Error(datos?.message ?? `${respuesta.status} ${respuesta.statusText}`);
    error.status = respuesta.status;
    throw error;
  }
  return datos;
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: cabeceras(opciones.headers as Record<string, string>),
  });

  if (!respuesta.ok) {
    // El mensaje del servidor explica qué pasó («ese sujeto está marcado como
    // no contactar», «ya tiene una oportunidad abierta de ese producto»). Un
    // "Request failed" genérico obligaría a abrir la consola para saberlo.
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      /* el cuerpo no era JSON: se queda el estado */
    }
    const error: any = new Error(mensaje);
    error.status = respuesta.status;
    throw error;
  }

  return respuesta;
}

/**
 * El total de una lista.
 *
 * Viene en `Content-Range: deals 0-24/137`. Si la cabecera no llega —el caso
 * típico es que el servidor no la exponga con CORS y el CRM corre en otro
 * puerto— react-admin pagina sobre un total desconocido y todas las listas
 * se quedan en una página. Más vale enterarse aquí que investigarlo desde la
 * paginación.
 */
function totalDe(respuesta: Response, recibidos: number): number {
  const rango = respuesta.headers.get("Content-Range");
  if (!rango) {
    console.warn(
      "El API no devolvió Content-Range: la paginación no sabrá cuántos hay.",
    );
    return recibidos;
  }
  return Number(rango.split("/").pop()) || recibidos;
}

/** `tasks` y `deals` se piden con filtros que el API entiende tal cual. */
function consulta(params: GetListParams) {
  const { page = 1, perPage = 25 } = params.pagination ?? {};
  const { field = "id", order = "ASC" } = params.sort ?? {};
  const desde = (page - 1) * perPage;
  const busca = new URLSearchParams({
    filter: JSON.stringify(params.filter ?? {}),
    sort: JSON.stringify([field, order]),
    range: JSON.stringify([desde, desde + perPage - 1]),
  });
  return busca.toString();
}

const baseProvider: DataProvider = {
  async getList(resource, params) {
    // `activity_log` no es una tabla: es la actividad reciente que el panel
    // arma cruzando oportunidades, contactos y notas. Se calcula con el mismo
    // código que usan los demás proveedores, para que el panel no dependa de
    // cuál esté enchufado.
    if (resource === "activity_log") {
      const { filter = {}, pagination } = params as GetListParams;
      const todo = await getActivityLog(
        baseProvider,
        filter.company_id,
        filter.sales_id,
      );
      const { page = 1, perPage = 25 } = pagination ?? {};
      const desde = (page - 1) * perPage;
      return { data: todo.slice(desde, desde + perPage), total: todo.length };
    }

    const respuesta = await pedir(`/${resource}?${consulta(params as GetListParams)}`);
    const data = await respuesta.json();
    return { data, total: totalDe(respuesta, data.length) };
  },

  async getOne(resource, params) {
    const respuesta = await pedir(`/${resource}/${encodeURIComponent(String(params.id))}`);
    return { data: await respuesta.json() };
  },

  async getMany(resource, params) {
    // El API no tiene un endpoint para «dame estos ids», así que se pide la
    // lista filtrada por id. Es una sola petición igualmente.
    if (!params.ids?.length) return { data: [] };
    const busca = new URLSearchParams({
      filter: JSON.stringify({ id: params.ids }),
      range: JSON.stringify([0, params.ids.length - 1]),
    });
    const respuesta = await pedir(`/${resource}?${busca}`);
    return { data: await respuesta.json() };
  },

  async getManyReference(resource, params) {
    const respuesta = await pedir(
      `/${resource}?${consulta({
        ...params,
        filter: { ...params.filter, [params.target]: params.id },
      } as GetListParams)}`,
    );
    const data = await respuesta.json();
    return { data, total: totalDe(respuesta, data.length) };
  },

  async create(resource, params) {
    const respuesta = await pedir(`/${resource}`, {
      method: "POST",
      body: JSON.stringify(params.data),
    });
    return { data: await respuesta.json() };
  },

  async update(resource, params) {
    const respuesta = await pedir(`/${resource}/${encodeURIComponent(String(params.id))}`, {
      method: "PUT",
      body: JSON.stringify(params.data),
    });
    return { data: await respuesta.json() };
  },

  async updateMany(resource, params) {
    // En serie y no en paralelo: son cambios sobre las mismas tablas y el
    // servidor reordena índices al mover oportunidades. Lanzarlos a la vez
    // deja el orden del tablero a merced de quién llegue antes.
    const ids: Identifier[] = [];
    for (const id of params.ids) {
      await pedir(`/${resource}/${encodeURIComponent(String(id))}`, {
        method: "PUT",
        body: JSON.stringify(params.data),
      });
      ids.push(id);
    }
    return { data: ids };
  },

  async delete(resource, params) {
    const respuesta = await pedir(`/${resource}/${encodeURIComponent(String(params.id))}`, {
      method: "DELETE",
    });
    return { data: await respuesta.json() };
  },

  async deleteMany(resource, params) {
    const ids: Identifier[] = [];
    for (const id of params.ids) {
      await pedir(`/${resource}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
      ids.push(id);
    }
    return { data: ids };
  },
};

/**
 * La configuración de la aplicación (título, etapas, productos…).
 *
 * En Atomic vive en una tabla de Supabase. Aquí los valores que importan —las
 * etapas, los productos— ya los manda el servidor a través de sus propias
 * tablas, así que lo único que queda es la preferencia visual de cada persona,
 * y eso se guarda en su navegador. Una tabla para esto sería ceremonia.
 */
const CONFIG_KEY = "friday-crm-configuracion";

export const dataProvider = {
  ...baseProvider,

  async isInitialized() {
    // FRIDAY no tiene un primer arranque que haya que completar: los
    // comerciales se dan de alta solos al firmar algo.
    return true;
  },

  async getConfiguration(): Promise<ConfigurationContextValue> {
    try {
      const guardada = localStorage.getItem(CONFIG_KEY);
      if (guardada) return { ...defaultConfiguration, ...JSON.parse(guardada) };
    } catch {
      /* preferencia corrupta: se vuelve a la de serie */
    }
    return defaultConfiguration;
  },

  async updateConfiguration(config: Partial<ConfigurationContextValue>) {
    const actual = await this.getConfiguration();
    const nueva = { ...actual, ...config };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(nueva));
    return nueva;
  },

  /**
   * Devuelve una oportunidad archivada al tablero.
   *
   * El servidor la recoloca al final de su columna. En Atomic esto reordenaba
   * la columna entera desde el navegador, con una petición por tarjeta; aquí
   * el orden ya se mantiene en el servidor —es el mismo sitio que lo recalcula
   * al mover—, así que es una sola petición y no hay dos reglas de orden que
   * puedan discrepar.
   */
  async unarchiveDeal(deal: RaRecord) {
    const respuesta = await pedir(`/deals/${deal.id}`, {
      method: "PUT",
      body: JSON.stringify({ archived_at: null }),
    });
    return [{ data: await respuesta.json() }];
  },

  /**
   * La búsqueda de la cabecera.
   *
   * Pregunta a cada recurso por separado en vez de tener un endpoint que
   * busque en todo: así la búsqueda no se queda muda el día que se añada un
   * recurso nuevo, sólo hay que sumarlo a esta lista.
   */
  async globalSearch(texto: string) {
    if (!texto || texto.length < 2) return [];
    const recursos: { recurso: string; tipo: string }[] = [
      { recurso: "contacts", tipo: "contacts" },
      { recurso: "companies", tipo: "companies" },
      { recurso: "deals", tipo: "deals" },
      { recurso: "tasks", tipo: "tasks" },
    ];

    const resultados = await Promise.all(
      recursos.map(async ({ recurso, tipo }) => {
        try {
          const busca = new URLSearchParams({
            filter: JSON.stringify({ q: texto }),
            range: JSON.stringify([0, 4]),
          });
          const respuesta = await pedir(`/${recurso}?${busca}`);
          const filas = await respuesta.json();
          return filas.map((fila: any) => ({ ...fila, type: tipo }));
        } catch {
          // Que un recurso falle no puede dejar la búsqueda entera sin
          // respuesta: se devuelve lo que sí contestó.
          return [];
        }
      }),
    );

    return resultados.flat();
  },

  /**
   * Dar de alta a un usuario. Devuelve, además de su ficha, la clave
   * provisional: es la única vez que se puede ver, así que la pantalla de alta
   * la enseña en lugar de volver a la lista.
   */
  async salesCreate(body: SalesFormData & { usuario?: string }) {
    const { usuario, claveProvisional } = await pedirAuth("/usuarios", body);
    const respuesta = await pedir(`/sales/${encodeURIComponent(usuario)}`);
    return { ...(await respuesta.json()), claveProvisional };
  },

  /** Clave provisional nueva para otra persona. Sólo administradores. */
  async restablecerClave(usuario: Identifier): Promise<string> {
    const { claveProvisional } = await pedirAuth(
      `/usuarios/${encodeURIComponent(String(usuario))}/restablecer`,
      {},
    );
    return claveProvisional;
  },

  async salesUpdate(id: Identifier, data: Partial<SalesFormData>) {
    const respuesta = await pedir(`/sales/${encodeURIComponent(String(id))}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return respuesta.json();
  },

  // Atomic llama a estos dos desde sus pantallas. En FRIDAY nadie se registra
  // solo —las altas las da un administrador— y la clave se cambia desde
  // «Cambiar clave», que pide la actual; fallan diciendo dónde ir en vez de
  // fingir que funcionaron.

  async signUp(_: SignUpData): Promise<never> {
    throw new Error("Las cuentas del CRM las da de alta un administrador.");
  },

  async updatePassword(): Promise<never> {
    throw new Error("Usa «Cambiar clave», en el menú de tu usuario.");
  },

  async mergeContacts(_: Identifier, __: Identifier): Promise<Contact> {
    throw new Error("Fusionar contactos todavía no está disponible.");
  },
};

export type FridayDataProvider = typeof dataProvider;
