import { AlertTriangle, CircleAlert } from "lucide-react";
import { alertasDelTablero, dinero, type FiltrosDeTablero } from "../providers/friday/tableros";
import { useCarga } from "./useCarga";

/**
 * Lo que hay que mirar hoy, con qué hacer.
 *
 * Arriba del resumen y no en una pestaña: una alerta que hay que ir a buscar
 * no avisa. Sin alertas se enseña el ritmo del mes en una línea, para que el
 * hueco no parezca un fallo de carga.
 */
export const AlertasDelTablero = ({ filtros }: { filtros: FiltrosDeTablero }) => {
  const { datos, error } = useCarga(() => alertasDelTablero(filtros), [JSON.stringify(filtros)]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!datos) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Este mes: {dinero(datos.vendidoMes)} vendido
        {datos.meta ? ` de una meta de ${dinero(datos.meta)}` : " (sin meta puesta)"}; al ritmo
        del pipeline se espera cerrar en {dinero(datos.esperado)}.
      </p>
      {datos.alertas.map((a) => {
        const alta = a.nivel === "alta";
        const Icono = alta ? CircleAlert : AlertTriangle;
        return (
          <div
            key={a.codigo}
            className={`rounded-lg border p-3 flex gap-3 ${alta ? "border-destructive/60" : ""}`}
          >
            <Icono
              className={`size-5 shrink-0 mt-0.5 ${alta ? "text-destructive" : "text-muted-foreground"}`}
              aria-hidden
            />
            <div className="text-sm">
              <p className="font-medium">
                <span className="text-xs font-normal uppercase tracking-wide text-muted-foreground mr-2">
                  {alta ? "Urgente" : "Atención"}
                </span>
                {a.titulo}
              </p>
              <p className="text-muted-foreground">{a.detalle}</p>
              <p className="mt-1">→ {a.recomendacion}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
