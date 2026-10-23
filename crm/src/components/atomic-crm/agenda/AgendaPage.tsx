import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  comoDia,
  crearCalendario,
  crearEvento,
  listarCalendarios,
  listarEventos,
  listarTareas,
  lunesDe,
  marcarTarea,
  sumarDias,
  type Calendario,
  type DiaDeTareas,
  type Evento,
  type TareaDeAgenda,
} from "../providers/friday/agenda";

/** La franja que se pinta. Fuera de ella casi nunca hay nada que mirar. */
const HORA_INICIO = 7;
const HORA_FIN = 21;
const ALTO_HORA = 48;

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * La agenda, en vista vertical semanal.
 *
 * Calendarios a la izquierda, con casillas para encender y apagar cada uno:
 * es el modelo de TimeTree, donde lo que se comparte y se filtra es el
 * calendario, no la persona. Apagar uno lo esconde sin borrarlo, que es lo que
 * permite mirar sólo lo comercial un lunes por la mañana.
 *
 * Las citas que se pisan se reparten en columnas para que ninguna tape a otra;
 * la alternativa —apilarlas— esconde justo las que hay que resolver.
 */
export const AgendaPage = () => {
  const [calendarios, setCalendarios] = useState<Calendario[]>([]);
  const [encendidos, setEncendidos] = useState<Set<string>>(new Set());
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tareas, setTareas] = useState<DiaDeTareas[]>([]);
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  // La tarea a la que se le está reservando hora, si se pulsó una.
  const [reservando, setReservando] = useState<TareaDeAgenda | null>(null);

  const finDeSemana = useMemo(() => sumarDias(semana, 7), [semana]);

  const cargarCalendarios = useCallback(async () => {
    try {
      const lista = await listarCalendarios();
      setCalendarios(lista);
      // Al abrir, todos encendidos: esconder algo que la persona no apagó la
      // llevaría a pensar que falta una cita.
      setEncendidos((previos) =>
        previos.size === 0 ? new Set(lista.map((c) => c.id)) : previos,
      );
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const cargarEventos = useCallback(async () => {
    try {
      setEventos(await listarEventos(semana, finDeSemana));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [semana, finDeSemana]);

  const cargarTareas = useCallback(async () => {
    try {
      setTareas(await listarTareas(semana));
    } catch (e: any) {
      setError(e.message);
    }
  }, [semana]);

  useEffect(() => {
    cargarCalendarios();
  }, [cargarCalendarios]);

  useEffect(() => {
    cargarEventos();
  }, [cargarEventos]);

  useEffect(() => {
    cargarTareas();
  }, [cargarTareas]);

  const visibles = useMemo(
    () => eventos.filter((e) => encendidos.has(String(e.calendario))),
    [eventos, encendidos],
  );

  const alternar = (id: string) => {
    setEncendidos((previos) => {
      const copia = new Set(previos);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSemana(sumarDias(semana, -7))}>
            ← Anterior
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSemana(lunesDe(new Date()))}>
            Esta semana
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSemana(sumarDias(semana, 7))}>
            Siguiente →
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-4 items-start">
        <aside className="w-56 shrink-0 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">Calendarios</p>
            {calendarios.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Todavía no tienes ninguno.
              </p>
            )}
            {calendarios.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={encendidos.has(c.id)}
                  onChange={() => alternar(c.id)}
                />
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ background: c.color }}
                />
                <span className="truncate">{c.nombre}</span>
                {!c.puede_editar && (
                  <Badge variant="outline" className="text-[10px] px-1">
                    ver
                  </Badge>
                )}
              </label>
            ))}
          </div>

          <NuevoCalendario
            alCrear={async (nombre, color) => {
              await crearCalendario({ nombre, color });
              await cargarCalendarios();
            }}
          />

          {calendarios.some((c) => c.puede_editar) && (
            <Button size="sm" onClick={() => setCreando(true)}>
              Nuevo evento
            </Button>
          )}
        </aside>

        <SemanaVertical
          semana={semana}
          eventos={visibles}
          tareas={tareas}
          alCambiarTarea={async (id, hecha) => {
            await marcarTarea(id, hecha);
            await cargarTareas();
          }}
          alReservarTarea={setReservando}
        />
      </div>

      {(creando || reservando) && (
        <NuevoEvento
          calendarios={calendarios.filter((c) => c.puede_editar)}
          semana={semana}
          tarea={reservando}
          alCerrar={() => {
            setCreando(false);
            setReservando(null);
          }}
          alCrear={async (datos) => {
            await crearEvento(datos);
            setCreando(false);
            setReservando(null);
            await cargarEventos();
            // También las tareas: la que acaba de recibir hora pasa a
            // enseñarlo, y si no se recarga parece que no se guardó.
            await cargarTareas();
          }}
        />
      )}
    </div>
  );
};

