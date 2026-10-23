import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usuarioActual } from "../providers/friday/dataProvider";
import {
  anotarLead,
  asignarLead,
  cambiarEstadoLead,
  catalogosCrm,
  catalogosLeads,
  convertirLead,
  crearFormulario,
  crearLead,
  editarFormulario,
  embudoLeads,
  listarFormularios,
  listarLeads,
  obtenerLead,
  type CampoFormulario,
  type CatalogosCrm,
  type CatalogosLeads,
  type Embudo,
  type EstadoLead,
  type FilaEmbudo,
  type Formulario,
  type Lead,
} from "../providers/friday/leads";

/**
 * Captación de leads.
 *
 * Tres pestañas porque son tres trabajos distintos, de tres personas
 * distintas: la **bandeja** es del comercial, que atiende lo que entra; los
 * **formularios** son de marketing, que los publica; y el **embudo** es de
 * quien decide dónde invertir, que pregunta qué campaña trae clientes.
 */
export const LeadsPage = () => {
  const [pestania, setPestania] = useState<"bandeja" | "formularios" | "embudo">("bandeja");
  const [catalogos, setCatalogos] = useState<CatalogosLeads | null>(null);
  const [crm, setCrm] = useState<CatalogosCrm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([catalogosLeads(), catalogosCrm()])
      .then(([l, c]) => {
        setCatalogos(l);
        setCrm(c);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Leads</h1>
        <div className="flex gap-1 border rounded-md p-0.5">
          {(
            [
              ["bandeja", "Bandeja"],
              ["formularios", "Formularios"],
              ["embudo", "Embudo"],
            ] as const
          ).map(([clave, etiqueta]) => (
            <Button
              key={clave}
              size="sm"
              variant={pestania === clave ? "default" : "ghost"}
              onClick={() => setPestania(clave)}
            >
              {etiqueta}
            </Button>
          ))}
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {catalogos && crm && pestania === "bandeja" && <Bandeja catalogos={catalogos} crm={crm} />}
      {catalogos && crm && pestania === "formularios" && (
        <Formularios catalogos={catalogos} crm={crm} />
      )}
      {crm && pestania === "embudo" && <PanelEmbudo crm={crm} />}
    </div>
  );
};

LeadsPage.path = "/leads";

// ================================================================== bandeja

const ETIQUETA_ESTADO: Record<EstadoLead, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  calificado: "Calificado",
  convertido: "Convertido",
  descartado: "Descartado",
};

const EstadoBadge = ({ estado }: { estado: EstadoLead }) => {
  const clase =
    {
      nuevo: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
      contactado: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
      calificado: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
      convertido: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
      descartado: "bg-muted text-muted-foreground",
    }[estado] ?? "";
  return (
    <Badge variant="outline" className={`text-[10px] shrink-0 border-0 ${clase}`}>
      {ETIQUETA_ESTADO[estado] ?? estado}
    </Badge>
  );
};

/** «hace 5 min», «hace 3 h», «hace 2 d»: en una bandeja importa lo que lleva esperando. */
const hace = (fecha: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};

