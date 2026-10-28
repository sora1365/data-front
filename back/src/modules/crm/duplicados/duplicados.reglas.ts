/**
 * Cuándo dos fichas son la misma, y cómo se juntan.
 *
 * Puras, para probarlas sin base de datos: lo delicado de los duplicados no es
 * la consulta sino decidir qué cuenta como «el mismo», y eso es lo que hay que
 * poder discutir con ejemplos.
 */

export type Motivo = 'correo' | 'telefono' | 'nombre' | 'ruc';

export interface Par {
  a: number;
  b: number;
  motivos: Motivo[];
}

// ---------------------------------------------------------------- normalizar

export function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Un correo comparable: minúsculas y sin espacios. */
export function claveDeCorreo(correo: unknown): string | null {
  const c = String(correo ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? c : null;
}

/**
 * Un teléfono comparable: los últimos nueve dígitos.
 *
 * En Ecuador el mismo celular se escribe `0991234567`, `+593 99 123 4567` o
 * `593991234567`; lo que no cambia son los nueve últimos. Con menos de nueve
 * cifras no es un teléfono completo y no se compara: dos extensiones «105» no
 * hacen a dos personas la misma.
 */
export function claveDeTelefono(telefono: unknown): string | null {
  const d = String(telefono ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/** Un nombre de persona comparable: sin acentos, mayúsculas ni espacios de más. */
export function claveDeNombre(nombre: unknown, apellido?: unknown): string | null {
  const t = sinAcentos(`${nombre ?? ''} ${apellido ?? ''}`).toLowerCase().replace(/\s+/g, ' ').trim();
  // Un nombre solo («Juan») junta a medio país.
  return t.split(' ').length >= 2 ? t : null;
}

/**
 * Las formas societarias que no distinguen a una empresa de otra.
 *
 * «ACME S.A.», «Acme SA» y «ACME, Sociedad Anónima» son la misma empresa
 * escrita por tres personas. Se quitan sólo al final del nombre: «Sociedad
 * Agrícola del Sur» no pierde «Sociedad».
 */
const FORMAS_SOCIETARIAS = [
  'sociedad anonima',
  'sociedad por acciones simplificada',
  'compania limitada',
  'cia ltda',
  'cia',
  'ltda',
  'sas',
  'sa',
  'cl',
  'ep',
];

export function claveDeEmpresa(nombre: unknown): string | null {
  let t = sinAcentos(String(nombre ?? ''))
    .toLowerCase()
    .replace(/[.,'"“”]/g, ' ')
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const f of FORMAS_SOCIETARIAS) {
      // «s a» es «S. A.» después de quitar los puntos.
      const forma = f === 'sa' ? '(sa|s a)' : f === 'sas' ? '(sas|s a s)' : f === 'cia ltda' ? '(cia ltda|c ltda)' : f;
      const re = new RegExp(`\\s${forma}$`);
      if (re.test(t)) {
        t = t.replace(re, '').trim();
        cambio = true;
      }
    }
  }
  return t.length >= 3 ? t : null;
}

export function claveDeRuc(ruc: unknown): string | null {
  const d = String(ruc ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d : null;
}

// ------------------------------------------------------------------- agrupar

/**
 * Los pares que comparten alguna clave, con todos los motivos por los que se
 * parecen.
 *
 * Una clave compartida por muchas fichas no es un duplicado sino un dato
 * genérico —el correo de la oficina, el teléfono de la centralita— y juntarlas
 * todas sería un desastre: a partir de `maxPorClave` se ignora.
 */
export function agrupar<T extends { id: number }>(
  fichas: T[],
  claves: (f: T) => { motivo: Motivo; clave: string | null }[],
  excluidos: Set<string> = new Set(),
  maxPorClave = 4,
): Par[] {
  const porClave = new Map<string, { motivo: Motivo; ids: Set<number> }>();
  for (const f of fichas) {
    for (const { motivo, clave } of claves(f)) {
      if (!clave) continue;
      const k = `${motivo}:${clave}`;
      const g = porClave.get(k) ?? { motivo, ids: new Set<number>() };
      g.ids.add(f.id);
      porClave.set(k, g);
    }
  }

  const pares = new Map<string, Par>();
  for (const { motivo, ids } of porClave.values()) {
    if (ids.size < 2 || ids.size > maxPorClave) continue;
    const lista = [...ids].sort((x, y) => x - y);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const k = claveDePar(lista[i], lista[j]);
        if (excluidos.has(k)) continue;
        const p = pares.get(k) ?? { a: lista[i], b: lista[j], motivos: [] };
        if (!p.motivos.includes(motivo)) p.motivos.push(motivo);
        pares.set(k, p);
      }
    }
  }

  // Primero los que se parecen por más cosas: un RUC y un nombre iguales
  // son casi seguro la misma empresa; sólo un nombre, quizá no.
  const peso: Record<Motivo, number> = { ruc: 4, correo: 3, telefono: 2, nombre: 1 };
  const total = (p: Par) => p.motivos.reduce((s, m) => s + peso[m], 0);
  return [...pares.values()].sort((x, y) => total(y) - total(x) || x.a - y.a);
}

export const claveDePar = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);

// -------------------------------------------------------------------- juntar

const vacio = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Lo que queda en la ficha ganadora: lo suyo, y lo del perdedor donde ella no
 * tenía nada. Nunca se pisa un dato del ganador: si los dos tienen cargo y no
 * coinciden, quien eligió al ganador eligió también su versión.
 */
export function rellenar<T extends Record<string, any>>(ganador: T, perdedor: T, campos: (keyof T)[]): Partial<T> {
  const cambios: Partial<T> = {};
  for (const c of campos) {
    if (vacio(ganador[c]) && !vacio(perdedor[c])) cambios[c] = perdedor[c];
  }
  return cambios;
}

/** Une dos listas sin repetir, conservando el orden del ganador primero. */
export function unir<T>(a: T[] | null | undefined, b: T[] | null | undefined, clave: (x: T) => string | null): T[] {
  const vistos = new Set<string>();
  const salida: T[] = [];
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    const k = clave(x);
    if (k === null || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(x);
  }
  return salida;
}
