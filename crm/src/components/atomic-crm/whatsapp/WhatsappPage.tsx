import { useCallback, useEffect, useRef, useState } from "react";
import { useNotify } from "ra-core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  abrirConversacion,
  estadoWhatsapp,
  enviarMensaje,
  listarConversaciones,
  listarPlantillas,
  marcarLeida,
  restanteEnPalabras,
  type Conversacion,
  type Mensaje,
  type Plantilla,
} from "../providers/friday/whatsapp";

/** Cada cuánto se refresca la bandeja mientras está abierta. */
const REFRESCO_MS = 15_000;

/**
 * La bandeja de WhatsApp.
 *
 * Conversaciones a la izquierda, la abierta a la derecha. Lo que la diferencia
 * de un chat cualquiera es la **ventana de 24 horas**: fuera de ella Meta sólo
 * acepta plantillas aprobadas, así que el cuadro de escribir desaparece y en su
 * sitio quedan las plantillas. Enseñar un cuadro que no se puede usar sería
 * dejar que alguien escriba un párrafo para que el servidor lo rechace.
 */
export const WhatsappPage = () => {
  const notify = useNotify();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [abierta, setAbierta] = useState<
    (Conversacion & { mensajes: Mensaje[] }) | null
  >(null);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finDeLista = useRef<HTMLDivElement>(null);

  const cargarBandeja = useCallback(async () => {
    try {
      setConversaciones(await listarConversaciones({ estado: "abierta" }));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargarBandeja();
    estadoWhatsapp()
      .then((e) => setConectado(e.conectado))
      .catch(() => setConectado(null));
    listarPlantillas()
      .then((p) => setPlantillas(p.filter((x) => x.estado === "aprobada")))
      .catch(() => {});

    // Mientras no haya notificaciones en vivo, se relee cada tanto: una
    // bandeja que no se mueve sola hace que la gente recargue a mano, y
    // mientras tanto el cliente espera.
    const cada = setInterval(cargarBandeja, REFRESCO_MS);
    return () => clearInterval(cada);
  }, [cargarBandeja]);

  const abrir = async (id: string) => {
    try {
      const conv = await abrirConversacion(id);
      setAbierta(conv);
      setError(null);
      if (conv.sin_leer > 0) {
        await marcarLeida(id);
        cargarBandeja();
      }
      setTimeout(() => finDeLista.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const enviar = async (datos: { texto?: string; plantilla?: string; variables?: string[] }) => {
    if (!abierta) return;
    setEnviando(true);
    try {
      const conv = await enviarMensaje(abierta.id, datos);
      setAbierta(conv);
      setTexto("");
      setError(null);
      cargarBandeja();
      setTimeout(() => finDeLista.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e: any) {
      setError(e.message);
      notify(e.message, { type: "error" });
    } finally {
      setEnviando(false);
    }
  };

  const nombreDe = (c: Conversacion) =>
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.nombre_perfil ||
    c.telefono;

  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">WhatsApp</h1>
        {conectado === false && (
          <Badge variant="outline" className="border-amber-400 text-amber-700">
            Sin conectar a Meta: los mensajes se registran pero no salen
          </Badge>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {conversaciones.length === 0 && !abierta ? (
        <Alert>
          <AlertDescription>
            Todavía no hay conversaciones. Aparecerán solas en cuanto alguien
            escriba al número conectado.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex gap-4 items-start">
          {/* ------------------------------------------------------ bandeja */}
          <aside className="w-72 shrink-0 flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
            {conversaciones.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c.id)}
                className={`text-left rounded-md border p-2 hover:bg-muted ${
                  abierta?.id === c.id ? "bg-muted border-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{nombreDe(c)}</span>
                  {c.sin_leer > 0 && (
                    <Badge className="shrink-0">{c.sin_leer}</Badge>
                  )}
                </div>
                {c.empresa && (
                  <p className="text-xs text-muted-foreground truncate">{c.empresa}</p>
                )}
                <p className="text-xs text-muted-foreground truncate">
                  {c.ultimo_texto ?? "—"}
                </p>
                {/* La ventana se enseña en la lista y no sólo al abrir: ver
                    cuáles están por cerrarse es lo que permite contestar a
                    tiempo en vez de pagar una plantilla. */}
                <p
                  className={`text-xs mt-1 ${
                    c.ventana.abierta ? "text-emerald-700" : "text-muted-foreground"
                  }`}
                >
                  {c.ventana.abierta
                    ? `Quedan ${restanteEnPalabras(c.ventana)}`
                    : "Ventana cerrada"}
                </p>
              </button>
            ))}
          </aside>

          {/* ------------------------------------------------- conversación */}
          <section className="flex-1 flex flex-col gap-3 min-w-0">
            {!abierta ? (
              <p className="text-sm text-muted-foreground">
                Elige una conversación de la izquierda.
              </p>
            ) : (
              <>
                <header className="flex items-center justify-between gap-3 border-b pb-2">
                  <div className="min-w-0">
                    <h2 className="font-medium truncate">{nombreDe(abierta)}</h2>
                    <p className="text-xs text-muted-foreground truncate">
                      {abierta.telefono} · por {abierta.canal_nombre}
                    </p>
                  </div>
                  <Badge variant={abierta.ventana.abierta ? "default" : "outline"}>
                    {abierta.ventana.abierta
                      ? `Ventana abierta · ${restanteEnPalabras(abierta.ventana)}`
                      : "Ventana cerrada"}
                  </Badge>
                </header>

                <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto p-1">
                  {abierta.mensajes.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.direccion === "saliente"
                          ? "self-end bg-primary text-primary-foreground"
                          : "self-start bg-muted"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                      <p className="text-[10px] opacity-70 mt-1 flex gap-2">
                        <span>
                          {new Date(m.ocurrido_en).toLocaleString("es-EC", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {m.direccion === "saliente" && <span>{m.estado}</span>}
                        {m.plantilla && <span>plantilla</span>}
                      </p>
                      {m.error && (
                        <p className="text-[10px] text-destructive mt-1">{m.error}</p>
                      )}
                    </div>
                  ))}
                  <div ref={finDeLista} />
                </div>

                {abierta.ventana.abierta ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (texto.trim()) enviar({ texto });
                    }}
                  >
                    <Input
                      value={texto}
                      placeholder="Escribe un mensaje"
                      onChange={(e) => setTexto(e.target.value)}
                    />
                    <Button type="submit" disabled={enviando || !texto.trim()}>
                      {enviando ? "Enviando…" : "Enviar"}
                    </Button>
                  </form>
                ) : (
                  <PlantillasDisponibles
                    plantillas={plantillas}
                    enviando={enviando}
                    alEnviar={(plantilla, variables) => enviar({ plantilla, variables })}
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

/**
 * Lo único que se puede mandar con la ventana cerrada.
 *
 * Las variables se piden una a una, con su número, porque Meta rechaza el
 * envío entero si falta alguna y su error no dice cuál.
 */
const PlantillasDisponibles = ({
  plantillas,
  enviando,
  alEnviar,
}: {
  plantillas: Plantilla[];
  enviando: boolean;
  alEnviar: (plantilla: string, variables: string[]) => void;
}) => {
  const [elegida, setElegida] = useState<Plantilla | null>(null);
  const [valores, setValores] = useState<string[]>([]);

  if (plantillas.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Pasaron 24 horas desde el último mensaje del cliente, así que sólo se
          puede escribir con una plantilla aprobada — y todavía no hay ninguna.
          Se crean y se aprueban en el panel de Meta.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        La ventana de 24 horas se cerró. Para retomar hace falta una plantilla.
      </p>
      <div className="flex flex-wrap gap-2">
        {plantillas.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant={elegida?.id === p.id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setElegida(p);
              setValores(Array(p.variables).fill(""));
            }}
          >
            {p.nombre}
          </Button>
        ))}
      </div>

      {elegida && (
        <div className="flex flex-col gap-2">
          <p className="text-sm bg-muted rounded p-2">{elegida.cuerpo}</p>
          {valores.map((v, i) => (
            <Input
              key={i}
              value={v}
              placeholder={`Dato {{${i + 1}}}`}
              onChange={(e) => {
                const copia = [...valores];
                copia[i] = e.target.value;
                setValores(copia);
              }}
            />
          ))}
          <Button
            type="button"
            className="self-start"
            disabled={enviando || valores.some((v) => !v.trim())}
            onClick={() => alEnviar(elegida.nombre, valores)}
          >
            {enviando ? "Enviando…" : "Enviar plantilla"}
          </Button>
        </div>
      )}
    </div>
  );
};

WhatsappPage.path = "/whatsapp";
