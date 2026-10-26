import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { catalogosCrm, catalogosLeads, type CatalogosCrm, type CatalogosLeads } from "../providers/friday/leads";
import {
  anotarGasto,
  borrarGasto,
  crearPauta,
  editarPauta,
  formulariosPublicados,
  listarPautas,
  obtenerPauta,
  sinPauta,
  subirInforme,
  type CifrasPauta,
  type EstadoRitmo,
  type Pauta,
  type ResultadoInforme,
} from "../providers/friday/pauta";

/**
 * Pauta: cuánto se invierte en cada campaña y qué vuelve.
 *
 * Los leads ya llegan etiquetados con su `utm_campaign` y las ventas quedan
 * atribuidas al lead. Aquí se pone el otro lado: el presupuesto y el gasto
 * real que exporta cada plataforma. Con eso salen el costo por lead, el
 * costo de adquirir un cliente y el retorno.
 */
export const PautaPage = () => {
  const [datos, setDatos] = useState<{ pautas: Pauta[]; total: CifrasPauta; hoy: string } | null>(null);
  const [sueltas, setSueltas] = useState<Awaited<ReturnType<typeof sinPauta>>>([]);
  const [abierta, setAbierta] = useState<Pauta | null>(null);
  const [editando, setEditando] = useState<Partial<Pauta> | null>(null);
  const [catalogos, setCatalogos] = useState<{ crm: CatalogosCrm; leads: CatalogosLeads } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [lista, sin] = await Promise.all([listarPautas(), sinPauta()]);
      setDatos(lista);
      setSueltas(sin);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
    Promise.all([catalogosCrm(), catalogosLeads()])
      .then(([crm, leads]) => setCatalogos({ crm, leads }))
      .catch((e) => setError(e.message));
  }, [cargar]);

  const abrir = async (id: string) => {
    try {
      setAbierta(await obtenerPauta(id));
      setEditando(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const actualizada = async (p: Pauta) => {
    setAbierta(p);
    await cargar();
  };

  const nueva = (base: Partial<Pauta> = {}) => {
    const hoy = datos?.hoy ?? new Date().toISOString().slice(0, 10);
    const fin = new Date(Date.parse(`${hoy}T00:00:00Z`) + 29 * 86400_000).toISOString().slice(0, 10);
    setAbierta(null);
    setEditando({
      nombre: "",
      marca: catalogos?.crm.marcas[0]?.codigo ?? "",
      plataforma: "meta",
      producto: null,
      utm_campaign: "",
      utm_source: "",
      presupuesto: 0,
      desde: hoy,
      hasta: fin,
      activa: true,
      ...base,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Pauta</h1>
        <Button size="sm" onClick={() => nueva()} disabled={!catalogos}>
          Nueva campaña
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {datos && <Resumen total={datos.total} />}

      {sueltas.length > 0 && (
        <Alert>
          <AlertDescription className="text-sm">
            <p>
              <strong>Hay leads de campañas que no están dadas de alta.</strong> Su gasto no cuenta en
              ningún sitio, y el retorno total sale mejor de lo que es.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {sueltas.map((s) => (
                <Button
                  key={s.utm_campaign}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    nueva({
                      nombre: s.utm_campaign,
                      utm_campaign: s.utm_campaign,
                      utm_source: s.utm_source,
                      plataforma: plataformaDeFuente(s.utm_source),
                    })
                  }
                >
                  {s.utm_campaign} · {s.leads} leads · dar de alta
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {editando && catalogos ? (
        <EditorPauta
          inicial={editando}
          catalogos={catalogos}
          alCerrar={() => setEditando(null)}
          alGuardar={async (d) => {
            const p = editando.id ? await editarPauta(editando.id, d) : await crearPauta(d);
            setEditando(null);
            await actualizada(p);
          }}
        />
      ) : abierta ? (
        <Detalle
          pauta={abierta}
          alCerrar={() => setAbierta(null)}
          alEditar={() => setEditando(abierta)}
          alCambiar={actualizada}
        />
      ) : (
        <TablaPautas pautas={datos?.pautas ?? []} alAbrir={abrir} />
      )}
    </div>
  );
};

PautaPage.path = "/pauta";

/** La plataforma más probable para una fuente de los utm. */
const plataformaDeFuente = (fuente: string | null): Pauta["plataforma"] => {
  const f = (fuente ?? "").toLowerCase();
  if (/(facebook|instagram|meta|fb|ig)/.test(f)) return "meta";
  if (/(google|youtube|adwords)/.test(f)) return "google";
  if (/tiktok/.test(f)) return "tiktok";
  if (/linkedin/.test(f)) return "linkedin";
  return "otra";
};

// ================================================================ formato

const usd = (n: number | null | undefined, decimales = 2) =>
  n == null
    ? "—"
    : n.toLocaleString("es-EC", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
      });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("es-EC")} %`);
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-EC"));
const veces = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("es-EC")}×`);

const PLATAFORMA: Record<Pauta["plataforma"], string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  otra: "Otra",
};

const RITMO: Record<EstadoRitmo, { texto: string; clase: string }> = {
  sin_empezar: { texto: "Sin empezar", clase: "bg-muted text-muted-foreground" },
  bajo: { texto: "Gasta por debajo", clase: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  en_linea: {
    texto: "En línea",
    clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  sobre: { texto: "Gasta por encima", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  terminada: { texto: "Terminada", clase: "bg-muted text-muted-foreground" },
  excedida: { texto: "Presupuesto excedido", clase: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

const Ritmo = ({ estado }: { estado: EstadoRitmo }) => (
  <Badge variant="outline" className={`text-[10px] border-0 shrink-0 ${RITMO[estado].clase}`}>
    {RITMO[estado].texto}
  </Badge>
);

/** El ROI en color: verde si devuelve más de lo que costó, rojo si no. */
const Roi = ({ valor }: { valor: number | null }) => (
  <span
    className={
      valor == null ? "" : valor >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
    }
  >
    {pct(valor)}
  </span>
);

const Cifra = ({ etiqueta, valor, nota }: { etiqueta: string; valor: React.ReactNode; nota?: string }) => (
  <div className="border rounded px-3 py-2 min-w-32">
    <div className="text-xs text-muted-foreground">{etiqueta}</div>
    <div className="text-lg font-semibold tabular-nums">{valor}</div>
    {nota && <div className="text-[11px] text-muted-foreground">{nota}</div>}
  </div>
);

// ================================================================ resumen

const Resumen = ({ total }: { total: CifrasPauta }) => {
  const i = total.indicadores;
  return (
    <div className="flex flex-wrap gap-2">
      <Cifra etiqueta="Gastado" valor={usd(total.gasto)} nota={`de ${usd(total.presupuesto, 0)} presupuestados`} />
      <Cifra etiqueta="Leads" valor={num(total.leads)} nota={`CPL ${usd(i.cpl)}`} />
      <Cifra etiqueta="Clientes" valor={num(total.clientes)} nota={`CAC ${usd(i.cac)}`} />
      <Cifra etiqueta="Vendido" valor={usd(total.ingresos, 0)} nota={`cobrado ${usd(total.cobrado, 0)}`} />
      <Cifra etiqueta="ROAS" valor={veces(i.roas)} nota="vendido por dólar pautado" />
      <Cifra etiqueta="ROI" valor={<Roi valor={i.roi} />} nota={`sobre lo cobrado ${pct(i.roiCobrado)}`} />
    </div>
  );
};

// ================================================================== tabla

const TablaPautas = ({ pautas, alAbrir }: { pautas: Pauta[]; alAbrir: (id: string) => void }) =>
  pautas.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      Todavía no hay campañas. Da de alta una con la misma <code>utm_campaign</code> que llevan sus
      enlaces y sus leads se le atribuyen solos.
    </p>
  ) : (
    <div className="border rounded overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2">Campaña</th>
            <th className="text-right p-2">Presupuesto</th>
            <th className="text-right p-2">Gastado</th>
            <th className="text-left p-2">Ritmo</th>
            <th className="text-right p-2">Leads</th>
            <th className="text-right p-2">CPL</th>
            <th className="text-right p-2">Clientes</th>
            <th className="text-right p-2">CAC</th>
            <th className="text-right p-2">Vendido</th>
            <th className="text-right p-2">ROAS</th>
            <th className="text-right p-2">ROI</th>
          </tr>
        </thead>
        <tbody>
          {pautas.map((p) => (
            <tr
              key={p.id}
              className={`border-t cursor-pointer hover:bg-muted/60 ${p.activa ? "" : "opacity-60"}`}
              onClick={() => alAbrir(p.id)}
            >
              <td className="p-2">
                <div className="font-medium text-sm">{p.nombre}</div>
                <div className="text-muted-foreground">
                  {PLATAFORMA[p.plataforma]} · <code>{p.utm_campaign}</code> · {p.desde} a {p.hasta}
                </div>
              </td>
              <td className="p-2 text-right tabular-nums">{usd(p.presupuesto, 0)}</td>
              <td className="p-2 text-right tabular-nums">
                {usd(p.gasto)}
                <div className="text-muted-foreground">{pct(p.ritmo.ejecucion)}</div>
              </td>
              <td className="p-2">
                <Ritmo estado={p.ritmo.estado} />
              </td>
              <td className="p-2 text-right tabular-nums">{num(p.leads)}</td>
              <td className="p-2 text-right tabular-nums">{usd(p.indicadores.cpl)}</td>
              <td className="p-2 text-right tabular-nums">{num(p.clientes)}</td>
              <td className="p-2 text-right tabular-nums">{usd(p.indicadores.cac)}</td>
              <td className="p-2 text-right tabular-nums">{usd(p.ingresos, 0)}</td>
              <td className="p-2 text-right tabular-nums">{veces(p.indicadores.roas)}</td>
              <td className="p-2 text-right tabular-nums">
                <Roi valor={p.indicadores.roi} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

// ================================================================= detalle

const Detalle = ({
  pauta,
  alCerrar,
  alEditar,
  alCambiar,
}: {
  pauta: Pauta;
  alCerrar: () => void;
  alEditar: () => void;
  alCambiar: (p: Pauta) => Promise<void>;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<ResultadoInforme | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [dia, setDia] = useState({ dia: "", gasto: "", impresiones: "", clics: "" });
  const archivo = useRef<HTMLInputElement>(null);
  const i = pauta.indicadores;
  const r = pauta.ritmo;

  useEffect(() => {
    setInforme(null);
    setError(null);
  }, [pauta.id]);

  const actuar = async (accion: () => Promise<Pauta>) => {
    try {
      await alCambiar(await accion());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const subir = async (f: File) => {
    setSubiendo(true);
    try {
      const res = await subirInforme(pauta.id, f);
      setInforme(res);
      await alCambiar(res.pauta);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = "";
    }
  };

  // Gasto y leads del mismo día en una sola tabla: es como se ve si un día
  // caro trajo o no trajo gente.
  const dias = useMemo(() => {
    const m = new Map<string, { dia: string; gasto?: number; clics?: number | null; origen?: string; leads?: number }>();
    for (const g of pauta.gasto_diario ?? []) m.set(g.dia, { ...m.get(g.dia), dia: g.dia, gasto: g.gasto, clics: g.clics, origen: g.origen });
    for (const l of pauta.leads_diarios ?? []) m.set(l.dia, { ...m.get(l.dia), dia: l.dia, leads: l.leads });
    return [...m.values()].sort((a, b) => b.dia.localeCompare(a.dia));
  }, [pauta.gasto_diario, pauta.leads_diarios]);

  const barra = (valor: number) => `${Math.min(100, pauta.presupuesto > 0 ? (valor / pauta.presupuesto) * 100 : 0)}%`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{pauta.nombre}</h2>
          <p className="text-sm text-muted-foreground">
            {PLATAFORMA[pauta.plataforma]} · {pauta.marca_nombre}
            {pauta.producto_nombre && ` · ${pauta.producto_nombre}`} · {pauta.desde} a {pauta.hasta} ·{" "}
            <code>utm_campaign={pauta.utm_campaign}</code>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={alEditar}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" onClick={alCerrar}>
            Volver
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="border rounded p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Gastado <strong>{usd(pauta.gasto)}</strong> de {usd(pauta.presupuesto)} ({pct(r.ejecucion)}) · día{" "}
            {r.transcurridos} de {r.total}
          </span>
          <Ritmo estado={r.estado} />
        </div>
        {/* La marca es lo que debería llevarse gastado repartiendo parejo el
            presupuesto: la barra a su izquierda es gastar por debajo. */}
        <div className="relative h-3 bg-muted rounded">
          <div className="absolute inset-y-0 left-0 rounded bg-primary/80" style={{ width: barra(pauta.gasto) }} />
          {r.esperado > 0 && (
            <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground" style={{ left: barra(r.esperado) }} title="Lo esperado a hoy" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A hoy se esperaban {usd(r.esperado)}.{" "}
          {r.proyeccion != null && `Al ritmo actual cerrará en ${usd(r.proyeccion)}.`}
          {pauta.ultimo_dia_cargado && ` Último día con gasto cargado: ${pauta.ultimo_dia_cargado}.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Cifra etiqueta="Impresiones" valor={num(pauta.impresiones)} nota={`CTR ${pct(i.ctr)}`} />
        <Cifra etiqueta="Clics" valor={num(pauta.clics)} nota={`CPC ${usd(i.cpc)}`} />
        <Cifra etiqueta="Leads" valor={num(pauta.leads)} nota={`CPL ${usd(i.cpl)}`} />
        <Cifra etiqueta="Oportunidades" valor={num(pauta.oportunidades)} />
        <Cifra
          etiqueta="Clientes"
          valor={num(pauta.clientes)}
          nota={`CAC ${usd(i.cac)} · ${pct(i.conversionLead)} de los leads`}
        />
        <Cifra etiqueta="Vendido" valor={usd(pauta.ingresos, 0)} nota={`cobrado ${usd(pauta.cobrado, 0)}`} />
        <Cifra etiqueta="ROAS" valor={veces(i.roas)} />
        <Cifra etiqueta="ROI" valor={<Roi valor={i.roi} />} nota={`sobre lo cobrado ${pct(i.roiCobrado)}`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-3 border rounded p-3">
          <p className="text-sm font-medium">Cargar gasto</p>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Informe de la plataforma (CSV)</Label>
            <input
              ref={archivo}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              disabled={subiendo}
              className="text-sm"
              onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
            />
            <p className="text-[11px] text-muted-foreground">
              Exporta desde Meta, Google o TikTok el informe de esta campaña desglosado por día. Los
              días que trae reemplazan a los cargados, así que subirlo otra vez no duplica nada.
            </p>
          </div>

          {informe && (
            <Alert variant={informe.avisos.length || informe.fuera.length ? "default" : undefined}>
              <AlertDescription className="text-xs">
                <p>
                  Se cargaron <strong>{informe.cargados}</strong> días, {usd(informe.gasto)} en total.
                </p>
                {informe.fuera.length > 0 && (
                  <p>
                    {informe.fuera.length} días quedaron fuera del período de la campaña y no se
                    guardaron ({informe.fuera.slice(0, 5).join(", ")}
                    {informe.fuera.length > 5 ? "…" : ""}).
                  </p>
                )}
                {informe.avisos.map((a) => (
                  <p key={a}>{a}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              actuar(() => anotarGasto(pauta.id, dia)).then(() =>
                setDia({ dia: "", gasto: "", impresiones: "", clics: "" }),
              );
            }}
          >
            <div className="flex flex-col gap-1">
              <Label className="text-xs">O un día a mano</Label>
              <Input
                type="date"
                className="h-8 w-40"
                min={pauta.desde}
                max={pauta.hasta}
                value={dia.dia}
                onChange={(e) => setDia({ ...dia, dia: e.target.value })}
              />
            </div>
            <Input className="h-8 w-24" type="number" min="0" step="0.01" placeholder="Gasto" value={dia.gasto} onChange={(e) => setDia({ ...dia, gasto: e.target.value })} />
            <Input className="h-8 w-28" type="number" min="0" placeholder="Impresiones" value={dia.impresiones} onChange={(e) => setDia({ ...dia, impresiones: e.target.value })} />
            <Input className="h-8 w-20" type="number" min="0" placeholder="Clics" value={dia.clics} onChange={(e) => setDia({ ...dia, clics: e.target.value })} />
            <Button size="sm" type="submit" variant="outline" disabled={!dia.dia || dia.gasto === ""}>
              Anotar
            </Button>
          </form>
        </div>

        <EnlaceEtiquetado pauta={pauta} />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Día a día</p>
        {dias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin gasto ni leads todavía.</p>
        ) : (
          <div className="border rounded overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2">Día</th>
                  <th className="text-right p-2">Gasto</th>
                  <th className="text-right p-2">Clics</th>
                  <th className="text-right p-2">Leads</th>
                  <th className="text-right p-2">CPL del día</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {dias.map((d) => (
                  <tr key={d.dia} className="border-t">
                    <td className="p-2">{d.dia}</td>
                    <td className="p-2 text-right tabular-nums">
                      {d.gasto == null ? "—" : usd(d.gasto)}
                      {d.origen === "manual" && <span className="text-muted-foreground"> (a mano)</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{num(d.clics)}</td>
                    <td className="p-2 text-right tabular-nums">{num(d.leads ?? 0)}</td>
                    <td className="p-2 text-right tabular-nums">
                      {d.gasto != null && d.leads ? usd(d.gasto / d.leads) : "—"}
                    </td>
                    <td className="p-2 text-right">
                      {d.gasto != null && (
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => actuar(() => borrarGasto(pauta.id, d.dia))}>
                          Quitar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * El enlace que hay que poner en el anuncio.
 *
 * Toda la atribución depende de que el enlace lleve la `utm_campaign` exacta
 * de la campaña. Armarlo aquí, a partir de un formulario de captación, evita
 * el error más común: escribirla a mano en el administrador de anuncios con
 * otra grafía y que los leads entren «sin campaña».
 */
const EnlaceEtiquetado = ({ pauta }: { pauta: Pauta }) => {
  const [formularios, setFormularios] = useState<{ id: string; nombre: string; url: string }[]>([]);
  const [elegido, setElegido] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    formulariosPublicados().then((f) => {
      setFormularios(f);
      setElegido((actual) => actual || f[0]?.url || "");
    });
  }, []);

  const enlace = useMemo(() => {
    if (!elegido) return "";
    const u = new URL(elegido);
    u.searchParams.set("utm_source", pauta.utm_source || pauta.plataforma);
    u.searchParams.set("utm_medium", "cpc");
    u.searchParams.set("utm_campaign", pauta.utm_campaign);
    return u.toString();
  }, [elegido, pauta.utm_source, pauta.plataforma, pauta.utm_campaign]);

  return (
    <div className="flex flex-col gap-2 border rounded p-3">
      <p className="text-sm font-medium">Enlace para el anuncio</p>
      {formularios.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay formularios de captación activos. Crea uno en Leads → Formularios, o añade a tu
          propia página <code>?utm_campaign={pauta.utm_campaign}</code>.
        </p>
      ) : (
        <>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
          >
            {formularios.map((f) => (
              <option key={f.id} value={f.url}>
                {f.nombre}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <Input readOnly value={enlace} className="h-8 text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator.clipboard?.writeText(enlace).then(() => {
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 1500);
                })
              }
            >
              {copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Si el anuncio lleva a tu propia web, añade esos mismos parámetros a su dirección: el
            código del formulario los pasa al lead.
          </p>
        </>
      )}
    </div>
  );
};

// ================================================================== editor

const EditorPauta = ({
  inicial,
  catalogos,
  alCerrar,
  alGuardar,
}: {
  inicial: Partial<Pauta>;
  catalogos: { crm: CatalogosCrm; leads: CatalogosLeads };
  alCerrar: () => void;
  alGuardar: (d: Record<string, unknown>) => Promise<void>;
}) => {
  const [p, setP] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const input = "border rounded px-2 py-1 text-sm bg-background h-9";

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await alGuardar({
        nombre: p.nombre,
        marca: p.marca,
        plataforma: p.plataforma,
        producto: p.producto || null,
        utm_campaign: p.utm_campaign,
        utm_source: p.utm_source || null,
        presupuesto: Number(p.presupuesto),
        desde: p.desde,
        hasta: p.hasta,
        activa: p.activa !== false,
        nota: p.nota || null,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className="border rounded p-3 flex flex-col gap-3 max-w-2xl" onSubmit={guardar}>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{inicial.id ? `Editar ${inicial.nombre}` : "Nueva campaña"}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={alCerrar}>
          Cancelar
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label>Nombre</Label>
          <Input value={p.nombre ?? ""} onChange={(e) => setP({ ...p, nombre: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Plataforma</Label>
          <select className={input} value={p.plataforma} onChange={(e) => setP({ ...p, plataforma: e.target.value as Pauta["plataforma"] })}>
            {Object.entries(PLATAFORMA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Marca</Label>
          <select className={input} value={p.marca ?? ""} onChange={(e) => setP({ ...p, marca: e.target.value })}>
            {catalogos.crm.marcas.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>utm_campaign</Label>
          <Input
            value={p.utm_campaign ?? ""}
            placeholder="auditoria-octubre"
            onChange={(e) => setP({ ...p, utm_campaign: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            La etiqueta que llevan los enlaces del anuncio. Sus leads se le atribuyen por ella.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label>utm_source (opcional)</Label>
          <Input value={p.utm_source ?? ""} placeholder="facebook" onChange={(e) => setP({ ...p, utm_source: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Presupuesto (USD)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={p.presupuesto ?? ""}
            onChange={(e) => setP({ ...p, presupuesto: e.target.value as unknown as number })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Producto que promociona</Label>
          <select className={input} value={p.producto ?? ""} onChange={(e) => setP({ ...p, producto: e.target.value || null })}>
            <option value="">Varios / marca</option>
            {catalogos.leads.productos.map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Desde</Label>
          <Input type="date" value={p.desde ?? ""} onChange={(e) => setP({ ...p, desde: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Hasta</Label>
          <Input type="date" value={p.hasta ?? ""} onChange={(e) => setP({ ...p, hasta: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label>Nota</Label>
          <Input value={p.nota ?? ""} onChange={(e) => setP({ ...p, nota: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.activa !== false} onChange={(e) => setP({ ...p, activa: e.target.checked })} />
          Activa
        </label>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={guardando || !p.nombre?.trim() || !p.utm_campaign?.trim()}>
          {guardando ? "Guardando…" : inicial.id ? "Guardar" : "Crear"}
        </Button>
      </div>
    </form>
  );
};
