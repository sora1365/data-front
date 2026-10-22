import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  crearCampania,
  enviarCampania,
  estadoCorreo,
  listarCampanias,
  listarDestinatarios,
  listarSegmentos,
  obtenerCampania,
  prepararCampania,
  type Campania,
  type Destinatario,
} from "../providers/friday/campanias";

/**
 * Campañas de correo por segmento.
 *
 * El flujo tiene tres pasos a propósito —escribir, preparar, enviar— y el del
 * medio no se puede saltar: preparar calcula a quién se escribiría y por qué
 * se descarta a cada quien, **sin mandar nada**. Un correo enviado no se
 * puede retirar, así que la revisión previa es la única oportunidad de ver que
 * la lista no es la que se creía.
 */
export const CampaniasPage = () => {
  const [campanias, setCampanias] = useState<Campania[]>([]);
  const [abierta, setAbierta] = useState<Campania | null>(null);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCampanias(await listarCampanias());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
    estadoCorreo()
      .then((e) => setConectado(e.conectado))
      .catch(() => setConectado(null));
  }, [cargar]);

  const abrir = async (id: string) => {
    try {
      setAbierta(await obtenerCampania(id));
      setDestinatarios(await listarDestinatarios(id));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const preparar = async (exigirConsentimientoExpreso: boolean) => {
    if (!abierta) return;
    setOcupado(true);
    try {
      setAbierta(await prepararCampania(abierta.id, { exigirConsentimientoExpreso }));
      setDestinatarios(await listarDestinatarios(abierta.id));
      await cargar();
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    if (!abierta) return;
    setOcupado(true);
    try {
      setAbierta(await enviarCampania(abierta.id));
      setDestinatarios(await listarDestinatarios(abierta.id));
      await cargar();
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Campañas</h1>
        <div className="flex items-center gap-2">
          {conectado === false && (
            <Badge variant="outline" className="border-amber-400 text-amber-700">
              Sin proveedor de correo: se prepara pero no se envía
            </Badge>
          )}
          <Button size="sm" onClick={() => setCreando(true)}>
            Nueva campaña
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-4 items-start">
        <aside className="w-64 shrink-0 flex flex-col gap-1">
          {campanias.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay ninguna.</p>
          )}
          {campanias.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => abrir(c.id)}
              className={`text-left rounded-md border p-2 hover:bg-muted ${
                abierta?.id === c.id ? "bg-muted border-primary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{c.nombre}</span>
                <EstadoCampania estado={c.estado} />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {c.segmento_nombre ?? "sin segmento"}
              </p>
              {(c.destinatarios ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {c.enviados ?? 0} de {c.destinatarios} enviados
                  {(c.abiertos ?? 0) > 0 && ` · ${c.abiertos} abiertos`}
                </p>
              )}
            </button>
          ))}
        </aside>

        <section className="flex-1 min-w-0">
          {!abierta ? (
            <p className="text-sm text-muted-foreground">
              Elige una campaña o crea una nueva.
            </p>
          ) : (
            <Detalle
              campania={abierta}
              destinatarios={destinatarios}
              ocupado={ocupado}
              alPreparar={preparar}
              alEnviar={enviar}
            />
          )}
        </section>
      </div>

      {creando && (
        <NuevaCampania
          alCerrar={() => setCreando(false)}
          alCrear={async (datos) => {
            const nueva = await crearCampania(datos);
            setCreando(false);
            await cargar();
            await abrir(nueva.id);
          }}
        />
      )}
    </div>
  );
};

const EstadoCampania = ({ estado }: { estado: Campania["estado"] }) => {
  const estilo =
    {
      borrador: "outline",
      preparada: "secondary",
      enviando: "default",
      enviada: "default",
      cancelada: "outline",
    }[estado] ?? "outline";
  return (
    <Badge variant={estilo as any} className="text-[10px] shrink-0">
      {estado}
    </Badge>
  );
};

const Detalle = ({
  campania,
  destinatarios,
  ocupado,
  alPreparar,
  alEnviar,
}: {
  campania: Campania;
  destinatarios: Destinatario[];
  ocupado: boolean;
  alPreparar: (exigir: boolean) => void;
  alEnviar: () => void;
}) => {
  const [exigir, setExigir] = useState(false);
  const [verDescartados, setVerDescartados] = useState(false);
  const resumen = campania.resumen;
  const descartados = destinatarios.filter((d) => d.estado === "descartado");
  const aEnviar = destinatarios.filter((d) => d.estado !== "descartado");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">{campania.nombre}</h2>
        <p className="text-sm text-muted-foreground">
          {campania.segmento_nombre ?? "sin segmento"}
          {campania.remitente && ` · desde ${campania.remitente}`}
        </p>
      </div>

      <div className="border rounded p-3 bg-muted/40">
        <p className="text-xs text-muted-foreground mb-1">Asunto</p>
        <p className="text-sm font-medium">{campania.asunto}</p>
        <p className="text-xs text-muted-foreground mt-3 mb-1">Cuerpo</p>
        <div
          className="text-sm prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: campania.cuerpo }}
        />
      </div>

      {resumen && resumen.total > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <Cifra valor={aEnviar.length} etiqueta="van a recibir" destacado />
          <Cifra valor={resumen.enviados} etiqueta="enviados" />
          <Cifra valor={resumen.descartados} etiqueta="descartados" />
          <Cifra valor={resumen.abiertos} etiqueta="abiertos" />
          {resumen.fallidos > 0 && <Cifra valor={resumen.fallidos} etiqueta="fallidos" />}
        </div>
      )}

      {campania.estado === "borrador" && (
        <div className="flex flex-col gap-2 border rounded p-3">
          <p className="text-sm">
            Preparar calcula a quién se escribiría. <strong>No envía nada.</strong>
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exigir}
              onChange={(e) => setExigir(e.target.checked)}
            />
            Sólo a quien dio consentimiento expreso
          </label>
          {/* Es el modo que hace falta cuando la campaña sale a personas
              físicas: no basta con que no se hayan dado de baja. */}
          <Button className="self-start" disabled={ocupado} onClick={() => alPreparar(exigir)}>
            {ocupado ? "Calculando…" : "Preparar"}
          </Button>
        </div>
      )}

      {campania.estado === "preparada" && (
        <div className="flex flex-col gap-2 border rounded p-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <p className="text-sm">
            Se va a escribir a <strong>{aEnviar.length}</strong> direcciones. Un
            correo enviado no se puede retirar.
          </p>
          <Button className="self-start" disabled={ocupado} onClick={alEnviar}>
            {ocupado ? "Enviando…" : `Enviar a ${aEnviar.length}`}
          </Button>
        </div>
      )}

      {descartados.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setVerDescartados((v) => !v)}
          >
            {verDescartados ? "Ocultar" : "Ver"} los {descartados.length} descartados
          </Button>
          {/* Poder mirarlos es lo que permite defender la cifra: «iban 12.000 y
              salieron 9.400» sin saber qué pasó con el resto no lo sostiene
              nadie. */}
          {verDescartados && (
            <div className="border rounded max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Correo</th>
                    <th className="text-left p-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {descartados.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-2">{d.correo}</td>
                      <td className="p-2 text-muted-foreground">{d.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Cifra = ({
  valor,
  etiqueta,
  destacado,
}: {
  valor: number;
  etiqueta: string;
  destacado?: boolean;
}) => (
  <div className={`border rounded px-3 py-2 ${destacado ? "border-primary" : ""}`}>
    <div className="text-lg font-semibold">{valor.toLocaleString("es-EC")}</div>
    <div className="text-xs text-muted-foreground">{etiqueta}</div>
  </div>
);

const NuevaCampania = ({
  alCerrar,
  alCrear,
}: {
  alCerrar: () => void;
  alCrear: (datos: Record<string, unknown>) => Promise<void>;
}) => {
  const [segmentos, setSegmentos] = useState<
    { codigo: string; nombre: string; miembros: number }[]
  >([]);
  const [datos, setDatos] = useState({
    nombre: "",
    segmento: "",
    asunto: "",
    cuerpo:
      "<p>Hola {{nombre}},</p>\n<p></p>\n<p><a href=\"{{baja}}\">Dejar de recibir estos correos</a></p>",
    remitente: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    listarSegmentos().then(setSegmentos).catch(() => {});
  }, []);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await alCrear({
        nombre: datos.nombre || datos.asunto,
        segmento: datos.segmento || undefined,
        asunto: datos.asunto,
        cuerpo: datos.cuerpo,
        remitente: datos.remitente || undefined,
      });
    } catch (e: any) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 overflow-y-auto"
      role="presentation"
      onClick={alCerrar}
    >
      <form
        className="bg-background rounded-lg p-4 w-full max-w-lg flex flex-col gap-3 my-8"
        onClick={(e) => e.stopPropagation()}
        onSubmit={enviar}
      >
        <h2 className="font-semibold">Nueva campaña</h2>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1">
          <Label>Nombre</Label>
          <Input
            value={datos.nombre}
            onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Segmento</Label>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={datos.segmento}
            onChange={(e) => setDatos({ ...datos, segmento: e.target.value })}
          >
            <option value="">Elige uno</option>
            {segmentos.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.nombre} ({s.miembros.toLocaleString("es-EC")})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Sólo recibirán quienes tengan correo en la base, que son muchos
            menos que los miembros del segmento.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Asunto</Label>
          <Input
            value={datos.asunto}
            onChange={(e) => setDatos({ ...datos, asunto: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Remitente</Label>
          <Input
            value={datos.remitente}
            placeholder="ventas@ascendra.ec"
            onChange={(e) => setDatos({ ...datos, remitente: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Cuerpo</Label>
          <textarea
            className="border rounded px-2 py-1 text-sm font-mono bg-background min-h-40"
            value={datos.cuerpo}
            onChange={(e) => setDatos({ ...datos, cuerpo: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Variables: <code>{"{{nombre}}"}</code> y <code>{"{{baja}}"}</code>, que
            es el enlace para dejar de recibir y es obligatorio.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando || !datos.asunto.trim()}>
            {guardando ? "Guardando…" : "Crear"}
          </Button>
        </div>
      </form>
    </div>
  );
};

CampaniasPage.path = "/campanias";
