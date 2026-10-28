import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  actualizarTicket,
  anotarEnTicket,
  cambiarEstadoTicket,
  enviarCsatTicket,
  NOMBRE_DE_ESTADO,
  NOMBRE_DE_TIPO,
  obtenerTicket,
  SIGUIENTES,
  type CatalogosTickets,
  type EstadoTicket,
  type FichaTicket as Ficha,
} from "../providers/friday/tickets";
import { BuscarEmpresa, EtiquetaPrioridad, EtiquetaSla, fechaCorta, SELECT } from "./comunes";

type Modo = "respuesta" | "nota" | "cliente";

const MODOS: { modo: Modo; nombre: string; ayuda: string }[] = [
  {
    modo: "respuesta",
    nombre: "Respuesta al cliente",
    ayuda: "Lo que se le dijo o se le va a decir. La primera marca el plazo de respuesta.",
  },
  { modo: "nota", nombre: "Nota interna", ayuda: "Sólo para el equipo. No cuenta como respuesta." },
  {
    modo: "cliente",
    nombre: "Lo que dijo el cliente",
    ayuda: "Si se le estaba esperando, el reloj vuelve a correr.",
  },
];

/**
 * La ficha de un ticket: qué pidió, cómo va contra lo prometido y qué se ha
 * hecho, en orden.
 *
 * Las respuestas todavía no salen solas por WhatsApp ni por correo: se
 * contestan por el canal de siempre y se anotan aquí. La tabla es la misma en
 * la que caerán cuando haya integración, igual que el historial de las
 * oportunidades.
 */
