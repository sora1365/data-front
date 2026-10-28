import { useEffect, useState } from "react";

/**
 * Pide algo y lo vuelve a pedir cuando cambian sus dependencias.
 *
 * Descarta la respuesta de una petición vieja: al cambiar de filtro rápido,
 * la respuesta lenta del filtro anterior llegaría después y pintaría encima
 * los números de lo que ya no se está mirando.
 */
export function useCarga<T>(pedir: () => Promise<T>, dependencias: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    pedir()
      .then((d) => {
        if (!vigente) return;
        setDatos(d);
        setError(null);
      })
      .catch((e) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, vuelta]);

  return { datos, error, cargando, recargar: () => setVuelta((v) => v + 1) };
}
