import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Cifra } from "./Cifra";
import {
  dinero,
  nombreDeMes,
  pronostico,
  type FiltrosDeTablero,
} from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

/**
 * Lo que viene: el pipeline abierto por mes de cierre previsto.
 *
 * Tres cifras por mes y cada una dice otra cosa: **abierto** es todo lo que
 * dice cerrar, **ponderado** es eso por la probabilidad de su etapa, y
 * **comprometido** es lo que está en etapas de 75 % o más, que es lo que se
 * le puede prometer a gerencia.
 */
export const PronosticoVista = ({ filtros }: { filtros: FiltrosDeTablero }) => {
  const [meses, setMeses] = useState(3);
  const { datos, error, cargando } = useCarga(
    () => pronostico(filtros, meses),
    [JSON.stringify(filtros), meses],
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (cargando && !datos) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!datos) return null;

  const mayor = Math.max(1, ...datos.meses.map((m) => m.abierto));
  const { meta, ganado, esperado } = datos.mesActual;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Ganado este mes" valor={dinero(ganado)} pie="ventas registradas" />
        <Cifra
          titulo="Cierre esperado del mes"
          valor={dinero(esperado)}
          pie="ganado + ponderado de lo que queda"
        />
        <Cifra
          titulo="Meta del mes"
          valor={meta === null ? "—" : dinero(meta)}
          pie={
            meta === null
              ? "sin meta puesta"
              : `${Math.round((esperado / meta) * 100)} % de la meta, si se cumple lo previsto`
          }
        />
        <Cifra
          titulo="Fuera del pronóstico"
          valor={dinero(datos.atrasadas.monto + datos.sinFecha.monto)}
          pie={`${datos.atrasadas.cuenta} con fecha pasada · ${datos.sinFecha.cuenta} sin fecha`}
        />
      </div>

      <div className="border rounded-lg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs text-muted-foreground">
            Ponderado por mes de cierre previsto (la barra clara es todo lo abierto)
          </p>
          <div className="flex gap-1 print:hidden">
            {[3, 6, 12].map((n) => (
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="font-normal pb-1 w-24">Mes</th>
              <th className="font-normal pb-1" />
              <th className="font-normal pb-1 text-right">Abierto</th>
              <th className="font-normal pb-1 text-right">Ponderado</th>
              <th
                className="font-normal pb-1 text-right"
                title="Con la tasa a la que de verdad se ganan las que pasan por cada etapa"
              >
                Según historial
              </th>
              <th className="font-normal pb-1 text-right">Comprometido</th>
            </tr>
          </thead>
          <tbody>
            {datos.meses.map((m) => (
              <tr key={m.mes} className="border-t">
                <td className="py-1.5 pr-2 whitespace-nowrap">{nombreDeMes(m.mes)}</td>
                <td className="py-1.5 pr-3 w-1/3">
                  <div
                    className="relative h-4 bg-primary/15 rounded-r"
                    style={{ width: `${(m.abierto / mayor) * 100}%` }}
                    title={`${m.cuenta} oportunidad(es): ${dinero(m.abierto)} abierto, ${dinero(m.ponderado)} ponderado`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/70 rounded-r"
                      style={{ width: m.abierto ? `${(m.ponderado / m.abierto) * 100}%` : 0 }}
                    />
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums">{dinero(m.abierto)}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{dinero(m.ponderado)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {m.ponderadoObservado === null ? "—" : dinero(m.ponderadoObservado)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{dinero(m.comprometido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Probabilidad por etapa: la que se puso y la que dicen los hechos
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Etapa</th>
                <th className="font-normal pb-1 text-right">Declarada</th>
                <th className="font-normal pb-1 text-right">Observada</th>
                <th className="font-normal pb-1 text-right">Muestra</th>
              </tr>
            </thead>
            <tbody>
              {datos.etapas.map((e) => (
                <tr key={e.codigo} className="border-t">
                  <td className="py-1">{e.nombre}</td>
                  <td className="py-1 text-right tabular-nums">{e.declarada} %</td>
                  <td className="py-1 text-right tabular-nums">
                    {e.probabilidad === null ? "sin datos" : `${e.probabilidad} %`}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">{e.muestra}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-2">
            Observada: de las cerradas en el último año que pasaron por la etapa,
            cuántas se ganaron. Con menos de 10 no se da un porcentaje.
          </p>
        </div>

        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">Este mes, por comercial</p>
          {datos.porComercial.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada abierto con cierre previsto este mes.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left">
                  <th className="font-normal pb-1">Comercial</th>
                  <th className="font-normal pb-1 text-right">Abierto</th>
                  <th className="font-normal pb-1 text-right">Ponderado</th>
                </tr>
              </thead>
              <tbody>
                {datos.porComercial.map((c) => (
                  <tr key={c.comercial} className="border-t">
                    <td className="py-1">{c.nombre}</td>
                    <td className="py-1 text-right tabular-nums">{dinero(c.abierto)}</td>
                    <td className="py-1 text-right tabular-nums">{dinero(c.ponderado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Las oportunidades con fecha de cierre ya pasada no se arrastran al mes en
        curso: se cuentan aparte hasta que alguien les ponga una fecha creíble.
      </p>
    </div>
  );
};
