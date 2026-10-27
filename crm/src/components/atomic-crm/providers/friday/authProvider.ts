import type { AuthProvider } from "ra-core";
import { fijarUsuario, usuarioActual } from "./dataProvider";

/**
 * La identidad mientras FRIDAY no tenga autenticación.
 *
 * El resto de FRIDAY firma cada escritura con la cabecera `X-Usuario`: no hay
 * contraseñas ni sesiones, sólo un nombre que la persona escribe una vez. Este
 * proveedor hace lo mismo para que las pantallas de Atomic —que esperan un
 * usuario identificado— funcionen sin fingir una seguridad que no existe.
 *
 * **No protege nada, y así tiene que leerse.** `checkAuth` sólo exige que haya
 * un nombre escrito, porque sin él el servidor rechaza toda escritura y la
 * persona vería errores sin entender por qué. El día que haya un login de
 * verdad, este archivo y `dataProvider.ts` son los únicos que cambian.
 */
export const authProvider: AuthProvider = {
  async login({ username }: { username?: string }) {
    if (!username?.trim()) {
      throw new Error("Escribe tu nombre: es lo que firma todo lo que hagas.");
    }
    fijarUsuario(username);
  },

  async logout() {
    // No se borra el nombre: no es una sesión, es la firma de quien usa este
    // ordenador. Borrarla obligaría a reescribirla cada mañana.
  },

  async checkAuth() {
    if (!usuarioActual()) {
      throw new Error("Falta tu nombre para poder firmar lo que hagas.");
    }
  },

  async checkError(error: { status?: number }) {
    // Sin sesiones no hay nada que caduque: un 401 o un 403 aquí significaría
    // que el servidor cambió, no que haya que volver a entrar.
    if (error?.status === 401) {
      throw new Error("El servidor pide autenticación y el CRM todavía no la tiene.");
    }
  },

  async getIdentity() {
    const usuario = usuarioActual();
    return { id: usuario, fullName: usuario };
  },

  async getPermissions() {
    // Todo el mundo es administrador mientras no haya roles. El valor importa:
    // la comprobación que trae Atomic (`providers/commons/canAccess.ts`)
    // esconde la pantalla de usuarios a quien no lo sea.
    return "admin";
  },

  // `canAccess` se deja sin implementar a propósito: react-admin sólo filtra
  // rutas cuando el proveedor lo define, y aquí no hay permisos que aplicar.
  // Declararlo devolviendo `true` no es lo mismo que no tenerlo, y deja
  // pantallas fuera del menú sin decir por qué. Los permisos llegan con el
  // bloque de roles.
};
