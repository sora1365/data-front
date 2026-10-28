import { useEffect, useState } from "react";
import { useDataProvider } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  duracion,
  NOMBRE_DE_SLA,
  type EstadoSla,
  type Plazo,
} from "../providers/friday/tickets";

export const SELECT = "border rounded px-2 py-1 text-sm bg-background";

/**
 * El SLA como etiqueta: rojo si se pasó, ámbar si está por vencer.
 *
 * Con lo que queda dicho en tiempo y no en fecha: «vence en 40 min» se
 * entiende de un vistazo; «vence el 28/10 16:58» obliga a mirar el reloj.
 */
export const EtiquetaSla = ({ estado, plazo }: { estado: EstadoSla; plazo?: Plazo }) => {
  const clase =
    estado === "incumplido"
      ? "bg-red-600 text-white border-transparent"
      : estado === "por_vencer"
        ? "bg-amber-500 text-white border-transparent"
        : estado === "cumplido"
          ? "border-emerald-600 text-emerald-700"
          : "";
  const cuanto =
    plazo?.restantesMin == null
      ? ""
      : plazo.restantesMin < 0
        ? ` · hace ${duracion(plazo.restantesMin)}`
        : ` · ${duracion(plazo.restantesMin)}`;
  return (
    <Badge variant="outline" className={clase}>
      {NOMBRE_DE_SLA[estado]}
      {cuanto}
    </Badge>
  );
};

export const EtiquetaPrioridad = ({ prioridad }: { prioridad: string }) => (
  <Badge
    variant="outline"
    className={
      prioridad === "urgente"
        ? "border-red-600 text-red-700"
        : prioridad === "alta"
          ? "border-amber-500 text-amber-700"
          : "text-muted-foreground"
    }
  >
    {prioridad}
  </Badge>
);

export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Buscar una empresa del CRM para enlazarla.
 *
 * Usa el mismo recurso que la lista de empresas: si mañana esa búsqueda
 * aprende a encontrar por RUC parcial, aquí se nota sin tocar nada.
 */
export const BuscarEmpresa = ({
  onElegir,
  placeholder = "Buscar empresa por nombre o RUC…",
}: {
  onElegir: (empresa: { id: string; name: string }) => void;
  placeholder?: string;
}) => {
  const dataProvider = useDataProvider();
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<{ id: string; name: string; tax_identifier?: string }[]>([]);

  useEffect(() => {
    if (texto.trim().length < 2) {
      setOpciones([]);
      return;
    }
    const espera = setTimeout(async () => {
      try {
        const { data } = await dataProvider.getList("companies", {
          filter: { q: texto.trim() },
          pagination: { page: 1, perPage: 8 },
          sort: { field: "name", order: "ASC" },
        });
        setOpciones(data as any);
      } catch {
        setOpciones([]);
      }
    }, 250);
    return () => clearTimeout(espera);
  }, [texto, dataProvider]);

  return (
    <div className="relative">
      <Input value={texto} placeholder={placeholder} onChange={(e) => setTexto(e.target.value)} />
      {opciones.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md max-h-56 overflow-y-auto">
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                onClick={() => {
                  onElegir(o);
                  setTexto("");
                  setOpciones([]);
                }}
              >
                {o.name}
                {o.tax_identifier && (
                  <span className="text-xs text-muted-foreground"> · {o.tax_identifier}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