const Bandeja = ({ catalogos, crm }: { catalogos: CatalogosLeads; crm: CatalogosCrm }) => {
  const [filtros, setFiltros] = useState({ estado: "vivos", asignado: "", q: "" });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [resumen, setResumen] = useState<Partial<Record<EstadoLead, number>>>({});
  const [abierto, setAbierto] = useState<Lead | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const asignado = filtros.asignado === "mios" ? usuarioActual() : filtros.asignado;
      const r = await listarLeads({ ...filtros, asignado });
      setLeads(r.leads);
      setResumen(r.resumen);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [filtros]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const abrir = async (id: string) => {
    try {
      setAbierto(await obtenerLead(id));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  /** Cada acción devuelve el lead actualizado; se refresca también la lista. */
  const actuar = async (accion: () => Promise<Lead>) => {
    try {
      setAbierto(await accion());
      setError(null);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={filtros.estado}
          onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
        >
          <option value="vivos">Por atender</option>
          {catalogos.estados.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]} ({resumen[e] ?? 0})
            </option>
          ))}
          <option value="">Todos</option>
        </select>
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={filtros.asignado}
          onChange={(e) => setFiltros({ ...filtros, asignado: e.target.value })}
        >
          <option value="">De todos</option>
          <option value="mios">Míos</option>
          <option value="sin_asignar">Sin asignar</option>
          {crm.comerciales.map((c) => (
            <option key={c.usuario} value={c.usuario}>
              {c.nombre}
            </option>
          ))}
        </select>
        <Input
          className="w-56 h-8"
          placeholder="Buscar nombre, correo, teléfono…"
          value={filtros.q}
          onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
        />
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {resumen.nuevo ?? 0} nuevos sin atender
        </span>
        <Button size="sm" onClick={() => setCreando(true)}>
          Registrar lead
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <aside className="w-full md:w-80 shrink-0 flex flex-col gap-1 md:max-h-[75vh] overflow-y-auto">
          {leads.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay leads con estos filtros.</p>
          )}
          {leads.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => abrir(l.id)}
              className={`text-left rounded-md border p-2 hover:bg-muted ${
                abierto?.id === l.id ? "bg-muted border-primary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">
                  {l.nombre ?? l.correo ?? l.telefono}
                </span>
                <EstadoBadge estado={l.estado} />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {[l.empresa_nombre, l.formulario_nombre ?? l.origen_canal].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground flex justify-between gap-2">
                <span>
                  {hace(l.ultimo_envio_en)}
                  {l.envios > 1 && ` · escribió ${l.envios} veces`}
                </span>
                <span title="Puntaje: completitud y señales de interés">{l.puntaje} pts</span>
              </p>
              {!l.asignado_a && l.estado === "nuevo" && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">Sin asignar</p>
              )}
            </button>
          ))}
        </aside>

        <section className="flex-1 min-w-0 w-full">
          {!abierto ? (
            <p className="text-sm text-muted-foreground">Elige un lead para atenderlo.</p>
          ) : (
            <DetalleLead
              lead={abierto}
              catalogos={catalogos}
              crm={crm}
              actuar={actuar}
            />
          )}
        </section>
      </div>

      {creando && (
        <NuevoLead
          crm={crm}
          catalogos={catalogos}
          alCerrar={() => setCreando(false)}
          alCrear={async (datos) => {
            const lead = await crearLead(datos);
            setCreando(false);
            setAbierto(lead);
            await cargar();
          }}
        />
      )}
    </div>
  );
};

const Dato = ({ etiqueta, valor }: { etiqueta: string; valor?: React.ReactNode }) =>
  valor ? (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{etiqueta}</span>
      <span className="text-sm break-words">{valor}</span>
    </div>
  ) : null;

const DetalleLead = ({
  lead,
  catalogos,
  crm,
  actuar,
}: {
  lead: Lead;
  catalogos: CatalogosLeads;
  crm: CatalogosCrm;
  actuar: (accion: () => Promise<Lead>) => Promise<void>;
}) => {
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState({ canal: "llamada", direccion: "saliente", resultado: "", texto: "" });
  const [conversion, setConversion] = useState({
    producto: lead.formulario_producto ?? "",
    monto: "",
    empresaNombre: lead.empresa_nombre ?? "",
  });
  const cerrado = lead.estado === "convertido";

  useEffect(() => {
    setDescartando(false);
    setMotivo("");
    setConversion({
      producto: lead.formulario_producto ?? "",
      monto: "",
      empresaNombre: lead.empresa_nombre ?? "",
    });
  }, [lead.id, lead.formulario_producto, lead.empresa_nombre]);

  const respuesta =
    lead.primera_respuesta_en &&
    Math.round(
      (new Date(lead.primera_respuesta_en).getTime() - new Date(lead.recibido_en).getTime()) / 60000,
    );
  const origen = [lead.origen_fuente, lead.origen_medio, lead.origen_campania].filter(Boolean).join(" / ");
  const yaExiste = lead.empresa_crm || lead.contacto_nombre || lead.padron_nombre;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{lead.nombre ?? lead.correo ?? lead.telefono}</h2>
          <p className="text-sm text-muted-foreground">
            Recibido {new Date(lead.recibido_en).toLocaleString("es-EC")}
            {lead.formulario_nombre && ` · ${lead.formulario_nombre}`}
            {respuesta != null && ` · atendido en ${respuesta} min`}
          </p>
        </div>
        <EstadoBadge estado={lead.estado} />
      </div>

      {yaExiste && (
        <Alert>
          {/* Todo en un párrafo: `AlertDescription` es una rejilla y pone cada
              trozo de texto y cada <strong> en su propia línea. */}
          <AlertDescription className="text-sm">
            <p>
            {lead.empresa_crm && (
              <>
                Ya está en el CRM como <strong>{lead.empresa_crm}</strong>
                {lead.contacto_nombre && ` (contacto ${lead.contacto_nombre} ${lead.contacto_apellido ?? ""})`}.{" "}
              </>
            )}
            {!lead.empresa_crm && lead.contacto_nombre && (
              <>Coincide con el contacto {lead.contacto_nombre} {lead.contacto_apellido ?? ""}. </>
            )}
            {lead.padron_nombre && (
              <>
                Su RUC es de <strong>{lead.padron_nombre}</strong>
                {lead.padron_provincia && ` (${lead.padron_provincia})`}
                {lead.padron_actividad && (
                  <span className="block text-xs text-muted-foreground line-clamp-2 mt-1">
                    {lead.padron_actividad}
                  </span>
                )}
              </>
            )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 border rounded p-3">
        <Dato etiqueta="Correo" valor={lead.correo && <a className="underline" href={`mailto:${lead.correo}`}>{lead.correo}</a>} />
        <Dato etiqueta="Teléfono" valor={lead.telefono && <a className="underline" href={`tel:${lead.telefono}`}>{lead.telefono}</a>} />
        <Dato etiqueta="Empresa" valor={lead.empresa_nombre} />
        <Dato etiqueta="RUC" valor={lead.ruc} />
        <Dato etiqueta="Origen" valor={origen || lead.origen_canal} />
        <Dato
          etiqueta="Página"
          valor={lead.pagina && <span className="text-xs">{lead.pagina}</span>}
        />
        <Dato etiqueta="Puntaje" valor={`${lead.puntaje} / 100`} />
        <Dato etiqueta="Envíos" valor={lead.envios > 1 ? `${lead.envios} (volvió a escribir)` : null} />
        <Dato etiqueta="Consentimiento" valor={lead.consentimiento ? "Otorgado" : "No otorgado"} />
        {Object.entries(lead.datos ?? {}).map(([k, v]) => (
          <Dato key={k} etiqueta={k} valor={v} />
        ))}
      </div>

      {lead.mensaje && (
        <div className="border rounded p-3 bg-muted/40">
          <p className="text-xs text-muted-foreground mb-1">Mensaje</p>
          <p className="text-sm whitespace-pre-wrap">{lead.mensaje}</p>
        </div>
      )}

      {lead.estado === "descartado" && lead.motivo_descarte && (
        <p className="text-sm text-muted-foreground">Descartado: {lead.motivo_descarte}</p>
      )}

      {cerrado ? (
        <div className="border rounded p-3 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
          Convertido en{" "}
          <Link className="underline font-medium" to={`/deals/${lead.oportunidad_id}/show`}>
            {lead.oportunidad_nombre ?? `la oportunidad ${lead.oportunidad_id}`}
          </Link>
          . Se sigue trabajando desde ahí.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border rounded p-3">
            <Label className="text-xs">Asignado a</Label>
            <select
              className="border rounded px-2 py-1 text-sm bg-background"
              value={lead.asignado_a ?? ""}
              onChange={(e) => actuar(() => asignarLead(lead.id, e.target.value || null))}
            >
              <option value="">Sin asignar</option>
              {crm.comerciales.map((c) => (
                <option key={c.usuario} value={c.usuario}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            {lead.estado === "descartado" ? (
              <Button size="sm" variant="outline" onClick={() => actuar(() => cambiarEstadoLead(lead.id, "nuevo"))}>
                Recuperar
              </Button>
            ) : (
              <>
                {lead.estado !== "contactado" && (
                  <Button size="sm" variant="outline" onClick={() => actuar(() => cambiarEstadoLead(lead.id, "contactado"))}>
                    Contactado
                  </Button>
                )}
                {lead.estado !== "calificado" && (
                  <Button size="sm" variant="outline" onClick={() => actuar(() => cambiarEstadoLead(lead.id, "calificado"))}>
                    Calificado
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDescartando((v) => !v)}>
                  Descartar
                </Button>
              </>
            )}
          </div>

          {descartando && (
            <div className="flex flex-wrap gap-2 items-center border rounded p-3">
              <Input
                className="flex-1 min-w-48"
                placeholder="Por qué: no contesta, no es cliente nuestro, spam…"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={!motivo.trim()}
                onClick={() => actuar(() => cambiarEstadoLead(lead.id, "descartado", motivo))}
              >
                Descartar
              </Button>
            </div>
          )}

          {lead.estado !== "descartado" && (
            <form
              className="flex flex-col gap-2 border rounded p-3"
              onSubmit={(e) => {
                e.preventDefault();
                actuar(() =>
                  convertirLead(lead.id, {
                    producto: conversion.producto,
                    monto: conversion.monto || undefined,
                    empresaNombre: conversion.empresaNombre || undefined,
                  }),
                );
              }}
            >
              <p className="text-sm font-medium">Convertir en oportunidad</p>
              <div className="flex flex-wrap gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm bg-background"
                  value={conversion.producto}
                  onChange={(e) => setConversion({ ...conversion, producto: e.target.value })}
                >
                  <option value="">¿Qué se le ofrece?</option>
                  {catalogos.productos.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <Input
                  className="w-32 h-8"
                  type="number"
                  min="0"
                  placeholder="Monto USD"
                  value={conversion.monto}
                  onChange={(e) => setConversion({ ...conversion, monto: e.target.value })}
                />
                {!lead.empresa_id && !lead.padron_nombre && (
                  <Input
                    className="w-56 h-8"
                    placeholder="Nombre de la empresa"
                    value={conversion.empresaNombre}
                    onChange={(e) => setConversion({ ...conversion, empresaNombre: e.target.value })}
                  />
                )}
                <Button size="sm" type="submit" disabled={!conversion.producto}>
                  Convertir
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {lead.empresa_crm
                  ? `Se abre sobre ${lead.empresa_crm}.`
                  : lead.padron_nombre
                    ? `Se abre sobre ${lead.padron_nombre}, con los datos del padrón.`
                    : "Se crea la empresa y el contacto con los datos del lead."}{" "}
                La venta queda atribuida a su origen.
              </p>
            </form>
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Historial</p>
        {!cerrado && (
          <form
            className="flex flex-wrap gap-2 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              actuar(() => anotarLead(lead.id, nota)).then(() =>
                setNota({ ...nota, resultado: "", texto: "" }),
              );
            }}
          >
            <select
              className="border rounded px-2 py-1 text-sm bg-background"
              value={nota.canal}
              onChange={(e) => setNota({ ...nota, canal: e.target.value })}
            >
              {crm.canales.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="border rounded px-2 py-1 text-sm bg-background"
              value={nota.direccion}
              onChange={(e) => setNota({ ...nota, direccion: e.target.value })}
            >
              <option value="saliente">saliente</option>
              <option value="entrante">entrante</option>
            </select>
            <Input
              className="w-40 h-8"
              placeholder="Resultado"
              value={nota.resultado}
              onChange={(e) => setNota({ ...nota, resultado: e.target.value })}
            />
            <Input
              className="flex-1 min-w-40 h-8"
              placeholder="Qué se habló"
              value={nota.texto}
              onChange={(e) => setNota({ ...nota, texto: e.target.value })}
            />
            <Button size="sm" type="submit" variant="outline">
              Anotar
            </Button>
          </form>
        )}
        <ul className="flex flex-col gap-1">
          {(lead.historial ?? []).map((h) => (
            <li key={h.id} className="text-sm border-l-2 pl-2">
              <span className="text-xs text-muted-foreground">
                {new Date(h.ocurrido_en).toLocaleString("es-EC")} · {h.canal}
                {h.canal !== "sistema" && ` ${h.direccion}`} · {h.autor}
              </span>
              <div>
                {h.resultado && !["cambio_lead", "lead_recibido", "volvio_a_escribir"].includes(h.resultado) && (
                  <strong>{h.resultado}: </strong>
                )}
                {h.resultado === "volvio_a_escribir" && <strong>Volvió a escribir: </strong>}
                {h.texto}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const NuevoLead = ({
  crm,
  catalogos,
  alCerrar,
  alCrear,
}: {
  crm: CatalogosCrm;
  catalogos: CatalogosLeads;
  alCerrar: () => void;
  alCrear: (datos: Record<string, unknown>) => Promise<void>;
}) => {
  const [datos, setDatos] = useState({
    nombre: "",
    correo: "",
    telefono: "",
    empresa: "",
    ruc: "",
    mensaje: "",
    canal: "evento",
    campania: "",
    marca: crm.marcas[0]?.codigo ?? "",
    asignado_a: "",
    consentimiento: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = (clave: keyof typeof datos) => ({
    value: datos[clave] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDatos({ ...datos, [clave]: e.target.value }),
  });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await alCrear({ ...datos, asignado_a: datos.asignado_a || undefined });
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
        <h2 className="font-semibold">Registrar lead</h2>
        <p className="text-xs text-muted-foreground">
          La tarjeta de una feria, un referido, una llamada. Si la persona ya está en la bandeja,
          se suma a su lead en vez de crear otro.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 col-span-2">
            <Label>Nombre</Label>
            <Input {...campo("nombre")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Correo</Label>
            <Input type="email" {...campo("correo")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Teléfono</Label>
            <Input {...campo("telefono")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Empresa</Label>
            <Input {...campo("empresa")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>RUC o cédula</Label>
            <Input {...campo("ruc")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Por dónde llegó</Label>
            <select
              className="border rounded px-2 py-1 text-sm bg-background h-9"
              value={datos.canal}
              onChange={(e) => setDatos({ ...datos, canal: e.target.value })}
            >
              {catalogos.canales
                .filter((c) => c !== "formulario")
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{datos.canal === "evento" ? "Evento" : "Campaña"}</Label>
            <Input placeholder={datos.canal === "evento" ? "Feria Quito 2026" : ""} {...campo("campania")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Marca</Label>
            <select
              className="border rounded px-2 py-1 text-sm bg-background h-9"
              value={datos.marca}
              onChange={(e) => setDatos({ ...datos, marca: e.target.value })}
            >
              {crm.marcas.map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Asignar a</Label>
            <select
              className="border rounded px-2 py-1 text-sm bg-background h-9"
              value={datos.asignado_a}
              onChange={(e) => setDatos({ ...datos, asignado_a: e.target.value })}
            >
              <option value="">Sin asignar</option>
              {crm.comerciales.map((c) => (
                <option key={c.usuario} value={c.usuario}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <Label>Notas</Label>
            <textarea
              className="border rounded px-2 py-1 text-sm bg-background min-h-20"
              value={datos.mensaje}
              onChange={(e) => setDatos({ ...datos, mensaje: e.target.value })}
            />
          </div>
          <label className="flex items-start gap-2 text-xs col-span-2">
            <input
              type="checkbox"
              checked={datos.consentimiento}
              onChange={(e) => setDatos({ ...datos, consentimiento: e.target.checked })}
            />
            {/* Sólo si la persona lo autorizó de verdad —firmó la tarjeta, lo
                dijo en la llamada—: marcarlo registra su correo como
                consentido para las campañas. */}
            Autorizó por escrito recibir comunicaciones comerciales
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando || (!datos.correo.trim() && !datos.telefono.trim())}>
            {guardando ? "Guardando…" : "Registrar"}
          </Button>
        </div>
      </form>
    </div>
  );
};

// ============================================================== formularios

const Formularios = ({ catalogos, crm }: { catalogos: CatalogosLeads; crm: CatalogosCrm }) => {
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [editando, setEditando] = useState<Partial<Formulario> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFormularios(await listarFormularios());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nuevo = () =>
    setEditando({
      slug: "",
      nombre: "",
      marca: crm.marcas[0]?.codigo ?? "",
      producto: null,
      titulo: "Hablemos",
      descripcion: "",
      campos: catalogos.campos,
      texto_consentimiento: catalogos.texto_consentimiento,
      mensaje_gracias: "",
      redirigir_a: "",
      reparto: [],
      activo: true,
    });

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={nuevo}>
          Nuevo formulario
        </Button>
      </div>

      {editando ? (
        <EditorFormulario
          inicial={editando}
          catalogos={catalogos}
          crm={crm}
          alCerrar={() => setEditando(null)}
          alGuardar={async (datos) => {
            const guardado = editando.id
              ? await editarFormulario(editando.id, datos)
              : await crearFormulario(datos);
            await cargar();
            setEditando(guardado);
          }}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {formularios.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay formularios. Crea uno para tu web, una landing o una feria.
            </p>
          )}
          {formularios.map((f) => (
            <button
              key={f.id}
              type="button"
              className="text-left border rounded-md p-3 hover:bg-muted"
              onClick={() => setEditando(f)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{f.nombre}</span>
                {!f.activo && <Badge variant="outline">inactivo</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                /{f.slug} · {f.marca_nombre}
                {f.producto_nombre && ` · ${f.producto_nombre}`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {f.vistas ?? 0} visitas · {f.leads ?? 0} leads
                {f.reparto.length > 0 ? ` · reparte entre ${f.reparto.join(", ")}` : " · sin reparto"}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const EditorFormulario = ({
  inicial,
  catalogos,
  crm,
  alCerrar,
  alGuardar,
}: {
  inicial: Partial<Formulario>;
  catalogos: CatalogosLeads;
  crm: CatalogosCrm;
  alCerrar: () => void;
  alGuardar: (datos: Partial<Formulario>) => Promise<void>;
}) => {
  const [f, setF] = useState<Partial<Formulario>>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const campos = f.campos ?? [];

  useEffect(() => setF(inicial), [inicial]);

  const cambiarCampo = (i: number, cambio: Partial<CampoFormulario>) =>
    setF({ ...f, campos: campos.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { id: _id, url: _url, leads: _l, vistas: _v, marca_nombre: _m, producto_nombre: _p, ...datos } = f;
      if (inicial.id) delete (datos as any).slug;
      await alGuardar(datos);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const input = "border rounded px-2 py-1 text-sm bg-background";

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <form className="flex-1 min-w-0 flex flex-col gap-3 border rounded p-3" onSubmit={guardar}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{inicial.id ? inicial.nombre : "Nuevo formulario"}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={alCerrar}>
            Volver
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label>Nombre interno</Label>
            <Input value={f.nombre ?? ""} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Dirección</Label>
            <Input
              value={f.slug ?? ""}
              disabled={!!inicial.id}
              placeholder="feria-quito-2026"
              onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })}
            />
            {inicial.id && (
              <p className="text-[11px] text-muted-foreground">
                No se cambia: ya puede estar publicada en una web o un QR.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label>Marca</Label>
            <select className={input} value={f.marca ?? ""} onChange={(e) => setF({ ...f, marca: e.target.value })}>
              {crm.marcas.map((m) => (
                <option key={m.codigo} value={m.codigo}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Producto que ofrece</Label>
            <select
              className={input}
              value={f.producto ?? ""}
              onChange={(e) => setF({ ...f, producto: e.target.value || null })}
            >
              <option value="">Varios / sin definir</option>
              {catalogos.productos.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>Título visible</Label>
            <Input value={f.titulo ?? ""} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>Descripción</Label>
            <Input value={f.descripcion ?? ""} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Campos</Label>
          <p className="text-[11px] text-muted-foreground">
            Las claves <code>nombre</code>, <code>correo</code>, <code>telefono</code>,{" "}
            <code>empresa</code>, <code>ruc</code> y <code>mensaje</code> van a su columna y se usan
            para detectar duplicados y reconocer clientes; el resto se guarda tal cual.
          </p>
          {campos.map((c, i) => (
            <div key={i} className="flex flex-wrap gap-1 items-center border rounded p-2">
              <Input
                className="w-28 h-8"
                value={c.clave}
                placeholder="clave"
                onChange={(e) => cambiarCampo(i, { clave: e.target.value })}
              />
              <Input
                className="flex-1 min-w-32 h-8"
                value={c.etiqueta}
                placeholder="Etiqueta"
                onChange={(e) => cambiarCampo(i, { etiqueta: e.target.value })}
              />
              <select
                className={input}
                value={c.tipo}
                onChange={(e) => cambiarCampo(i, { tipo: e.target.value as CampoFormulario["tipo"] })}
              >
                {catalogos.tiposCampo.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={!!c.obligatorio}
                  onChange={(e) => cambiarCampo(i, { obligatorio: e.target.checked })}
                />
                obligatorio
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={i === 0}
                onClick={() => {
                  const copia = [...campos];
                  [copia[i - 1], copia[i]] = [copia[i], copia[i - 1]];
                  setF({ ...f, campos: copia });
                }}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setF({ ...f, campos: campos.filter((_, j) => j !== i) })}
              >
                Quitar
              </Button>
              {c.tipo === "seleccion" && (
                <Input
                  className="w-full h-8"
                  placeholder="Opciones separadas por coma"
                  value={(c.opciones ?? []).join(", ")}
                  onChange={(e) => cambiarCampo(i, { opciones: e.target.value.split(",").map((o) => o.trim()) })}
                />
              )}
              <div className="w-full flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Mostrar sólo si
                <select
                  className={`${input} text-xs`}
                  value={c.mostrarSi?.campo ?? ""}
                  onChange={(e) =>
                    cambiarCampo(i, {
                      mostrarSi: e.target.value ? { campo: e.target.value, valor: c.mostrarSi?.valor ?? "" } : undefined,
                    })
                  }
                >
                  <option value="">(siempre)</option>
                  {campos
                    .filter((o) => o.clave && o.clave !== c.clave)
                    .map((o) => (
                      <option key={o.clave} value={o.clave}>
                        {o.etiqueta || o.clave}
                      </option>
                    ))}
                </select>
                {c.mostrarSi && (
                  <>
                    vale
                    <Input
                      className="w-40 h-7 text-xs"
                      value={c.mostrarSi.valor}
                      onChange={(e) => cambiarCampo(i, { mostrarSi: { ...c.mostrarSi!, valor: e.target.value } })}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() =>
              setF({ ...f, campos: [...campos, { clave: "", etiqueta: "", tipo: "texto" }] })
            }
          >
            Añadir campo
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Texto de consentimiento</Label>
          <textarea
            className={`${input} min-h-16`}
            value={f.texto_consentimiento ?? ""}
            onChange={(e) => setF({ ...f, texto_consentimiento: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            Se guarda el consentimiento del correo sólo si la persona marca la casilla.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label>Mensaje de gracias</Label>
            <Input
              value={f.mensaje_gracias ?? ""}
              onChange={(e) => setF({ ...f, mensaje_gracias: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>O llevar a esta página</Label>
            <Input
              value={f.redirigir_a ?? ""}
              placeholder="https://…/gracias"
              onChange={(e) => setF({ ...f, redirigir_a: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Repartir los leads entre</Label>
          <div className="flex flex-wrap gap-3">
            {crm.comerciales.map((c) => (
              <label key={c.usuario} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={(f.reparto ?? []).includes(c.usuario)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      reparto: e.target.checked
                        ? [...(f.reparto ?? []), c.usuario]
                        : (f.reparto ?? []).filter((u) => u !== c.usuario),
                    })
                  }
                />
                {c.nombre}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Por turnos: cada lead nuevo va a quien hace más tiempo que no recibe uno. Sin nadie
            marcado, quedan sin asignar en la bandeja.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.activo !== false} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
          Activo (recibe respuestas)
        </label>

        <div className="flex justify-end gap-2 items-center">
          {guardado && <span className="text-xs text-emerald-600">Guardado</span>}
          <Button type="submit">{inicial.id ? "Guardar" : "Crear"}</Button>
        </div>
      </form>

      {inicial.id && inicial.url && <Publicar formulario={inicial as Formulario} />}
    </div>
  );
};

/**
 * Cómo se pone el formulario en el mundo: el enlace directo, el código para
 * incrustarlo y la versión para un QR.
 *
 * El código para incrustar pasa a la `<iframe>` los `utm_*` de la página que
 * la contiene y su dirección: sin eso, todos los leads de una landing pagada
 * entrarían como tráfico directo y la campaña parecería no traer a nadie.
 */
const Publicar = ({ formulario }: { formulario: Formulario }) => {
  const [copiado, setCopiado] = useState<string | null>(null);
  const url = formulario.url!;
  const id = `friday-${formulario.slug}`;
  const codigo = useMemo(
    () =>
      `<iframe id="${id}" data-src="${url}" style="width:100%;border:0;min-height:520px" title="${formulario.titulo ?? formulario.nombre}"></iframe>
<script>(function(){var f=document.getElementById("${id}");var q=location.search.slice(1);f.src=f.dataset.src+"?"+(q?q+"&":"")+"pagina="+encodeURIComponent(location.href);addEventListener("message",function(e){if(e.data&&e.data.friday_formulario&&e.source===f.contentWindow){f.style.minHeight="0";f.style.height=e.data.alto+"px";}});})();</script>`,
    [id, url, formulario.titulo, formulario.nombre],
  );
  const qr = `${url}?utm_source=qr&utm_medium=impreso`;

  const copiar = (texto: string, que: string) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(que);
      setTimeout(() => setCopiado(null), 1500);
    });
  };

  return (
    <aside className="w-full lg:w-96 shrink-0 flex flex-col gap-3 border rounded p-3">
      <h3 className="font-medium text-sm">Publicar</h3>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Enlace directo</Label>
        <div className="flex gap-1">
          <Input readOnly value={url} className="h-8 text-xs" />
          <Button size="sm" variant="outline" onClick={() => copiar(url, "enlace")}>
            {copiado === "enlace" ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <a className="text-xs underline" href={url} target="_blank" rel="noreferrer">
          Abrir para probar
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Para incrustar en una web</Label>
        <textarea readOnly className="border rounded p-2 text-[11px] font-mono bg-muted/40 min-h-32" value={codigo} />
        <Button size="sm" variant="outline" className="self-start" onClick={() => copiar(codigo, "codigo")}>
          {copiado === "codigo" ? "Copiado" : "Copiar código"}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Para un código QR (impreso, feria)</Label>
        <div className="flex gap-1">
          <Input readOnly value={qr} className="h-8 text-xs" />
          <Button size="sm" variant="outline" onClick={() => copiar(qr, "qr")}>
            {copiado === "qr" ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Lleva <code>utm_source=qr</code>, para que lo que entre por el impreso se distinga de la web.
        </p>
      </div>
    </aside>
  );
};

// ================================================================== embudo

const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-EC")} %`);

