import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  catalogosTickets,
  crearTicket,
  duracion,
  enlaceDeSoporte,
  listarTickets,
  NOMBRE_DE_ESTADO,
  NOMBRE_DE_TIPO,
  resumenTickets,
  type CatalogosTickets,
  type ResumenTickets,
  type Ticket,
  type Vista,
} from "../providers/friday/tickets";
import { BuscarEmpresa, EtiquetaPrioridad, EtiquetaSla, SELECT } from "./comunes";
import { FichaTicket } from "./FichaTicket";

const VISTAS: { vista: Vista; nombre: string }[] = [
  { vista: "abiertos", nombre: "Abiertos" },
  { vista: "vencidos", nombre: "Vencidos" },
  { vista: "mios", nombre: "Míos" },
  { vista: "esperando", nombre: "Esperando al cliente" },
  { vista: "terminados", nombre: "Resueltos" },
  { vista: "todos", nombre: "Todos" },
];

/**
 * Soporte: lo que los clientes piden después de comprar.
 *
 * La lista sale ordenada por urgencia —vencidos, por vencer, el resto por lo
 * que vence antes— y no por fecha: el ticket que hay que mirar es el que se
 * está pasando de plazo, no el último que entró.
 */
export const TicketsPage = () => {
  const [parametros, setParametros] = useSearchParams();
  const elegido = parametros.get("id");
  const [vista, setVista] = useState<Vista>("abiertos");
  const [busqueda, setBusqueda] = useState("");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [resumen, setResumen] = useState<ResumenTickets | null>(null);
  const [catalogos, setCatalogos] = useState<CatalogosTickets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [lista, cifras] = await Promise.all([listarTickets(vista, busqueda), resumenTickets()]);
      setTickets(lista);
      setResumen(cifras);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [vista, busqueda]);

  useEffect(() => {
    const espera = setTimeout(cargar, busqueda ? 250 : 0);
    return () => clearTimeout(espera);
  }, [cargar, busqueda]);

  useEffect(() => {
    catalogosTickets().then(setCatalogos).catch(() => {});
  }, []);

  const elegir = (id: string | null) => {
    const p = new URLSearchParams(parametros);
    if (id) p.set("id", id);
    else p.delete("id");
    setParametros(p, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Soporte</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes, quejas y reclamos de los clientes, con su plazo.{" "}
            <a className="underline" href={enlaceDeSoporte()} target="_blank" rel="noreferrer">
              Formulario público
            </a>
          </p>
        </div>
        <Button onClick={() => setCreando(true)}>Nuevo ticket</Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resumen && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <Cifra
            titulo="Abiertos"
            valor={String(resumen.abiertos)}
            pie={
              resumen.sinResponsable
                ? `${resumen.sinResponsable} sin responsable`
                : `${resumen.esperandoCliente} esperando al cliente`
            }
          />
          <Cifra
            titulo="Vencidos"
            valor={String(resumen.vencidos)}
            pie={`${resumen.porVencer} por vencer`}
            alerta={resumen.vencidos > 0}
          />
          <Cifra
            titulo="Primera respuesta"
            valor={duracion(resumen.minutosRespuesta)}
            pie={
              resumen.respuestaATiempo === null
                ? `promedio, ${resumen.dias} días`
                : `${resumen.respuestaATiempo} % a tiempo`
            }
          />
          <Cifra
            titulo="Resolución"
            valor={duracion(resumen.minutosResolucion)}
            pie={
              resumen.slaCumplido === null
                ? `promedio, ${resumen.dias} días`
                : `${resumen.slaCumplido} % en plazo · ${resumen.resueltos} resueltos`
            }
          />
          {/* Sin respuestas, «—» y no cero: un cero diría que todos salieron
              descontentos, y la verdad es que no se sabe. */}
          <Cifra
            titulo="Satisfacción"
            valor={resumen.csat.satisfechos === null ? "—" : `${resumen.csat.satisfechos} %`}
            pie={`${resumen.csat.respuestas} respuesta(s) · 4 o 5 de 5`}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Button
            key={v.vista}
            size="sm"
            variant={vista === v.vista ? "secondary" : "ghost"}
            onClick={() => setVista(v.vista)}
          >
            {v.nombre}
          </Button>
        ))}
        <Input
          className="w-full sm:w-64 sm:ml-auto"
          value={busqueda}
          placeholder="Buscar por asunto, cliente o #número"
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <section className={`w-full ${elegido ? "lg:w-[44%]" : ""} flex flex-col gap-1`}>
          {tickets === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg p-4">
              {vista === "vencidos"
                ? "Nada vencido. Así tiene que estar."
                : vista === "abiertos"
                  ? "No hay tickets abiertos."
                  : "Nada que mostrar con este filtro."}
            </p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => elegir(t.id)}
                className={`text-left rounded-md border p-2.5 hover:bg-muted ${
                  elegido === t.id ? "bg-muted border-primary" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium min-w-0 truncate">
                    <span className="text-muted-foreground">#{t.id}</span> {t.asunto}
                  </span>
                  <EtiquetaSla
                    estado={t.sla_estado}
                    plazo={t.sla.respuesta.restantesMin !== null ? t.sla.respuesta : t.sla.resolucion}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <span className="truncate max-w-[14rem]">
                    {t.empresa ?? t.solicitante_nombre ?? t.solicitante_correo ?? "sin cliente"}
                  </span>
                  <span>· {NOMBRE_DE_TIPO[t.tipo] ?? t.tipo}</span>
                  <EtiquetaPrioridad prioridad={t.prioridad} />
                  <span>· {NOMBRE_DE_ESTADO[t.estado]}</span>
                  <span className={t.responsable ? "" : "text-amber-700"}>
                    · {t.responsable_nombre ?? "sin responsable"}
                  </span>
                </div>
              </button>
            ))
          )}
        </section>

        {elegido && (
          <section className="w-full lg:flex-1 border rounded-lg p-4 min-w-0">
            <div className="flex justify-end -mt-2 -mr-2">
              <Button size="sm" variant="ghost" onClick={() => elegir(null)}>
                Cerrar
              </Button>
            </div>
            <FichaTicket id={elegido} catalogos={catalogos} onCambio={cargar} />
          </section>
        )}
      </div>

      <NuevoTicket
        abierto={creando}
        catalogos={catalogos}
        onCerrar={() => setCreando(false)}
        onCreado={(id) => {
          setCreando(false);
          cargar();
          elegir(String(id));
        }}
      />
    </div>
  );
};

TicketsPage.path = "/tickets";

const Cifra = ({
  titulo,
  valor,
  pie,
  alerta,
}: {
  titulo: string;
  valor: string;
  pie: string;
  alerta?: boolean;
}) => (
  <div className={`border rounded-lg p-3 ${alerta ? "border-red-300 bg-red-50 dark:bg-red-950/30" : ""}`}>
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className={`text-2xl font-semibold tabular-nums ${alerta ? "text-red-700" : ""}`}>{valor}</p>
    <p className="text-[11px] text-muted-foreground">{pie}</p>
  </div>
);

/**
 * Anotar un ticket que entró por teléfono o en persona.
 *
 * La prioridad arranca en «según el tipo»: una queja o un reclamo suben a alta
 * solos. Obligar a elegirla cada vez es cómo todo acaba en «media».
 */
const NuevoTicket = ({
  abierto,
  catalogos,
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  catalogos: CatalogosTickets | null;
  onCerrar: () => void;
  onCreado: (id: number) => void;
}) => {
  const vacio = {
    asunto: "",
    descripcion: "",
    tipo: "consulta",
    prioridad: "",
    canal: "telefono",
    responsable: "",
    solicitante_nombre: "",
    solicitante_correo: "",
    solicitante_telefono: "",
  };
  const [d, setD] = useState(vacio);
  const [empresa, setEmpresa] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof vacio) => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value });

  useEffect(() => {
    if (abierto) {
      setD(vacio);
      setEmpresa(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const { id } = await crearTicket({
        ...d,
        prioridad: d.prioridad || undefined,
        // Vacío es «el que lleva la cuenta»; el servidor lo decide.
        responsable: d.responsable || undefined,
        empresa_id: empresa ? Number(empresa.id) : undefined,
      });
      onCreado(id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo ticket</DialogTitle>
          <DialogDescription>
            Lo que entra por formulario o WhatsApp se crea solo; esto es para lo
            que llega por teléfono o en persona.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={guardar} className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-1">
            <Label>Asunto</Label>
            <Input value={d.asunto} autoFocus onChange={campo("asunto")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>Tipo</span>
              <select className={SELECT} value={d.tipo} onChange={campo("tipo")}>
                {(catalogos?.tipos ?? ["consulta"]).map((x) => (
                  <option key={x} value={x}>
                    {NOMBRE_DE_TIPO[x] ?? x}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Prioridad</span>
              <select className={SELECT} value={d.prioridad} onChange={campo("prioridad")}>
                <option value="">Según el tipo</option>
                {catalogos?.prioridades.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Entró por</span>
              <select className={SELECT} value={d.canal} onChange={campo("canal")}>
                <option value="telefono">Teléfono</option>
                <option value="manual">En persona / otro</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Responsable</span>
              <select className={SELECT} value={d.responsable} onChange={campo("responsable")}>
                <option value="">El que lleva la cuenta</option>
                {catalogos?.comerciales.map((c) => (
                  <option key={c.usuario} value={c.usuario}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Empresa</Label>
            {empresa ? (
              <div className="flex items-center justify-between text-sm border rounded px-2 py-1">
                <span>{empresa.name}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEmpresa(null)}>
                  Quitar
                </Button>
              </div>
            ) : (
              <BuscarEmpresa onElegir={setEmpresa} />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Quién llama" value={d.solicitante_nombre} onChange={campo("solicitante_nombre")} />
            <Input placeholder="Correo" value={d.solicitante_correo} onChange={campo("solicitante_correo")} />
            <Input placeholder="Teléfono" value={d.solicitante_telefono} onChange={campo("solicitante_telefono")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Qué pide</Label>
            <Textarea rows={4} value={d.descripcion} onChange={campo("descripcion")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando || !d.asunto.trim()}>
              Crear
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
