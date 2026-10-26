/**
 * Qué guion sale en una llamada.
 *
 * Una regla sola, pero conviene tenerla aparte y probada: si elige mal, quien
 * llama lee en voz alta lo que no toca, y eso no da error en ningún sitio.
 */

export interface Guion {
  codigo: string;
  nombre: string;
  producto: string | null;
  segmento: string | null;
  activo?: boolean;
}

/**
 * El más específico gana: producto y segmento, luego producto, luego
 * segmento, y por último el general.
 *
 * Es el mismo orden que en las reglas de comisión, a propósito: dos formas
 * distintas de resolver «cuál de estos aplica» en el mismo sistema obligan a
 * recordar cuál es cuál, y es la clase de detalle que se recuerda al revés.
 *
 * A una empresa recién creada no se le dice lo mismo que a una que acaba de
 * cruzar el umbral de auditoría, aunque se le esté ofreciendo lo mismo.
 */
export function guionAplicable<T extends Guion>(
  guiones: T[],
  contexto: { producto?: string | null; segmento?: string | null },
): T | null {
  const candidatos = guiones.filter(
    (g) =>
      g.activo !== false &&
      (g.producto === null || g.producto === contexto.producto) &&
      (g.segmento === null || g.segmento === contexto.segmento),
  );
  if (candidatos.length === 0) return null;

  const peso = (g: T) => (g.producto ? 2 : 0) + (g.segmento ? 1 : 0);
  return [...candidatos].sort((a, b) => peso(b) - peso(a))[0];
}

export interface Objecion {
  objecion: string;
  respuesta: string;
}

/**
 * Limpia lo que llega de la pantalla antes de guardarlo.
 *
 * Las filas vacías se caen —en una tabla que se edita siempre quedan dos o
 * tres a medio escribir— y una objeción sin respuesta también: media objeción
 * en la pantalla de alguien que está llamando es peor que ninguna, porque la
 * lee y se queda a medias.
 */
export function limpiarObjeciones(entradas: unknown): Objecion[] {
  if (!Array.isArray(entradas)) return [];
  return entradas
    .map((o: any) => ({
      objecion: String(o?.objecion ?? '').trim(),
      respuesta: String(o?.respuesta ?? '').trim(),
    }))
    .filter((o) => o.objecion && o.respuesta);
}

export function limpiarPreguntas(entradas: unknown): string[] {
  if (!Array.isArray(entradas)) return [];
  return entradas.map((p: any) => String(p ?? '').trim()).filter(Boolean);
}
