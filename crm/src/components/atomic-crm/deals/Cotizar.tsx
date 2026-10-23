import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calcularCotizacion,
  cotizar,
  listarCotizadores,
  NOMBRE_DE_PERIODICIDAD,
  type Calculo,
  type Cotizador,
} from "../providers/friday/cotizadores";
import { dinero } from "../providers/friday/proformas";

/**
 * Cotizar este servicio para esta empresa.
 *
 * Se responden las preguntas del cotizador y sale el precio, con el detalle
 * de en qué se va el tiempo. Guardarla la deja atada a la oportunidad: la
 * próxima renovación se discute mirando qué se cotizó y con qué números, no
 * de memoria.
 */
export const Cotizar = ({
  dealId,
  alCotizar,
}: {
  dealId: string | number;
  alCotizar?: (precio: number, descripcion: string, cotizacion: string) => void;
}) => {
  const [cotizadores, setCotizadores] = useState<Cotizador[]>([]);
  const [elegido, setElegido] = useState<string>("");
  const [valores, setValores] = useState<Record<string, number>>({});
  const [calculo, setCalculo] = useState<Calculo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  useEffect(() => {
    listarCotizadores()
      .then((todos) => setCotizadores(todos.filter((c) => c.activo)))
      .catch((e) => setError(e.message));
  }, []);

  const cotizadorActual = cotizadores.find((c) => c.codigo === elegido);

  useEffect(() => {
    if (!cotizadorActual) return;
    const iniciales: Record<string, number> = {};
    for (const v of cotizadorActual.variables) iniciales[v.codigo] = Number(v.valor_defecto);
    setValores(iniciales);
    setGuardado(null);
  }, [cotizadorActual]);

  const recalcular = useCallback(async () => {
    if (!elegido) return;
    try {
      setCalculo(await calcularCotizacion(elegido, valores));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [elegido, valores]);

  useEffect(() => {
    void recalcular();
  }, [recalcular]);

  const guardar = async () => {
    if (!elegido || !calculo) return;
    try {
      const hecha = await cotizar(elegido, valores, dealId);
      setGuardado(String(hecha.id));
      alCotizar?.(
        hecha.precio,
        `${cotizadorActual?.nombre ?? elegido} (${NOMBRE_DE_PERIODICIDAD[hecha.cotizador.periodicidad]})`,
        String(hecha.id),
      );
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (cotizadores.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground tracking-wide">Cotizador</span>
        <select
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
        >
          <option value="">Calcular un precio…</option>
          {cotizadores.map((c) => (
            <option key={c.codigo} value={c.codigo}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {cotizadorActual && (
        <>
          <div className="flex flex-wrap gap-2">
            {cotizadorActual.variables.map((v) => (
              <label key={v.codigo} className="text-xs text-muted-foreground flex flex-col gap-1">
                {v.nombre}
                <Input
                  className="h-8 w-36"
                  inputMode="decimal"
                  value={String(valores[v.codigo] ?? "")}
                  onChange={(e) =>
                    setValores({ ...valores, [v.codigo]: Number(e.target.value || 0) })
                  }
                />
              </label>
            ))}
          </div>

          {calculo && (
            <div className="border rounded-md p-2 space-y-1">
              <table className="w-full text-sm">
                <tbody>
                  {calculo.detalle.map((l) => (
                    <tr key={l.orden}>
                      <td className="py-0.5">{l.nombre}</td>
                      <td className="py-0.5 text-right text-muted-foreground tabular-nums">
                        {l.horas} h × {dinero(l.costo_hora)}
                      </td>
                      <td className="py-0.5 text-right tabular-nums w-20">{dinero(l.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/*
                Se enseña el costo y la ganancia, no sólo el precio: quien
                negocia un descuento tiene que ver cuánto margen le queda
                antes de concederlo, no después.
              */}
              <div className="flex justify-between text-xs text-muted-foreground border-t pt-1">
                <span>
                  {calculo.horas} h · costo {dinero(calculo.costo)} · ganancia{" "}
                  {dinero(calculo.ganancia)}
                </span>
                <span className="font-medium text-foreground">
                  {dinero(calculo.precio)}{" "}
                  {NOMBRE_DE_PERIODICIDAD[calculo.cotizador.periodicidad]}
                </span>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={guardar} disabled={!calculo}>
              Guardar la cotización
            </Button>
            {guardado && <Badge variant="outline">Guardada y puesta en la proforma</Badge>}
          </div>
        </>
      )}
    </div>
  );
};
