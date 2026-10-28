import { Link } from "react-router";
import { Cifra } from "./Cifra";
import { dinero, pipeline, type FiltrosDeTablero } from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

/**
 * Dónde está el dinero abierto y dónde se atasca.
 *
 * El cuello de botella se mide con lo que **ya salió** de cada etapa, no con
 * lo que sigue dentro: es la diferencia entre «aquí se tarda» y «aquí hay
 * mucho ahora mismo», que piden remedios distintos.
 */
export const PipelineVista = ({ filtros }: { filtros: FiltrosDeTablero }) => {
  const { datos, error, cargando } = useCarga(() => pipeline(filtros), [JSON.stringify(filtros)]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (cargando && !datos) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!datos) return null;

  const mayor = Math.max(1, ...datos.porEtapa.map((e) => e.valor));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Abiertas" valor={String(datos.abiertas)} pie={`${dinero(datos.valor)} en juego`} />
        <Cifra titulo="Ponderado" valor={dinero(datos.ponderado)} pie="por la probabilidad de su etapa" />
        <Cifra
          titulo="Antigüedad media"
          valor={datos.edadMedia === null ? "—" : `${datos.edadMedia} d`}
          pie="desde que se abrieron"
        />
        <Cifra
          titulo="Estancadas"
          valor={String(datos.totalEstancadas)}
          pie={`más de ${datos.diasParaEstancada} días sin moverse`}
        />
      </div>

      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">Por etapa</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="font-normal pb-1">Etapa</th>
              <th className="font-normal pb-1" />
              <th className="font-normal pb-1 text-right">Abiertas</th>
              <th className="font-normal pb-1 text-right">Valor</th>
              <th className="font-normal pb-1 text-right">Ponderado</th>
              <th className="font-normal pb-1 text-right">Días en la etapa</th>
              <th className="font-normal pb-1 text-right">Paradas</th>
            </tr>
          </thead>
          <tbody>
            {datos.porEtapa.map((e) => (
              <tr key={e.codigo} className="border-t">
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {e.nombre} <span className="text-xs text-muted-foreground">{e.probabilidad} %</span>
                </td>
                <td className="py-1.5 pr-3 w-1/4">
                  <div
                    className="h-4 bg-primary/70 rounded-r"
                    style={{ width: `${(e.valor / mayor) * 100}%` }}
                    title={`${e.cuenta} abiertas · ${dinero(e.valor)}`}
                  />
                </td>
                <td className="py-1.5 text-right tabular-nums">{e.cuenta}</td>
                <td className="py-1.5 text-right tabular-nums">{dinero(e.valor)}</td>
                <td className="py-1.5 text-right tabular-nums">{dinero(e.ponderado)}</td>
                <td className="py-1.5 text-right tabular-nums">{e.diasEnEtapa ?? "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{e.estancadas || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Cuánto se tarda en salir de cada etapa (último año)
          </p>
          {datos.cuello && (
            <p className="text-sm mb-2">
              El cuello de botella es <strong>{datos.cuello.nombre}</strong>: la mitad de
              las oportunidades tarda más de {datos.cuello.diasMediana} días en salir.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Etapa</th>
                <th className="font-normal pb-1 text-right">Mediana</th>
                <th className="font-normal pb-1 text-right">Media</th>
                <th className="font-normal pb-1 text-right">Salidas</th>
              </tr>
            </thead>
            <tbody>
              {datos.tiempos.map((t) => (
                <tr key={t.codigo} className="border-t">
                  <td className="py-1">{t.nombre}</td>
                  <td className="py-1 text-right tabular-nums">
                    {t.diasMediana === null ? "—" : `${t.diasMediana} d`}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {t.diasMedios === null ? "—" : `${t.diasMedios} d`}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">{t.salidas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Paradas, de mayor importe a menor
          </p>
          {datos.estancadas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna parada. Bien.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {datos.estancadas.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="py-1 pr-2">
                      <Link className="underline" to={`/deals/${o.id}/show`}>
                        {o.nombre || o.empresa}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {o.empresa} · {o.etapa} · {o.comercial ?? "sin asignar"}
                      </div>
                    </td>
                    <td className="py-1 text-right tabular-nums">{dinero(o.monto)}</td>
                    <td className="py-1 pl-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {o.diasSinMovimiento} d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