/**
 * La rejilla de la semana.
 *
 * Las horas a la izquierda y siete columnas de días. Cada cita se posiciona
 * por su hora de inicio y se estira según dure, que es lo que hace que de un
 * vistazo se vea dónde queda hueco.
 */
const SemanaVertical = ({
  semana,
  eventos,
  tareas,
  alCambiarTarea,
  alReservarTarea,
}: {
  semana: Date;
  eventos: Evento[];
  tareas: DiaDeTareas[];
  alCambiarTarea: (id: string, hecha: boolean) => Promise<void>;
  alReservarTarea: (tarea: TareaDeAgenda) => void;
}) => {
  const horas = Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(semana, i));
  const hoy = new Date();

  return (
    <div className="flex-1 overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b">
          <div />
          {dias.map((d, i) => (
            <div
              key={i}
              className={`text-center py-1 text-xs ${
                d.toDateString() === hoy.toDateString() ? "font-semibold text-primary" : ""
              }`}
            >
              <div>{DIAS[i]}</div>
              <div className="text-muted-foreground">{d.getDate()}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b bg-muted/30">
          <div className="text-[10px] text-muted-foreground text-right pr-1 py-1">
            tareas
          </div>
          {dias.map((dia, i) => (
            <TareasDelDia
              key={i}
              tareas={tareas.find((t) => t.dia === comoDia(dia))?.tareas ?? []}
              alCambiar={alCambiarTarea}
              alReservar={alReservarTarea}
            />
          ))}
        </div>

        <div className="grid grid-cols-[3rem_repeat(7,1fr)]">
          <div>
            {horas.map((h) => (
              <div
                key={h}
                className="text-[10px] text-muted-foreground text-right pr-1"
                style={{ height: ALTO_HORA }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {dias.map((dia, i) => (
            <ColumnaDia key={i} dia={dia} eventos={eventos} horas={horas} />
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * La franja de tareas de un día, encima de las horas.
 *
 * Una tarea vence un día y no a una hora, así que ponerla dentro de la
 * rejilla obligaría a inventarle una: aparecería a las 7:00 como si hubiera
 * que hacerla al abrir, y taparía una cita de verdad. Va en la franja de
 * arriba, que es donde TimeTree pone lo de todo el día.
 *
 * Lo pendiente que ya venció se pinta en hoy, en rojo y con los días que
 * lleva: dejarlo en su día es cómo se pierde una tarea, porque nadie vuelve a
 * mirar el jueves de la semana pasada.
 */
const TareasDelDia = ({
  tareas,
  alCambiar,
  alReservar,
}: {
  tareas: TareaDeAgenda[];
  alCambiar: (id: string, hecha: boolean) => Promise<void>;
  alReservar: (tarea: TareaDeAgenda) => void;
}) => (
  <div className="border-l px-1 py-1 flex flex-col gap-1 min-h-8">
    {tareas.map((t) => (
      <div
        key={t.id}
        // `min-w-0` no es decorativo: sin él un elemento flexible no se
        // encoge por debajo de su texto, el `truncate` no recorta nada y una
        // tarea de título largo se derrama sobre la columna del día siguiente.
        className="flex min-w-0 items-start gap-1 text-[10px] leading-tight"
      >
        <input
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={t.hecha}
          aria-label={`Dar por hecha: ${t.texto}`}
          onChange={() => alCambiar(t.id, !t.hecha)}
        />
        {/*
          El texto es un botón y no parte de la etiqueta de la casilla: dentro
          de un `<label>`, pulsar el texto marca la tarea, y aquí pulsar el
          texto es reservarle hora. Las dos cosas en el mismo sitio darían por
          hecha una tarea cada vez que alguien quisiera agendarla.
        */}
        <button
          type="button"
          onClick={() => alReservar(t)}
          title={[
            t.texto,
            t.empresa,
            t.vencida ? `Vencida hace ${t.diasDeRetraso} día(s)` : null,
            t.citas > 0 ? `${t.citas} hora(s) reservada(s)` : "Reservar hora",
          ]
            .filter(Boolean)
            .join(" · ")}
          className={`min-w-0 truncate text-left hover:underline ${
            t.hecha
              ? "line-through text-muted-foreground"
              : t.vencida
                ? "text-destructive"
                : ""
          }`}
        >
          {t.vencida && !t.hecha ? `${t.diasDeRetraso}d · ` : ""}
          {t.citas > 0 ? "📅 " : ""}
          {t.texto}
        </button>
      </div>
    ))}
  </div>
);

const ColumnaDia = ({
  dia,
  eventos,
  horas,
}: {
  dia: Date;
  eventos: Evento[];
  horas: number[];
}) => {
  const delDia = eventos.filter((e) => {
    const inicio = new Date(e.inicio);
    return inicio.toDateString() === dia.toDateString();
  });

  // Se reparten en columnas aquí mismo: dos citas a la misma hora, una al lado
  // de la otra. Apilarlas escondería justo la que hay que resolver.
  const ordenados = [...delDia].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  const finPorColumna: number[] = [];
  const colocados = ordenados.map((evento) => {
    const inicio = new Date(evento.inicio).getTime();
    let columna = finPorColumna.findIndex((fin) => fin <= inicio);
    if (columna === -1) {
      columna = finPorColumna.length;
      finPorColumna.push(0);
    }
    finPorColumna[columna] = new Date(evento.fin).getTime();
    return { evento, columna };
  });
  const columnas = Math.max(finPorColumna.length, 1);

  return (
    <div className="relative border-l" style={{ height: horas.length * ALTO_HORA }}>
      {horas.map((h) => (
        <div key={h} className="border-b border-dashed" style={{ height: ALTO_HORA }} />
      ))}

      {colocados.map(({ evento, columna }) => {
        const inicio = new Date(evento.inicio);
        const fin = new Date(evento.fin);
        const desdeMin = (inicio.getHours() - HORA_INICIO) * 60 + inicio.getMinutes();
        const duracionMin = Math.max((fin.getTime() - inicio.getTime()) / 60000, 30);

        return (
          <div
            key={evento.id}
            className="absolute rounded px-1 py-0.5 text-[10px] text-white overflow-hidden"
            style={{
              top: (desdeMin / 60) * ALTO_HORA,
              height: (duracionMin / 60) * ALTO_HORA - 2,
              left: `${(columna / columnas) * 100}%`,
              width: `${(1 / columnas) * 100}%`,
              background: evento.calendario_color,
              // Lo marcado como importante destaca con un borde claro, que es
              // lo que pedía el modelo de TimeTree.
              outline: evento.importante ? "2px solid #fbbf24" : undefined,
            }}
            title={`${evento.titulo}${evento.lugar ? ` · ${evento.lugar}` : ""}`}
          >
            <div className="font-medium truncate">{evento.titulo}</div>
            {evento.empresa && <div className="truncate opacity-80">{evento.empresa}</div>}
          </div>
        );
      })}
    </div>
  );
};

const NuevoCalendario = ({
  alCrear,
}: {
  alCrear: (nombre: string, color: string) => Promise<void>;
}) => {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState("#1e3a5f");

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Nuevo calendario
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 border rounded p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!nombre.trim()) return;
        await alCrear(nombre, color);
        setNombre("");
        setAbierto(false);
      }}
    >
      <Input
        value={nombre}
        placeholder="Nombre"
        autoFocus
        onChange={(e) => setNombre(e.target.value)}
      />
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-8 w-full"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!nombre.trim()}>
          Crear
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
};

const NuevoEvento = ({
  calendarios,
  semana,
  tarea,
  alCerrar,
  alCrear,
}: {
  calendarios: Calendario[];
  semana: Date;
  /** La tarea a la que se le reserva hora, si la cita nace de una. */
  tarea?: TareaDeAgenda | null;
  alCerrar: () => void;
  alCrear: (datos: Record<string, unknown>) => Promise<void>;
}) => {
  const [calendario, setCalendario] = useState(calendarios[0]?.id ?? "");
  const [titulo, setTitulo] = useState(tarea?.texto ?? "");
  const [lugar, setLugar] = useState("");
  // Para una tarea vencida, hoy: reservar hora el día en que venció es
  // reservarla en el pasado.
  const [fecha, setFecha] = useState(() =>
    tarea ? (tarea.vencida ? comoDia(new Date()) : tarea.vence) : comoDia(semana),
  );
  const [desde, setDesde] = useState("09:00");
  const [hasta, setHasta] = useState("10:00");
  const [importante, setImportante] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await alCrear({
        calendario: Number(calendario),
        titulo,
        lugar: lugar || undefined,
        // Se construyen en hora local y se mandan en ISO: el servidor guarda
        // con zona, así que una cita a las 9:00 en Quito sigue siendo a las
        // 9:00 aunque la mire alguien desde otro huso.
        inicio: new Date(`${fecha}T${desde}`).toISOString(),
        fin: new Date(`${fecha}T${hasta}`).toISOString(),
        importante,
        // De qué tarea sale la cita. La tarea conserva su vencimiento: esto
        // es cuándo se va a hacer, no cuándo hay que haberlo hecho.
        tareaId: tarea ? Number(tarea.id) : undefined,
        oportunidadId: tarea?.deal_id ? Number(tarea.deal_id) : undefined,
        contactoId: tarea?.contact_id ? Number(tarea.contact_id) : undefined,
      });
    } catch (e: any) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
      role="presentation"
      onClick={alCerrar}
    >
      <form
        className="bg-background rounded-lg p-4 w-full max-w-sm flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={enviar}
      >
        <h2 className="font-semibold">
          {tarea ? "Reservar hora para la tarea" : "Nuevo evento"}
        </h2>
        {tarea && (
          <p className="text-xs text-muted-foreground">
            La tarea sigue venciendo el {tarea.vence}
            {tarea.empresa ? ` · ${tarea.empresa}` : ""}
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/*
          Se puede llegar aquí desde una tarea sin tener ningún calendario en
          el que escribir. Decirlo ahora es mejor que dejar rellenar el
          formulario entero para que el servidor conteste «falta el
          calendario», que no explica qué hacer.
        */}
        {calendarios.length === 0 && (
          <Alert>
            <AlertDescription>
              Necesitas un calendario donde poner la cita. Créalo en la columna
              de la izquierda.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1">
          <Label>Calendario</Label>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={calendario}
            onChange={(e) => setCalendario(e.target.value)}
          >
            {calendarios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Título</Label>
          <Input value={titulo} autoFocus onChange={(e) => setTitulo(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Lugar</Label>
          <Input value={lugar} onChange={(e) => setLugar(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <Label>Fecha</Label>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Desde</Label>
            <Input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Hasta</Label>
            <Input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={importante}
            onChange={(e) => setImportante(e.target.checked)}
          />
          Marcar como importante
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando || !titulo.trim() || !calendario}>
            {guardando ? "Guardando…" : "Crear"}
          </Button>
        </div>
      </form>
    </div>
  );
};

AgendaPage.path = "/agenda";
