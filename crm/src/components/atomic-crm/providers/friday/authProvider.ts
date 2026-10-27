import type { AuthProvider } from "ra-core";
import { canAccess } from "../commons/canAccess";
import { fijarSesion, pedirAuth, sesionActual, type SesionCrm } from "./dataProvider";

/**
 * La entrada al CRM con usuario y clave.
 *
 * El servidor emite una sesión (`/crm/auth/entrar`) y la comprueba en cada
 * petición contra la base, así que desactivar a alguien o cambiarle la clave
 * le cierra la sesión en la siguiente petición, sin esperar a que caduque.
 *
 * Con clave provisional la sesión sólo sirve para cambiarla: `checkAuth` la
 * trata como «sin entrar» para que la pantalla de acceso, que es la que sabe
 * pedir la nueva, siga delante.
 */
export const authProvider: AuthProvider = {
  async login({ username, password }: { username?: string; password?: string }) {
    if (!username?.trim() || !password) {
      throw new Error("Escribe tu usuario y tu clave.");
    }
    const sesion: SesionCrm = await pedirAuth("/entrar", {
      usuario: username.trim(),
      clave: password,
    });
    fijarSesion(sesion);
    if (sesion.debeCambiarClave) {
      // La pantalla de acceso lo detecta y pide la nueva. Se lanza para que
      // react-admin no navegue al tablero con una sesión que no sirve.
      const error: any = new Error("Tienes que cambiar la clave provisional.");
      error.debeCambiarClave = true;
      throw error;
    }
  },

  async logout() {
    fijarSesion(null);
  },

  async checkAuth() {
    const sesion = sesionActual();
    if (!sesion?.token || sesion.debeCambiarClave) {
      throw new Error("Hace falta entrar al CRM.");
    }
  },

  async checkError(error: { status?: number }) {
    // 401: la sesión caducó, se cerró al cambiar la clave en otro sitio o la
    // persona fue desactivada. 403 no: es «esto no te toca», y echar a alguien
    // del CRM por pulsar un botón de administrador sería castigarle por mirar.
    if (error?.status === 401) {
      fijarSesion(null);
      throw new Error("La sesión ha caducado. Vuelve a entrar.");
    }
  },

  async getIdentity() {
    const sesion = sesionActual();
    if (!sesion) throw new Error("Sin sesión");
    return { id: sesion.usuario, fullName: sesion.usuario };
  },

  async getPermissions() {
    // Atomic esconde la gestión de usuarios a quien no sea "admin"
    // (`providers/commons/canAccess.ts`). El servidor lo vuelve a comprobar:
    // esto sólo decide qué se enseña.
    return sesionActual()?.administrador ? "admin" : "user";
  },

  // La regla de Atomic: quien no es administrador no ve usuarios ni
  // configuración. Antes no se declaraba porque no había roles y todo el mundo
  // era "admin"; ahora sí los hay.
  async canAccess(params) {
    return canAccess(sesionActual()?.administrador ? "admin" : "user", params);
  },
};
