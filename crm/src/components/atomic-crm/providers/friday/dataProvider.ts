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
 * El usuario viaja en `X-Usuario`, que es como firma todo lo que se escribe en
 * FRIDAY. Mientras no haya autenticación de verdad, ese nombre lo elige la
 * persona y se guarda aquí mismo; el día que haya un login, este es el único
 * archivo que cambia.
 */

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/api`;

export const USUARIO_KEY = "usuario";

export const usuarioActual = () =>
  localStorage.getItem(USUARIO_KEY)?.trim() || "";

export const fijarUsuario = (valor: string) =>
  localStorage.setItem(USUARIO_KEY, valor.trim());

const cabeceras = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  "X-Usuario": usuarioActual(),
  ...extra,
});

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

  async salesCreate(body: SalesFormData) {
    const respuesta = await pedir(`/sales`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return respuesta.json();
  },

  async salesUpdate(id: Identifier, data: Partial<SalesFormData>) {
    const respuesta = await pedir(`/sales/${encodeURIComponent(String(id))}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return respuesta.json();
  },

  // ---------------------------------------------------------------- sin auth
  // FRIDAY todavía no tiene autenticación: la identidad es la cabecera
  // `X-Usuario`. Estos tres métodos existen porque las pantallas de Atomic los
  // llaman, y fallan diciendo qué falta en vez de fingir que funcionaron.

  async signUp(_: SignUpData): Promise<never> {
    throw new Error(
      "FRIDAY todavía no tiene registro de usuarios. Escribe tu nombre en el perfil: es lo que firma lo que hagas.",
    );
  },

  async updatePassword(): Promise<never> {
    throw new Error("FRIDAY todavía no tiene contraseñas que cambiar.");
  },

  async mergeContacts(_: Identifier, __: Identifier): Promise<Contact> {
    throw new Error("Fusionar contactos todavía no está disponible.");
  },
};

export type FridayDataProvider = typeof dataProvider;
