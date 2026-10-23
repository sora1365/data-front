import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Settings,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  CANALES,
  CANAL_SISTEMA,
  nombreDeCanal,
  obtenerOportunidad,
  paraCampoLocal,
  registrarInteraccion,
  type Contacto,
  type Direccion,
  type Interaccion,
} from "../providers/friday/interacciones";

const ICONO: Record<string, typeof Phone> = {
  llamada: Phone,
  whatsapp: MessageSquare,
  correo: Mail,
  reunion: Users,
  visita: MapPin,
  otro: MoreHorizontal,
  [CANAL_SISTEMA]: Settings,
};

const fechaLarga = new Intl.DateTimeFormat("es-EC", {
  dateStyle: "medium",
  timeStyle: "short",
});

const nombreDeContacto = (c: Contacto) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || `Contacto ${c.id}`;

/**
 * El historial de la venta, y el formulario para anotar una conversación.
 *
 * Es lo que contesta «qué dijo cuando se le llamó», que el tablero no dice: el
 * tablero sólo sabe en qué etapa está. Va aquí, dentro de la ficha, porque es
 * donde la persona ya está mirando cuando acaba de colgar el teléfono.
 *
 * Lo que escribe el sistema al mover una tarjeta se muestra igual, con su
 * canal, para que la línea de tiempo no mienta por omisión: una venta que
 * cambió de etapa sin que nadie hablara con nadie es exactamente la señal que
 * hay que ver.
 */
export const Historial = ({ dealId }: { dealId: string | number }) => {
  const [interacciones, setInteracciones] = useState<Interaccion[]>([]);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const ficha = await obtenerOportunidad(dealId);
      setInteracciones(ficha.interacciones ?? []);
      setContactos(ficha.contactos ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el historial.");
    } finally {
      setCargando(false);
    }
  }, [dealId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground tracking-wide">
          Historial de contacto
        </span>
        <Button
          size="sm"
          variant={abierto ? "ghost" : "outline"}
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? "Cancelar" : "Anotar conversación"}
        </Button>
      </div>

      {abierto ? (
        <Formulario
          dealId={dealId}
          contactos={contactos}
          onGuardado={async () => {
            setAbierto(false);
            await cargar();
          }}
        />
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : interacciones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay nada anotado. Cuando llames o escribas a este cliente,
          anótalo aquí.
        </p>
      ) : (
        <ol className="space-y-3">
          {interacciones.map((i) => (
            <Fila key={i.id} interaccion={i} />
          ))}
        </ol>
      )}
    </div>
  );
};

const Fila = ({ interaccion: i }: { interaccion: Interaccion }) => {
  const Icono = ICONO[i.canal] ?? MoreHorizontal;
  const Flecha = i.direccion === "entrante" ? ArrowDownLeft : ArrowUpRight;
  const delSistema = i.canal === CANAL_SISTEMA;
  const fecha = new Date(i.ocurrido_en);

  return (
    <li className="flex gap-3">
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          delSistema ? "bg-muted" : "bg-primary/10"
        }`}
      >
        <Icono className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{nombreDeCanal(i.canal)}</span>
          {delSistema ? null : (
            <Badge variant="outline" className="gap-1 font-normal">
              <Flecha className="h-3 w-3" />
              {i.direccion === "entrante" ? "Entrante" : "Saliente"}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {Number.isNaN(fecha.getTime()) ? i.ocurrido_en : fechaLarga.format(fecha)}
            {" · "}
            {i.autor}
          </span>
        </div>
        {i.resultado ? (
          <p className="text-sm text-muted-foreground">{i.resultado}</p>
        ) : null}
        {i.texto ? <p className="text-sm leading-6 whitespace-pre-line">{i.texto}</p> : null}
      </div>
    </li>
  );
};

const Formulario = ({
  dealId,
  contactos,
  onGuardado,
}: {
  dealId: string | number;
  contactos: Contacto[];
  onGuardado: () => void | Promise<void>;
}) => {
  const [canal, setCanal] = useState<string>("llamada");
  const [direccion, setDireccion] = useState<Direccion>("saliente");
  const [contacto, setContacto] = useState<string>("");
  const [resultado, setResultado] = useState("");
  const [texto, setTexto] = useState("");
  // Por defecto, ahora: lo normal es anotar lo que se acaba de hacer, y se
  // puede corregir para la llamada de ayer que nadie apuntó.
  const [cuando, setCuando] = useState(() => paraCampoLocal(new Date()));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await registrarInteraccion(dealId, {
        canal,
        direccion,
        contacto: contacto ? Number(contacto) : null,
        resultado,
        texto,
        // El campo da hora local sin zona; `new Date` la interpreta como local
        // y el ISO que sale lleva ya el desplazamiento correcto.
        ocurridoEn: cuando ? new Date(cuando).toISOString() : undefined,
      });
      await onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="canal">Canal</Label>
          <select
            id="canal"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
          >
            {CANALES.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="direccion">Dirección</Label>
          <select
            id="direccion"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value as Direccion)}
          >
            <option value="saliente">Saliente (le escribimos)</option>
            <option value="entrante">Entrante (nos escribió)</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cuando">Cuándo</Label>
          <Input
            id="cuando"
            type="datetime-local"
            className="w-56"
            value={cuando}
            onChange={(e) => setCuando(e.target.value)}
          />
        </div>

        {contactos.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="contacto">Con quién</Label>
            <select
              id="contacto"
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
            >
              <option value="">Sin especificar</option>
              {contactos.map((c) => (
                <option key={c.id} value={c.id}>
                  {nombreDeContacto(c)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="resultado">En una línea</Label>
        <Input
          id="resultado"
          placeholder="Quedó en revisar la propuesta"
          value={resultado}
          onChange={(e) => setResultado(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="texto">Detalle</Label>
        <Textarea
          id="texto"
          rows={3}
          placeholder="Lo que se habló, para quien lo lea en dos meses."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Separator />

      <Button size="sm" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar en el historial"}
      </Button>
    </div>
  );
};