const PanelEmbudo = ({ crm }: { crm: CatalogosCrm }) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [filtros, setFiltros] = useState({ desde: hace30, hasta: hoy, marca: "" });
  const [embudo, setEmbudo] = useState<Embudo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    embudoLeads(filtros)
      .then((e) => {
        setEmbudo(e);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [filtros]);

  const t = embudo?.total;
  const etapas = t
    ? [
        { etiqueta: "Visitas al formulario", valor: t.vistas },
        { etiqueta: "Leads recibidos", valor: t.recibidos },
        { etiqueta: "Atendidos", valor: t.atendidos },
        { etiqueta: "Calificados", valor: t.calificados },
        { etiqueta: "Convertidos", valor: t.convertidos },
      ]
    : [];
  const maximo = Math.max(1, ...etapas.map((e) => e.valor));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="w-40 h-8"
          value={filtros.desde}
          onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
        />
        <span className="text-sm text-muted-foreground">a</span>
        <Input
          type="date"
          className="w-40 h-8"
          value={filtros.hasta}
          onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
        />
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={filtros.marca}
          onChange={(e) => setFiltros({ ...filtros, marca: e.target.value })}
        >
          <option value="">Todas las marcas</option>
          {crm.marcas.map((m) => (
            <option key={m.codigo} value={m.codigo}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {t && (
        <div className="flex flex-col gap-1 max-w-2xl">
          {etapas.map((e) => (
            <div key={e.etiqueta} className="flex items-center gap-2 text-sm">
              <span className="w-44 shrink-0 text-muted-foreground">{e.etiqueta}</span>
              <div className="flex-1 h-6 bg-muted rounded">
                <div
                  className="h-6 rounded bg-primary/80"
                  style={{ width: `${Math.max(1, (e.valor / maximo) * 100)}%` }}
                />
              </div>
              <span className="w-14 text-right font-medium tabular-nums">
                {e.valor.toLocaleString("es-EC")}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground mt-1">
            Abandono del formulario {pct(t.tasas.abandono)} · conversión de lead a oportunidad{" "}
            {pct(t.tasas.conversion)} · {t.descartados} descartados. Las visitas sólo cuentan
            formularios publicados; los leads registrados a mano no tienen visita.
          </p>
        </div>
      )}

      {embudo && (
        <>
          <TablaEmbudo titulo="Por formulario" filas={embudo.porFormulario} conVistas />
          <TablaEmbudo titulo="Por fuente" filas={embudo.porFuente} />
        </>
      )}
    </div>
  );
};

const TablaEmbudo = ({
  titulo,
  filas,
  conVistas,
}: {
  titulo: string;
  filas: FilaEmbudo[];
  conVistas?: boolean;
}) => (
  <div className="flex flex-col gap-1">
    <h3 className="text-sm font-medium">{titulo}</h3>
    {filas.length === 0 ? (
      <p className="text-sm text-muted-foreground">Sin datos en el período.</p>
    ) : (
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2"></th>
              {conVistas && <th className="text-right p-2">Visitas</th>}
              {conVistas && <th className="text-right p-2">Abandono</th>}
              <th className="text-right p-2">Leads</th>
              <th className="text-right p-2">Atendidos</th>
              <th className="text-right p-2">Respuesta (mediana)</th>
              <th className="text-right p-2">Calificados</th>
              <th className="text-right p-2">Convertidos</th>
              <th className="text-right p-2">Conversión</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={String(f.clave)} className="border-t">
                <td className="p-2">{f.nombre ?? f.clave}</td>
                {conVistas && <td className="p-2 text-right tabular-nums">{f.vistas}</td>}
                {conVistas && <td className="p-2 text-right tabular-nums">{pct(f.tasas.abandono)}</td>}
                <td className="p-2 text-right tabular-nums">{f.recibidos}</td>
                <td className="p-2 text-right tabular-nums">{f.atendidos}</td>
                <td className="p-2 text-right tabular-nums">
                  {f.minutos_respuesta == null
                    ? "—"
                    : f.minutos_respuesta < 120
                      ? `${f.minutos_respuesta} min`
                      : `${Math.round(f.minutos_respuesta / 60)} h`}
                </td>
                <td className="p-2 text-right tabular-nums">{f.calificados}</td>
                <td className="p-2 text-right tabular-nums">{f.convertidos}</td>
                <td className="p-2 text-right tabular-nums">{pct(f.tasas.conversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
