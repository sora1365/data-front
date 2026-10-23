import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  guardarGuion,
  guionAplicable,
  type Guion as GuionDato,
  type Objecion,
} from "../providers/friday/listas";

/**
 * El guion de la llamada, al lado de la lista.
 *
 * Las primeras llamadas de alguien nuevo son malas no porque no sepa vender,
 * sino porque no sabe qué decir de este producto a esta empresa, y lo aprende
 * a costa de los primeros cuarenta números. Esto no obliga a leer nada: pone
 * delante lo que a los demás ya les funcionó.
 *
 * Lo que de verdad importa son las **objeciones**: la apertura se aprende en
 * tres llamadas, y «ya tengo contador» se contesta bien o se pierde la venta.
 */
export const Guion = ({
  producto,
  segmento,
}: {
  producto?: string;
  segmento?: string;
}) => {
  const [guion, setGuion] = useState<GuionDato | null>(null);
  const [editando, setEditando] = useState(false);
  const [abierto, setAbierto] = useState(true);

  useEffect(() => {
    guionAplicable(producto, segmento).then(setGuion).catch(() => setGuion(null));
  }, [producto, segmento]);

  if (!segmento) return null;

  if (editando) {
    return (
      <Editor
        guion={guion}
        producto={producto}
        segmento={segmento}
        alCerrar={() => setEditando(false)}
        alGuardar={(g) => {
          setGuion(g);
          setEditando(false);
        }}
      />
    );
  }

  if (!guion) {
    return (
      <div className="border rounded-lg p-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          No hay guion para esta lista. Lo que funcione en las primeras
          llamadas, escríbelo aquí y lo tiene el resto del equipo.
        </p>
        <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
          Escribir el guion
        </Button>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{guion.nombre}</span>
          {/*
            Se dice de dónde sale el guion: cuando el de producto tapa al
            general, quien llama tiene que poder ver cuál está leyendo.
          */}
          <Badge variant="outline" className="font-normal">
            {guion.producto_nombre ?? (guion.producto ? guion.producto : "cualquier producto")}
            {" · "}
            {guion.segmento_nombre ?? (guion.segmento ? guion.segmento : "cualquier lista")}
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAbierto((v) => !v)}>
            {abierto ? "Ocultar" : "Ver guion"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
            Editar
          </Button>
        </div>
      </div>

      {abierto && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            {guion.apertura && (
              <div>
                <p className="text-xs text-muted-foreground">Apertura</p>
                <p className="text-sm whitespace-pre-line">{guion.apertura}</p>
              </div>
            )}
            {guion.preguntas?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Qué preguntar</p>
                <ul className="text-sm list-disc pl-5">
                  {guion.preguntas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {guion.cierre && (
              <div>
                <p className="text-xs text-muted-foreground">Cómo cerrar</p>
                <p className="text-sm whitespace-pre-line">{guion.cierre}</p>
              </div>
            )}
          </div>

          {guion.objeciones?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Si le dicen…</p>
              <div className="space-y-2">
                {guion.objeciones.map((o) => (
                  <div key={o.objecion} className="border-l-2 pl-2">
                    <p className="text-sm font-medium">«{o.objecion}»</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {o.respuesta}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Editor = ({
  guion,
  producto,
  segmento,
  alCerrar,
  alGuardar,
}: {
  guion: GuionDato | null;
  producto?: string;
  segmento: string;
  alCerrar: () => void;
  alGuardar: (guion: GuionDato) => void;
}) => {
  const [nombre, setNombre] = useState(guion?.nombre ?? "Guion de esta lista");
  const [apertura, setApertura] = useState(guion?.apertura ?? "");
  const [cierre, setCierre] = useState(guion?.cierre ?? "");
  const [preguntas, setPreguntas] = useState<string[]>(guion?.preguntas ?? [""]);
  const [objeciones, setObjeciones] = useState<Objecion[]>(
    guion?.objeciones?.length ? guion.objeciones : [{ objecion: "", respuesta: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const guardado = await guardarGuion({
        // Edita el que ya había, o crea uno del ámbito que se está mirando: el
        // código sale de producto y segmento para que no haya dos guiones
        // compitiendo por la misma llamada.
        codigo: guion?.codigo ?? [producto ?? "general", segmento].join("_"),
        nombre,
        producto: guion?.producto ?? producto ?? null,
        segmento: guion?.segmento ?? segmento,
        apertura,
        cierre,
        preguntas,
        objeciones,
      });
      alGuardar(guardado);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Guion</span>
        <Button size="sm" variant="ghost" onClick={alCerrar}>
          Cancelar
        </Button>
      </div>

      <label className="text-xs text-muted-foreground flex flex-col gap-1">
        Nombre
        <Input className="h-9" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>

      <label className="text-xs text-muted-foreground flex flex-col gap-1">
        Apertura
        <Textarea rows={3} value={apertura} onChange={(e) => setApertura(e.target.value)} />
      </label>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Qué preguntar</p>
        {preguntas.map((p, i) => (
          <Input
            key={i}
            className="h-8"
            value={p}
            onChange={(e) =>
              setPreguntas((previas) => previas.map((x, j) => (j === i ? e.target.value : x)))
            }
          />
        ))}
        <Button size="sm" variant="ghost" onClick={() => setPreguntas((p) => [...p, ""])}>
          + Pregunta
        </Button>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Objeciones y su respuesta · es lo que más sirve
        </p>
        {objeciones.map((o, i) => (
          <div key={i} className="flex flex-col gap-1 sm:flex-row">
            <Input
              className="h-8 sm:w-56"
              placeholder="Ya tengo contador"
              value={o.objecion}
              onChange={(e) =>
                setObjeciones((previas) =>
                  previas.map((x, j) => (j === i ? { ...x, objecion: e.target.value } : x)),
                )
              }
            />
            <Input
              className="h-8 flex-1"
              placeholder="Qué contestar"
              value={o.respuesta}
              onChange={(e) =>
                setObjeciones((previas) =>
                  previas.map((x, j) => (j === i ? { ...x, respuesta: e.target.value } : x)),
                )
              }
            />
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setObjeciones((o) => [...o, { objecion: "", respuesta: "" }])}
        >
          + Objeción
        </Button>
      </div>

      <label className="text-xs text-muted-foreground flex flex-col gap-1">
        Cómo cerrar
        <Textarea rows={2} value={cierre} onChange={(e) => setCierre(e.target.value)} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button size="sm" onClick={guardar} disabled={ocupado}>
        {ocupado ? "Guardando…" : "Guardar el guion"}
      </Button>
    </div>
  );
};
