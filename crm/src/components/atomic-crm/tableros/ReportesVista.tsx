import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogosCrm } from "../providers/friday/leads";
import {
  borrarReporte,
  catalogoDeReportes,
  conFormato,
  descargarExcel,
  ejecutarReporte,
  enviarReporteAhora,
  guardarReporte,
  reportesGuardados,
  type DefinicionDeReporte,
  type FiltrosDeTablero,
  type ReporteGuardado,
  type ResultadoDeReporte,
} from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

const hoy = new Date();
const dia = (f: Date) =>
  `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;

/**
 * Reportes que cada quien arma: agrupar por algo y contar cosas.
 *
 * No se escribe nada de SQL ni de fórmulas: se elige de dos listas que el
 * servidor sabe calcular. Es lo que hace que «reportes configurables sin
 * programación» no termine siendo una puerta para leer cualquier tabla.
 *
 * Los filtros de arriba de la página se aplican también aquí, y viajan con el
 * reporte al guardarlo.
 */
export const ReportesVista = ({
  filtros,
}: {
  filtros: FiltrosDeTablero;
  catalogos: CatalogosCrm | null;
}) => {
  const { datos: catalogo } = useCarga(catalogoDeReportes, []);
  const guardados = useCarga(reportesGuardados, []);

  const [dimension, setDimension] = useState("producto");
  const [metricas, setMetricas] = useState<string[]>(["vendido", "ganadas", "ticket_promedio"]);
  const [desde, setDesde] = useState(dia(new Date(hoy.getFullYear(), 0, 1)));
  const [hasta, setHasta] = useState(dia(new Date(hoy.getFullYear() + 1, 0, 1)));
  const [resultado, setResultado] = useState<ResultadoDeReporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [editando, setEditando] = useState<string | undefined>();
  const [nombre, setNombre] = useState("");
  const [frecuencia, setFrecuencia] = useState("");
  const [destinatarios, setDestinatarios] = useState("");

  const definicion = (): DefinicionDeReporte => ({
    dimension,
    metricas,
    desde,
    hasta,
    ...filtros,
  });

  const ejecutar = async () => {
    try {
      setResultado(await ejecutarReporte(definicion()));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Se vuelve a ejecutar solo cuando cambian los filtros de la página, para
  // que lo que se ve nunca sea de otro filtro que el que está puesto.
  useEffect(() => {
    if (resultado) void ejecutar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filtros)]);

  const abrir = (r: ReporteGuardado) => {
    setEditando(r.id);
    setNombre(r.nombre);
    setDimension(r.definicion.dimension);
    setMetricas(r.definicion.metricas);
    setFrecuencia(r.frecuencia ?? "");
    setDestinatarios(r.destinatarios.join(", "));
    setResultado(null);
  };

  const guardar = async () => {
    try {
      const { desde: _d, hasta: _h, ...sinPeriodo } = definicion();
      await guardarReporte({
        id: editando,
        nombre,
        // Un reporte guardado no lleva periodo fijo: el programado cuenta el
        // periodo anterior a cada envío, y al abrirlo se usa el de pantalla.
        definicion: sinPeriodo,
        frecuencia: frecuencia || null,
        destinatarios: destinatarios
          .split(/[,;\s]+/)
          .map((d) => d.trim())
          .filter(Boolean),
      });
      setAviso(`Guardado «${nombre}».`);
      setError(null);
      guardados.recargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const formatoDe = (codigo: string) =>
    resultado?.columnas.find((c) => c.codigo === codigo)?.formato ?? "texto";

  return (
    <div className="flex flex-col gap-4">
      <div className="border rounded-lg p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Agrupar por
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
            >
              {catalogo?.dimensiones.map((d) => (
                <option key={d.codigo} value={d.codigo}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Desde
            <Input type="date" className="h-8" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Hasta (sin incluir)
            <Input type="date" className="h-8" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <Button size="sm" onClick={ejecutar} disabled={metricas.length === 0}>
            Ver
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={metricas.length === 0}
            onClick={() =>
              descargarExcel(definicion(), nombre || "Reporte del CRM").catch((e) => setError(e.message))
            }
          >
            Excel
          </Button>
        </div>

        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="text-xs text-muted-foreground mb-1">Qué contar</legend>
          {catalogo?.metricas.map((m) => (
            <label key={m.codigo} className="text-sm flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={metricas.includes(m.codigo)}
                onChange={(e) =>
                  setMetricas((previas) =>
                    e.target.checked ? [...previas, m.codigo] : previas.filter((x) => x !== m.codigo),
                  )
                }
              />
              {m.nombre}
            </label>
          ))}
        </fieldset>
        <p className="text-[11px] text-muted-foreground">
          Cada cifra se fecha por lo suyo: lo vendido por cuándo se ganó, lo abierto
          por cuándo se abrió, lo cobrado por cuándo se cobró. El pipeline es una foto
          de hoy y no lo recorta el periodo; agrupado por mes, se reparte por mes de
          cierre previsto.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}

      {resultado && (
        <div className="border rounded-lg p-3 overflow-x-auto">
          {resultado.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada en ese periodo.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left">
                  {resultado.columnas.map((c, i) => (
                    <th key={c.codigo} className={`font-normal pb-1 ${i ? "text-right" : ""}`}>
                      {c.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultado.filas.map((f) => (
                  <tr key={String(f.etiqueta)} className="border-t">
                    {resultado.columnas.map((c, i) => (
                      <td key={c.codigo} className={`py-1 ${i ? "text-right tabular-nums" : "pr-2"}`}>
                        {conFormato(f[c.codigo], formatoDe(c.codigo))}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 font-medium">
                  {resultado.columnas.map((c, i) => (
                    <td key={c.codigo} className={`py-1 ${i ? "text-right tabular-nums" : ""}`}>
                      {i === 0 ? "Total" : conFormato(resultado.totales[c.codigo], formatoDe(c.codigo))}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          {resultado.recortado && (
            <p className="text-xs text-muted-foreground mt-2">
              Se enseñan las primeras 500 filas; el Excel tiene las mismas.
            </p>
          )}
        </div>
      )}

      <div className="border rounded-lg p-3 flex flex-col gap-3 print:hidden">
        <p className="text-xs text-muted-foreground">
          Guardar este reporte {editando ? `(editando «${nombre}»)` : ""}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Nombre
            <Input className="h-8 w-56" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Enviar por correo
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={frecuencia}
              onChange={(e) => setFrecuencia(e.target.value)}
            >
              <option value="">No, sólo guardarlo</option>
              <option value="semanal">Cada lunes, la semana anterior</option>
              <option value="mensual">Cada día 1, el mes anterior</option>
            </select>
          </label>
          {frecuencia && (
            <label className="text-xs text-muted-foreground flex flex-col gap-1 flex-1 min-w-56">
              A quién (separados por comas)
              <Input
                className="h-8"
                value={destinatarios}
                placeholder="gerencia@empresa.com"
                onChange={(e) => setDestinatarios(e.target.value)}
              />
            </label>
          )}
          <Button size="sm" variant="outline" onClick={guardar} disabled={!nombre.trim()}>
            {editando ? "Guardar cambios" : "Guardar"}
          </Button>
          {editando && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditando(undefined);
                setNombre("");
                setFrecuencia("");
                setDestinatarios("");
              }}
            >
              Nuevo
            </Button>
          )}
        </div>

        {(guardados.datos ?? []).length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Guardados</th>
                <th className="font-normal pb-1">Envío</th>
                <th className="font-normal pb-1" />
              </tr>
            </thead>
            <tbody>
              {guardados.datos!.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1 pr-2">
                    <button type="button" className="underline text-left" onClick={() => abrir(r)}>
                      {r.nombre}
                    </button>
                  </td>
                  <td className="py-1 pr-2 text-xs text-muted-foreground">
                    {r.frecuencia
                      ? `${r.frecuencia} a ${r.destinatarios.join(", ")}` +
                        (r.ultimo_envio ? ` · último ${r.ultimo_envio.slice(0, 10)}` : "")
                      : "sin programar"}
                    {r.ultimo_error && <span className="text-destructive"> · falló: {r.ultimo_error}</span>}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {r.destinatarios.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const r2 = await enviarReporteAhora(r.id);
                            setAviso(`Enviado: ${r2.filas} fila(s), del ${r2.periodo.desde} al ${r2.periodo.hasta}.`);
                            guardados.recargar();
                          } catch (e: any) {
                            setError(e.message);
                          }
                        }}
                      >
                        Mandar ahora
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!window.confirm(`¿Borrar el reporte «${r.nombre}»?`)) return;
                        await borrarReporte(r.id).catch((e) => setError(e.message));
                        guardados.recargar();
                      }}
                    >
                      Borrar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
