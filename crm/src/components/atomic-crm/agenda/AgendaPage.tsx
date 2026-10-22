import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  crearCalendario,
  crearEvento,
  listarCalendarios,
  listarEventos,
  lunesDe,
  sumarDias,
  type Calendario,
  type Evento,
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
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

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

  useEffect(() => {
    cargarCalendarios();
  }, [cargarCalendarios]);

  useEffect(() => {
    cargarEventos();
  }, [cargarEventos]);

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

        <SemanaVertical semana={semana} eventos={visibles} />
      </div>

      {creando && (
        <NuevoEvento
          calendarios={calendarios.filter((c) => c.puede_editar)}
          semana={semana}
          alCerrar={() => setCreando(false)}
          alCrear={async (datos) => {
            await crearEvento(datos);
            setCreando(false);
            await cargarEventos();
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
const SemanaVertical = ({ semana, eventos }: { semana: Date; eventos: Evento[] }) => {
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
  alCerrar,
  alCrear,
}: {
  calendarios: Calendario[];
  semana: Date;
  alCerrar: () => void;
  alCrear: (datos: Record<string, unknown>) => Promise<void>;
}) => {
  const [calendario, setCalendario] = useState(calendarios[0]?.id ?? "");
  const [titulo, setTitulo] = useState("");
  const [lugar, setLugar] = useState("");
  const [fecha, setFecha] = useState(() => semana.toISOString().slice(0, 10));
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
        <h2 className="font-semibold">Nuevo evento</h2>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
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
