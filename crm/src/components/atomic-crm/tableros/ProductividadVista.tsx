import { useState } from "react";
import {
  dinero,
  equipos,
  ponerSupervisor,
  productividad,
  type FiltrosDeTablero,
  type MiembroDeEquipo,
} from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

/**
 * Qué hizo cada comercial en el periodo, de la llamada a la venta.
 *
 * Se lee de izquierda a derecha como un embudo personal: actividad,
 * oportunidades, propuestas, ventas. Quien llama mucho y no propone nada
 * tiene otro problema que quien propone mucho y no cierra.
 */
export const ProductividadVista = ({
  periodo,
  filtros,
  alCambiarEquipos,
}: {
  periodo: { desde: string; hasta: string; nombre: string };
  filtros: FiltrosDeTablero;
  alCambiarEquipos: (m: MiembroDeEquipo[]) => void;
}) => {
  const { datos, error, cargando } = useCarga(
    () => productividad(periodo.desde, periodo.hasta, filtros),
    [periodo.desde, periodo.hasta, JSON.stringify(filtros)],
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {cargando && !datos ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos ? (
        <div className="border rounded-lg p-3 overflow-x-auto">
          <p className="text-xs text-muted-foreground mb-2">{periodo.nombre}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Comercial</th>
                <th className="font-normal pb-1 text-right" title="Llamadas, correos, WhatsApp, visitas… anotados a mano">
                  Contactos
                </th>
                <th className="font-normal pb-1 text-right">Llamadas</th>
                <th className="font-normal pb-1 text-right" title="Agendadas · a las que se asistió">
                  Reuniones
                </th>
                <th className="font-normal pb-1 text-right">Tareas hechas</th>
                <th className="font-normal pb-1 text-right">Vencidas hoy</th>
                <th className="font-normal pb-1 text-right">Oport. abiertas</th>
                <th className="font-normal pb-1 text-right">Propuestas</th>
                <th className="font-normal pb-1 text-right">Ganadas</th>
                <th className="font-normal pb-1 text-right">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {datos.map((f) => (
                <tr key={f.comercial} className="border-t">
                  <td className="py-1.5 pr-2">{f.nombre}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.interacciones}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.llamadas}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {f.reuniones}
                    {f.reuniones ? <span className="text-muted-foreground"> · {f.reuniones_realizadas}</span> : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{f.tareas_hechas}</td>
                  <td className={`py-1.5 text-right tabular-nums ${f.tareas_vencidas ? "font-medium" : ""}`}>
                    {f.tareas_vencidas}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{f.abiertas}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.propuestas}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.ganadas}</td>
                  <td className="py-1.5 text-right tabular-nums">{dinero(f.vendido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-2">
            La actividad se atribuye a quien la firmó; las ventas, al dueño de la
            oportunidad. Las tareas vencidas son las de hoy, no las del periodo.
          </p>
        </div>
      ) : null}

      <Equipos alCambiar={alCambiarEquipos} />
    </div>
  );
};

/**
 * Quién responde a quién.
 *
 * Es la jerarquía que usan el filtro de equipo y la firma de descuentos. Se
 * edita aquí porque es donde se ve para qué sirve.
 */
const Equipos = ({ alCambiar }: { alCambiar: (m: MiembroDeEquipo[]) => void }) => {
  const [error, setError] = useState<string | null>(null);
  const { datos, recargar } = useCarga(async () => {
    const m = await equipos();
    alCambiar(m);
    return m;
  }, []);

  if (!datos) return null;

  return (
    <details className="border rounded-lg p-3 print:hidden">
      <summary className="text-sm cursor-pointer">Equipos: quién responde a quién</summary>
      <p className="text-xs text-muted-foreground mt-2">
        Quien no responde a nadie está arriba del todo: es quien firma los
        descuentos de nivel dirección de su cadena.
      </p>
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      <table className="text-sm mt-2">
        <tbody>
          {datos.map((m) => (
            <tr key={m.usuario}>
              <td className="py-1 pr-3">{m.nombre}</td>
              <td className="py-1">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  aria-label={`Supervisor de ${m.nombre}`}
                  value={m.supervisor ?? ""}
                  onChange={async (e) => {
                    try {
                      await ponerSupervisor(m.usuario, e.target.value || null);
                      setError(null);
                      recargar();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                >
                  <option value="">No responde a nadie</option>
                  {datos
                    .filter((o) => o.usuario !== m.usuario)
                    .map((o) => (
                      <option key={o.usuario} value={o.usuario}>
                        Responde a {o.nombre}
                      </option>
                    ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
};
