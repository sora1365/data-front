import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Las reglas de la entrada al CRM, sin base de datos ni Nest por medio, para
 * poder probarlas solas.
 */

// ------------------------------------------------------------------- claves

/**
 * Parámetros de scrypt. N = 2^15 tarda unas decenas de milisegundos: nada para
 * quien entra una vez al día, demasiado para quien prueba un millón de claves.
 * Van escritos dentro de cada hash para poder subirlos mañana sin invalidar
 * las claves de hoy.
 */
const N = 32768;
const R = 8;
const P = 1;
const LARGO = 32;
// scrypt con N = 2^15 y r = 8 necesita 32 MB; el tope por defecto de Node es
// justo 32 MB y lo rechaza por un byte.
const MEMORIA = 64 * 1024 * 1024;

/** Lo mínimo que se le pide a una clave. */
export const CLAVE_MINIMA = 10;

/**
 * Por qué una clave no vale, o `null` si vale.
 *
 * Sólo se exige largo, no mezclas de mayúsculas y símbolos: esas reglas
 * producen `Empresa2026!`, que se adivina antes que una frase larga sin
 * ningún símbolo.
 */
export function problemaDeClave(clave: string, usuario: string): string | null {
  if (typeof clave !== 'string' || clave.length < CLAVE_MINIMA) {
    return `La clave necesita al menos ${CLAVE_MINIMA} caracteres.`;
  }
  if (clave.length > 200) return 'La clave es demasiado larga.';
  if (clave.toLowerCase().includes(usuario.toLowerCase())) {
    return 'La clave no puede contener tu usuario.';
  }
  return null;
}

/** `scrypt$N$r$p$sal$hash`, todo lo necesario para comprobarla después. */
export function cifrarClave(clave: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(clave, sal, LARGO, { N, r: R, p: P, maxmem: MEMORIA });
  return ['scrypt', N, R, P, sal.toString('base64'), hash.toString('base64')].join('$');
}

export function claveCorrecta(clave: string, guardado: string | null): boolean {
  if (!guardado) return false;
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = scryptSync(clave, Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MEMORIA,
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/**
 * La clave provisional que pone un administrador.
 *
 * Sin caracteres que se confunden al dictarla o copiarla de una pantalla
 * (0/O, 1/l/I): se la va a pasar alguien a otra persona por teléfono.
 */
export function claveProvisional(): string {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  let clave = '';
  for (const b of bytes) clave += alfabeto[b % alfabeto.length];
  return `${clave.slice(0, 7)}-${clave.slice(7)}`;
}

// ------------------------------------------------------------------ bloqueo

/** Intentos fallidos seguidos antes de bloquear, y durante cuánto. */
export const INTENTOS_MAXIMOS = 5;
export const BLOQUEO_MINUTOS = 15;

/**
 * Hasta cuándo está bloqueado un usuario, o `null` si puede intentarlo.
 *
 * Recibe sus últimos intentos, del más reciente al más antiguo. Cuentan sólo
 * los fallos seguidos desde la última entrada buena: quien se equivocó tres
 * veces el lunes y entró bien no arrastra esos tres al martes.
 *
 * El bloqueo cae sobre el usuario y no sobre la IP. Por IP, una oficina entera
 * detrás del mismo router se bloquearía por el despiste de una persona.
 */
export function bloqueadoHasta(
  intentos: { exito: boolean; en: Date }[],
  ahora: Date = new Date(),
): Date | null {
  const fallos: Date[] = [];
  for (const i of intentos) {
    if (i.exito) break;
    fallos.push(i.en);
  }
  if (fallos.length < INTENTOS_MAXIMOS) return null;
  const hasta = new Date(fallos[0].getTime() + BLOQUEO_MINUTOS * 60_000);
  return hasta > ahora ? hasta : null;
}

// ------------------------------------------------------------------ secreto

/**
 * El secreto con el que se firman las sesiones, o `null` si no sirve.
 *
 * El `.env` de ejemplo trae `JWT_SECRET=your-secret-key…`, y un secreto que
 * está publicado en el repositorio es como no tener ninguno: cualquiera
 * fabrica una sesión de administrador. Así que se rechaza igual que si
 * faltara, y **sin secreto válido el CRM no deja entrar** (503), en vez de
 * abrirse. Es la misma regla que la llave del contable.
 */
export function secretoValido(valor: string | undefined): string | null {
  const s = valor?.trim() ?? '';
  if (s.length < 32) return null;
  if (/^(your|change|secret|cambia)/i.test(s)) return null;
  return s;
}

// ----------------------------------------------------------- comerciales

/** Lo que cada quien puede tocar de su propia ficha. */
const CAMPOS_PROPIOS = ['first_name', 'last_name', 'email', 'avatar'];

/**
 * Por qué no se permite escribir en `sales` (los usuarios del CRM), o `null`.
 *
 * Es un recurso más del API genérico, y sin esta regla cualquiera se haría
 * administrador con un `PUT` sobre su propia ficha. Cada uno puede cambiar su
 * nombre y su correo; lo demás —dar de alta, desactivar, nombrar
 * administradores— es de un administrador.
 */
export function problemaAlEscribirComercial(
  quien: { username: string; administrador: boolean },
  operacion: 'crear' | 'editar' | 'borrar',
  id?: string,
  cuerpo: Record<string, unknown> = {},
): string | null {
  if (quien.administrador) {
    if (operacion === 'editar' && id === quien.username && cuerpo.administrator === false) {
      // Quitarse a uno mismo el permiso puede dejar el CRM sin nadie que dé
      // altas ni restablezca claves.
      return 'No puedes quitarte a ti mismo el permiso de administrador.';
    }
    if (operacion === 'editar' && id === quien.username && cuerpo.disabled === true) {
      return 'No puedes desactivarte a ti mismo.';
    }
    if (operacion === 'crear') return 'Los usuarios se dan de alta en /crm/auth/usuarios.';
    return null;
  }
  if (operacion !== 'editar' || id !== quien.username) {
    return 'Sólo un administrador puede gestionar los usuarios del CRM.';
  }
  const ajenos = Object.keys(cuerpo).filter(
    (c) => !CAMPOS_PROPIOS.includes(c) && c !== 'id' && cuerpo[c] !== undefined,
  );
  // La pantalla de perfil manda la ficha entera, con `administrator` y
  // `disabled` tal como estaban. Sólo se rechaza si intenta cambiarlos.
  const cambiaPermisos =
    (ajenos.includes('administrator') && cuerpo.administrator !== false) ||
    (ajenos.includes('disabled') && cuerpo.disabled !== false);
  return cambiaPermisos ? 'Sólo un administrador puede cambiar permisos.' : null;
}

// ------------------------------------------------------------------- rutas

/**
 * Si una ruta es del CRM y, por tanto, pide sesión.
 *
 * El guardia es global, pero sólo vigila `/crm`: el resto de FRIDAY (el 3000)
 * sigue firmando con `X-Usuario` como hasta ahora. Proteger las dos cosas en
 * el mismo cambio dejaría el gestor comercial sin poder entrar hasta tener su
 * propia pantalla de acceso.
 */
export function esRutaDelCrm(ruta: string): boolean {
  return ruta === '/crm' || ruta.startsWith('/crm/');
}

/** Lo que se puede hacer con una sesión que todavía debe cambiar la clave. */
export function permitidaConClaveProvisional(ruta: string): boolean {
  return ruta.startsWith('/crm/auth/');
}
