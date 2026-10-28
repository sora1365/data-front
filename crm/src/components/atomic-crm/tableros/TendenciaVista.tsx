import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  dinero,
  nombreDeMes,
  tendencia,
  type FiltrosDeTablero,
  type MesDeTendencia,
} from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

/**
 * Mes a mes, con el mismo mes del año anterior.
 *
 * Una sola serie en el gráfico —lo vendido— y la comparación en la tabla:
 * dos series de barras que se tapan se leen peor que una columna con el
 * porcentaje de cambio al lado.
 */
export const TendenciaVista = ({ filtros }: { filtros: FiltrosDeTablero }) => {
  const [meses, setMeses] = useState(12);
  const { datos, error, cargando } = useCarga(
    () => tendencia(filtros, meses),
    [JSON.stringify(filtros), meses],
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (cargando && !datos) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!datos) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="border rounded-lg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-xs text-muted-foreground">Vendido por mes</p>
          <div className="flex gap-1 print:hidden">
            {[6, 12, 24].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={n === meses ? "default" : "outline"}
                onClick={() => setMeses(n)}
              >
                {n} meses
              </Button>
            ))}
          </div>
        </div>
        <Barras datos={datos} />
      </div>

      <div className="border rounded-lg p-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="font-normal pb-1">Mes</th>
              <th className="font-normal pb-1 text-right">Abiertas</th>
              <th className="font-normal pb-1 text-right">Ganadas</th>
              <th className="font-normal pb-1 text-right">Perdidas</th>
              <th className="font-normal pb-1 text-right">Tasa de cierre</th>
              <th className="font-normal pb-1 text-right">Ticket</th>
              <th className="font-normal pb-1 text-right">Vendido</th>
              <th className="font-normal pb-1 text-right">Hace un año</th>
              <th className="font-normal pb-1 text-right">Cambio</th>
            </tr>
          </thead>
          <tbody>
            {[...datos].reverse().map((m) => (
              <tr key={m.mes} className="border-t">
                <td className="py-1 pr-2 whitespace-nowrap">
                  {nombreDeMes(m.mes)}
                  {m.enCurso && <span className="text-xs text-muted-foreground"> (en curso)</span>}
                </td>
                <td className="py-1 text-right tabular-nums">{m.abiertas}</td>
                <td className="py-1 text-right tabular-nums">{m.ganadas}</td>
                <td className="py-1 text-right tabular-nums">{m.perdidas}</td>
                <td className="py-1 text-right tabular-nums">
                  {m.tasaDeCierre === null ? "—" : `${m.tasaDeCierre} %`}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {m.ticketPromedio === null ? "—" : dinero(m.ticketPromedio)}
                </td>
                <td className="py-1 text-right tabular-nums font-medium">{dinero(m.vendido)}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {dinero(m.vendidoAnioAnterior)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {m.variacionAnual === null
                    ? "—"
                    : `${m.variacionAnual > 0 ? "▲ +" : m.variacionAnual < 0 ? "▼ " : ""}${m.variacionAnual} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground mt-2">
          El mes en curso compara un mes a medias con uno entero: su cambio se lee
          con cuidado.
        </p>
      </div>
    </div>
  );
};

/** Columnas de lo vendido, con la cifra al pasar por encima. */
const Barras = ({ datos }: { datos: MesDeTendencia[] }) => {
  const [encima, setEncima] = useState<string | null>(null);
  const mayor = Math.max(1, ...datos.map((m) => m.vendido));

  return (
    <div className="relative">
      <div className="flex items-end gap-0.5 h-40 border-b">
        {datos.map((m) => (
          <div
            key={m.mes}
            className="flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setEncima(m.mes)}
            onMouseLeave={() => setEncima(null)}
          >
            <div
              className={`w-full rounded-t ${m.enCurso ? "bg-primary/35" : "bg-primary/70"} ${
                encima === m.mes ? "outline outline-2 outline-primary/40" : ""
              }`}
              style={{ height: `${(m.vendido / mayor) * 100}%`, minHeight: m.vendido ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-1">
        {datos.map((m, i) => (
          <span key={m.mes} className="flex-1 text-center text-[10px] text-muted-foreground truncate">
            {/* Una de cada dos etiquetas con muchos meses: si no, se pisan. */}
            {datos.length <= 12 || i % 2 === 0 ? nombreDeMes(m.mes).split(" ")[0] : ""}
          </span>
        ))}
      </div>
      {encima && (
        <div className="absolute top-0 right-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">
          {(() => {
            const m = datos.find((x) => x.mes === encima)!;
            return (
              <>
                <span className="font-medium">{nombreDeMes(m.mes)}</span>: {dinero(m.vendido)} ·{" "}
                {m.ganadas} venta(s)
                {m.variacionAnual !== null ? ` · ${m.variacionAnual} % frente a hace un año` : ""}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
