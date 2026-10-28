import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  analizar,
  aplicarAnalisis,
  iaDisponible,
  ultimoAnalisis,
  type Analisis,
  type Aplicacion,
  type EntidadIa,
  type SiguientePaso,
} from "../providers/friday/ia";

const NOMBRE_DE_ACCION: Record<Aplicacion, string> = {
  tarea: "creó la tarea",
  temperatura: "aceptó la temperatura",
  borrador: "usó el borrador",
  descartado: "lo descartó",
};

/**
 * El asistente de IA de una ficha: oportunidad, lead o ticket.
 *
 * **Propone; no toca nada.** Lo que dice se enseña aquí y sólo se convierte en
 * una tarea, una temperatura o una respuesta cuando alguien pulsa el botón, y
 * queda firmado por esa persona. Nada se analiza solo al abrir la ficha:
 * cada análisis cuesta, y se pide cuando hace falta.
 *
 * Sin IA en el servidor no enseña nada: un botón que siempre falla enseña a
 * no pulsarlo.
 */
export const PanelIa = ({
  entidad,
  id,
  onAplicado,
  onBorrador,
}: {
  entidad: EntidadIa;
  id: string | number;
  onAplicado?: (accion: Aplicacion) => void;
  /** Para el ticket: lleva el borrador al cuadro de respuesta. */
  onBorrador?: (texto: string) => void;
}) => {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    iaDisponible().then((e) => setDisponible(e.disponible));
  }, []);

  useEffect(() => {
    setAnalisis(null);
    setError(null);
    setAviso(null);
    if (disponible) ultimoAnalisis(entidad, id).then(setAnalisis).catch(() => {});
  }, [entidad, id, disponible]);

  const pedir = useCallback(
    async (forzar: boolean) => {
      setCargando(true);
      setError(null);
      setAviso(null);
      try {
        const a = await analizar(entidad, id, forzar);
        setAnalisis(a);
        if (a.reutilizado) setAviso("Nada cambió desde el último análisis de hoy; es el mismo.");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setCargando(false);
      }
    },
    [entidad, id],
  );

  const aplicar = async (accion: Aplicacion, borrador?: string) => {
    if (!analisis) return;
    try {
      const r = await aplicarAnalisis(analisis.id, accion);
      setAnalisis({ ...analisis, aplicado: accion, aplicado_en: new Date().toISOString() });
      if (accion === "tarea") setAviso(`Tarea creada para el ${r.vence}. Está en la agenda.`);
      if (accion === "temperatura") setAviso(`El lead queda como «${r.temperatura}».`);
      if (borrador) onBorrador?.(borrador);
      onAplicado?.(accion);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!disponible) return null;

  const r = analisis?.resultado ?? {};
  const usado = !!analisis?.aplicado;

  return (
    <section className="border rounded-lg p-3 flex flex-col gap-3 bg-violet-50/40 dark:bg-violet-950/10 border-violet-200 dark:border-violet-900">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="size-4 text-violet-600" /> Asistente
        </h3>
        <Button size="sm" variant="outline" disabled={cargando} onClick={() => pedir(false)}>
          {cargando ? "Analizando…" : analisis ? "Volver a analizar" : TITULO[entidad]}
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
      {analisis?.reutilizado && !cargando && (
        // Repetir con los mismos datos cuesta lo mismo que la primera vez:
        // se ofrece, pero no es lo que hace el botón de arriba.
        <Button size="sm" variant="ghost" className="self-start -mt-2" onClick={() => pedir(true)}>
          Pedir otra opinión de todos modos
        </Button>
      )}
      {cargando && !analisis && (
        <p className="text-sm text-muted-foreground">Leyendo el historial… tarda unos segundos.</p>
      )}

      {analisis && (
        <>
          {entidad === "oportunidad" && <Oportunidad r={r} />}
          {entidad === "lead" && <Lead r={r} />}
          {entidad === "ticket" && <Ticket r={r} />}

          {r.siguiente_paso && typeof r.siguiente_paso === "object" && (
            <Paso paso={r.siguiente_paso} />
          )}

          <div className="flex flex-wrap gap-2">
            {entidad !== "ticket" && r.siguiente_paso && (
              <Button size="sm" disabled={usado} onClick={() => aplicar("tarea")}>
                Crear la tarea
              </Button>
            )}
            {entidad === "lead" && r.temperatura && (
              <Button size="sm" variant="outline" disabled={usado} onClick={() => aplicar("temperatura")}>
                Marcar como {r.temperatura}
              </Button>
            )}
            {entidad === "ticket" && r.borrador_respuesta && (
              <Button
                size="sm"
                disabled={usado}
                onClick={() => aplicar("borrador", r.borrador_respuesta)}
              >
                Usar el borrador
              </Button>
            )}
            {!usado && (
              <Button size="sm" variant="ghost" onClick={() => aplicar("descartado")}>
                No sirve
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {new Date(analisis.creado_en).toLocaleString("es-EC", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · pedido por {analisis.pedido_por}
            {analisis.aplicado &&
              ` · ${analisis.aplicado_por ?? ""} ${NOMBRE_DE_ACCION[analisis.aplicado]}`}
            . Lo propone la IA con lo registrado en el CRM: revísalo antes de usarlo.
          </p>
        </>
      )}
    </section>
  );
};

const TITULO: Record<EntidadIa, string> = {
  oportunidad: "Resumir y sugerir",
  lead: "Calificar",
  ticket: "Resumir y redactar",
};

const Lista = ({ titulo, items }: { titulo: string; items?: string[] }) =>
  items?.length ? (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <ul className="list-disc pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  ) : null;

const Riesgo = ({ nivel, motivo }: { nivel: string; motivo?: string }) => (
  <p className="text-sm">
    <Badge
      variant="outline"
      className={
        nivel === "alto"
          ? "border-red-600 text-red-700"
          : nivel === "medio"
            ? "border-amber-500 text-amber-700"
            : "border-emerald-600 text-emerald-700"
      }
    >
      riesgo {nivel}
    </Badge>{" "}
    {motivo}
  </p>
);

const Oportunidad = ({ r }: { r: Record<string, any> }) => (
  <div className="flex flex-col gap-2 text-sm">
    <p className="whitespace-pre-line">{r.resumen}</p>
    {r.que_quiere_el_cliente && (
      <p>
        <span className="text-muted-foreground">Qué quiere: </span>
        {r.que_quiere_el_cliente}
      </p>
    )}
    {r.riesgo && <Riesgo nivel={r.riesgo} motivo={r.motivo_riesgo} />}
    {r.objeciones?.length > 0 && (
      <div>
        <p className="text-xs text-muted-foreground">Objeciones</p>
        <ul className="flex flex-col gap-1">
          {r.objeciones.map((o: any, i: number) => (
            <li key={i}>
              <strong>«{o.objecion}»</strong> — {o.respuesta_sugerida}
            </li>
          ))}
        </ul>
      </div>
    )}
    <Lista titulo="Compromisos pendientes" items={r.compromisos_pendientes} />
  </div>
);

const Lead = ({ r }: { r: Record<string, any> }) => (
  <div className="flex flex-col gap-2 text-sm">
    <p className="flex flex-wrap items-center gap-2">
      <Badge
        className={
          r.temperatura === "caliente"
            ? "bg-red-600 text-white"
            : r.temperatura === "tibio"
              ? "bg-amber-500 text-white"
              : "bg-sky-600 text-white"
        }
      >
        {r.temperatura}
      </Badge>
      <span>{r.probabilidad} % de probabilidad de compra</span>
      {r.producto_sugerido && (
        <span className="text-muted-foreground">· le encaja {r.producto_sugerido}</span>
      )}
    </p>
    {r.intencion && <p>{r.intencion}</p>}
    <Lista titulo="Por qué" items={r.razones} />
    <Lista titulo="Qué falta saber" items={r.faltan} />
    <Lista titulo="Para la primera llamada" items={r.preguntas} />
  </div>
);

const Ticket = ({ r }: { r: Record<string, any> }) => (
  <div className="flex flex-col gap-2 text-sm">
    <p className="whitespace-pre-line">{r.resumen}</p>
    {r.que_pide && (
      <p>
        <span className="text-muted-foreground">Qué pide: </span>
        {r.que_pide}
      </p>
    )}
    <p className="flex flex-wrap gap-2">
      {r.animo && (
        <Badge variant="outline" className={r.animo === "tranquilo" ? "" : "border-red-600 text-red-700"}>
          {String(r.animo).replace("_", " ")}
        </Badge>
      )}
      {r.riesgo_de_perderlo && <Riesgo nivel={r.riesgo_de_perderlo} motivo="de perder al cliente" />}
    </p>
    {r.siguiente_paso && typeof r.siguiente_paso === "string" && (
      <p>
        <span className="text-muted-foreground">Siguiente paso: </span>
        {r.siguiente_paso}
      </p>
    )}
    {r.borrador_respuesta && (
      <div className="rounded border bg-background px-3 py-2">
        <p className="text-xs text-muted-foreground mb-1">Borrador de respuesta</p>
        <p className="whitespace-pre-wrap">{r.borrador_respuesta}</p>
      </div>
    )}
  </div>
);

const Paso = ({ paso }: { paso: SiguientePaso }) => (
  <div className="rounded border bg-background px-3 py-2 text-sm flex flex-col gap-1">
    <p className="text-xs text-muted-foreground">
      Siguiente paso · {paso.canal} ·{" "}
      {paso.en_dias === 0 ? "hoy" : paso.en_dias === 1 ? "mañana" : `en ${paso.en_dias} días`}
    </p>
    <p className="font-medium">{paso.accion}</p>
    {paso.por_que && <p className="text-muted-foreground">{paso.por_que}</p>}
    {paso.mensaje_sugerido && (
      <p className="whitespace-pre-wrap border-l-2 pl-2 mt-1">{paso.mensaje_sugerido}</p>
    )}
  </div>
);