export const FichaTicket = ({
  id,
  catalogos,
  onCambio,
}: {
  id: string;
  catalogos: CatalogosTickets | null;
  onCambio: () => void;
}) => {
  const [t, setT] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("respuesta");
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setT(await obtenerTicket(id));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    setT(null);
    setAviso(null);
    setTexto("");
    cargar();
  }, [cargar]);

  const hacer = async (accion: () => Promise<Ficha | unknown>, mensaje?: string) => {
    setGuardando(true);
    try {
      const r = await accion();
      if (r && typeof r === "object" && "eventos" in (r as any)) setT(r as Ficha);
      else await cargar();
      setError(null);
      setAviso(mensaje ?? null);
      onCambio();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  if (!t) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Cargando…</p>
    );
  }

  const cerrado = t.estado === "cerrado";
  const terminado = t.estado === "resuelto" || cerrado;
  const ayuda = MODOS.find((m) => m.modo === modo)!.ayuda;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2 border-b pb-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold text-lg leading-tight">
            <span className="text-muted-foreground">#{t.id}</span> {t.asunto}
          </h2>
          <EtiquetaSla estado={t.sla_estado} />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center text-xs">
          <Badge variant="secondary">{NOMBRE_DE_ESTADO[t.estado]}</Badge>
          <Badge variant="outline">{NOMBRE_DE_TIPO[t.tipo] ?? t.tipo}</Badge>
          <EtiquetaPrioridad prioridad={t.prioridad} />
          <span className="text-muted-foreground">
            por {t.canal} · {fechaCorta(t.creado_en)}
            {t.reabierto > 0 && ` · reabierto ${t.reabierto} vez/veces`}
          </span>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {aviso && (
        <Alert>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {/* ------------------------------------------------------------ cliente */}
      <section className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Cliente</p>
          {t.empresa ? (
            <p>
              {t.empresa}
              {t.ruc && <span className="text-muted-foreground"> · {t.ruc}</span>}
            </p>
          ) : (
            <p className="text-amber-700">Sin enlazar a una empresa</p>
          )}
          {(t.contacto || t.solicitante_nombre) && (
            <p className="text-muted-foreground">{t.contacto ?? t.solicitante_nombre}</p>
          )}
          {(t.solicitante_correo || t.solicitante_telefono) && (
            <p className="text-muted-foreground text-xs">
              {[t.solicitante_correo, t.solicitante_telefono].filter(Boolean).join(" · ")}
            </p>
          )}
          {!cerrado && (
            <BuscarEmpresa
              placeholder={t.empresa ? "Cambiar de empresa…" : "Enlazar a una empresa…"}
              onElegir={(e) =>
                hacer(() => actualizarTicket(t.id, { empresa_id: Number(e.id) }), `Enlazado a ${e.name}.`)
              }
            />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Plazos</p>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Respuesta</span>
            <EtiquetaSla estado={t.sla.respuesta.estado} plazo={t.sla.respuesta} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Resolución</span>
            <EtiquetaSla estado={t.sla.resolucion.estado} plazo={t.sla.resolucion} />
          </div>
          {t.estado === "esperando_cliente" && (
            <p className="text-xs text-muted-foreground">
              El reloj de la resolución está parado mientras se espera al cliente.
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ gestionarlo */}
      {!cerrado && (
        <section className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Responsable</span>
            <select
              className={SELECT}
              value={t.responsable ?? ""}
              disabled={guardando}
              onChange={(e) => hacer(() => actualizarTicket(t.id, { responsable: e.target.value || null }))}
            >
              <option value="">Sin responsable</option>
              {catalogos?.comerciales.map((c) => (
                <option key={c.usuario} value={c.usuario}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Prioridad</span>
            <select
              className={SELECT}
              value={t.prioridad}
              disabled={guardando}
              onChange={(e) => hacer(() => actualizarTicket(t.id, { prioridad: e.target.value }))}
            >
              {catalogos?.sla.map((s) => (
                <option key={s.prioridad} value={s.prioridad}>
                  {s.prioridad} · responder en {s.horas_respuesta} h, resolver en {s.horas_resolucion} h
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Tipo</span>
            <select
              className={SELECT}
              value={t.tipo}
              disabled={guardando}
              onChange={(e) => hacer(() => actualizarTicket(t.id, { tipo: e.target.value }))}
            >
              {catalogos?.tipos.map((x) => (
                <option key={x} value={x}>
                  {NOMBRE_DE_TIPO[x] ?? x}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 ml-auto">
            {SIGUIENTES[t.estado].map((a: EstadoTicket) => (
              <Button
                key={a}
                size="sm"
                variant={a === "resuelto" ? "default" : "outline"}
                disabled={guardando}
                onClick={() => hacer(() => cambiarEstadoTicket(t.id, a))}
              >
                {a === "en_curso" && t.estado === "resuelto" ? "Reabrir" : NOMBRE_DE_ESTADO[a]}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* --------------------------------------------------- satisfacción */}
      {terminado && (
        <section className="border rounded-lg p-3 text-sm flex items-center justify-between gap-3">
          {t.csat_puntaje !== null ? (
            <div>
              <p>
                Satisfacción:{" "}
                <strong className={t.csat_puntaje <= 2 ? "text-red-700" : ""}>{t.csat_puntaje}/5</strong>
              </p>
              {t.csat_comentario && (
                <p className="text-muted-foreground whitespace-pre-line">«{t.csat_comentario}»</p>
              )}
              {t.csat_puntaje <= 2 && (
                <p className="text-xs text-red-700 mt-1">
                  El cliente no quedó contento. Vale la pena llamarle antes de que se convierta en una baja.
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">
                {t.csat_enviada_en
                  ? `Encuesta enviada el ${fechaCorta(t.csat_enviada_en)}, sin respuesta todavía.`
                  : "¿Qué tal le atendimos? Pregúntaselo con una encuesta de una pregunta."}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={guardando}
                onClick={() =>
                  hacer(async () => {
                    const r = await enviarCsatTicket(t.id);
                    if (r.simulado) setAviso("Encuesta registrada. El correo está en modo simulado: no salió.");
                  }, "Encuesta enviada.")
                }
              >
                {t.csat_enviada_en ? "Reenviar encuesta" : "Enviar encuesta"}
              </Button>
            </>
          )}
        </section>
      )}

      {/* --------------------------------------------------------- historial */}
      <section className="flex flex-col gap-2">
        {t.descripcion && (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            <p className="text-[11px] text-muted-foreground mb-1">Lo que pidió</p>
            <p className="whitespace-pre-wrap break-words">{t.descripcion}</p>
          </div>
        )}
        {t.eventos.map((e) => (
          <Evento key={e.id} evento={e} />
        ))}
      </section>

      {!cerrado && (
        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (await hacer(() => anotarEnTicket(t.id, modo, texto))) setTexto("");
          }}
        >
          <div className="flex flex-wrap gap-1">
            {MODOS.map((m) => (
              <Button
                key={m.modo}
                type="button"
                size="sm"
                variant={modo === m.modo ? "secondary" : "ghost"}
                onClick={() => setModo(m.modo)}
              >
                {m.nombre}
              </Button>
            ))}
          </div>
          <Textarea
            value={texto}
            rows={3}
            className={modo === "nota" ? "bg-amber-50 dark:bg-amber-950/30" : ""}
            placeholder={ayuda}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={guardando || !texto.trim()}>
              Anotar
            </Button>
          </div>
        </form>
      )}

      {t.anteriores.length > 0 && (
        <section className="text-sm">
          <p className="text-xs text-muted-foreground mb-1">
            Otros tickets de este cliente ({t.anteriores.length})
          </p>
          <ul className="flex flex-col gap-0.5">
            {t.anteriores.map((a) => (
              <li key={a.id} className="text-muted-foreground">
                #{a.id} · {NOMBRE_DE_TIPO[a.tipo] ?? a.tipo} · {a.asunto} ·{" "}
                {NOMBRE_DE_ESTADO[a.estado as EstadoTicket] ?? a.estado}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

/**
 * Un renglón del historial. Lo interno —cambios de estado, notas— va en
 * pequeño y gris; lo que se habló con el cliente, como en un chat, porque es
 * lo que se lee para saber dónde está la conversación.
 */
const Evento = ({ evento: e }: { evento: Ficha["eventos"][number] }) => {
  if (e.tipo === "respuesta" || e.tipo === "cliente" || (e.tipo === "csat" && !e.interna)) {
    const nuestro = e.tipo === "respuesta";
    return (
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          nuestro ? "self-end bg-primary text-primary-foreground" : "self-start border"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{e.texto}</p>
        <p className="text-[10px] opacity-70 mt-1">
          {nuestro ? e.autor : "cliente"} · {fechaCorta(e.en)}
        </p>
      </div>
    );
  }
  if (e.tipo === "nota") {
    return (
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm border border-amber-200 dark:border-amber-900">
        <p className="whitespace-pre-wrap break-words">{e.texto}</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          nota interna · {e.autor} · {fechaCorta(e.en)}
        </p>
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground text-center">
      {e.texto} · {e.autor} · {fechaCorta(e.en)}
    </p>
  );
};
