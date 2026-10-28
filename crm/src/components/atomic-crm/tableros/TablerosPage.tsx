import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { catalogosCrm, type CatalogosCrm } from "../providers/friday/leads";
import { AlertasDelTablero } from "./AlertasDelTablero";
import { Cifra } from "./Cifra";
import { MetasYComisiones } from "./MetasYComisiones";
import { PipelineVista } from "./PipelineVista";
import { ProductividadVista } from "./ProductividadVista";
import { PronosticoVista } from "./PronosticoVista";
import { ReportesVista } from "./ReportesVista";
import { TendenciaVista } from "./TendenciaVista";
import {
  dinero,
  equipos as pedirEquipos,
  periodosHabituales,
  resumenDeTableros,
  type FiltrosDeTablero,
  type FilaDeDesglose,
  type MiembroDeEquipo,
  type Resumen,
} from "../providers/friday/tableros";

/**
 * Los números del CRM.
 *
 * El resumen contesta tres cosas y no veinte: por dónde se caen las ventas
 * (el embudo), qué se vendió y de dónde salió. Lo demás va en pestañas
 * aparte, cada una con una pregunta: qué viene, dónde se atasca, quién mueve
 * qué, cómo va respecto a antes, y lo que cada quien quiera armar.
 *
 * Los filtros van arriba y valen para todas las pestañas: mirar el
 * pronóstico de una marca con el embudo de todas es comparar dos cosas
 * distintas sin darse cuenta.
 */
export const TablerosPage = () => {
  const periodos = useMemo(() => periodosHabituales(), []);
  const [periodo, setPeriodo] = useState(periodos[0]);
  const [filtros, setFiltros] = useState<FiltrosDeTablero>({});
  const [catalogos, setCatalogos] = useState<CatalogosCrm | null>(null);
  const [miembros, setMiembros] = useState<MiembroDeEquipo[]>([]);
  const [pestana, setPestana] = useState("resumen");

  useEffect(() => {
    catalogosCrm().then(setCatalogos).catch(() => setCatalogos(null));
    pedirEquipos().then(setMiembros).catch(() => setMiembros([]));
  }, []);

  // Un equipo es alguien que supervisa a otros: quien no tiene a nadie
  // debajo no encabeza nada, y ofrecerlo sería un filtro idéntico al de
  // comercial.
  const supervisores = miembros.filter((m) => miembros.some((x) => x.supervisor === m.usuario));

  const conPeriodo = ["resumen", "productividad"].includes(pestana);

  return (
    <div className="flex flex-col gap-4 p-1 tableros">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tableros</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Selector
            etiqueta="Marca"
            valor={filtros.marca}
            opciones={(catalogos?.marcas ?? []).map((m) => [m.codigo, m.nombre])}
            alCambiar={(marca) => setFiltros((f) => ({ ...f, marca }))}
          />
          <Selector
            etiqueta="Comercial"
            valor={filtros.comercial}
            opciones={(catalogos?.comerciales ?? []).map((c) => [c.usuario, c.nombre || c.usuario])}
            alCambiar={(comercial) => setFiltros((f) => ({ ...f, comercial }))}
          />
          {supervisores.length > 0 && (
            <Selector
              etiqueta="Equipo"
              valor={filtros.equipo}
              opciones={supervisores.map((s) => [s.usuario, `Equipo de ${s.nombre}`])}
              alCambiar={(equipo) => setFiltros((f) => ({ ...f, equipo }))}
            />
          )}
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            PDF
          </Button>
        </div>
      </header>

      <Tabs value={pestana} onValueChange={setPestana}>
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="pronostico">Pronóstico</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="productividad">Productividad</TabsTrigger>
            <TabsTrigger value="tendencia">Tendencia</TabsTrigger>
            <TabsTrigger value="reportes">Reportes</TabsTrigger>
          </TabsList>
          {conPeriodo && (
            <div className="flex flex-wrap items-center gap-2">
              {periodos.map((p) => (
                <Button
                  key={p.codigo}
                  size="sm"
                  variant={p.codigo === periodo.codigo ? "default" : "outline"}
                  onClick={() => setPeriodo(p)}
                >
                  {p.nombre}
                </Button>
              ))}
            </div>
          )}
        </div>

        <TabsContent value="resumen" className="flex flex-col gap-4 mt-3">
          <AlertasDelTablero filtros={filtros} />
          <ResumenDelPeriodo periodo={periodo} filtros={filtros} />
        </TabsContent>
        <TabsContent value="pronostico" className="mt-3">
          <PronosticoVista filtros={filtros} />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-3">
          <PipelineVista filtros={filtros} />
        </TabsContent>
        <TabsContent value="productividad" className="mt-3">
          <ProductividadVista periodo={periodo} filtros={filtros} alCambiarEquipos={setMiembros} />
        </TabsContent>
        <TabsContent value="tendencia" className="mt-3">
          <TendenciaVista filtros={filtros} />
        </TabsContent>
        <TabsContent value="reportes" className="mt-3">
          <ReportesVista filtros={filtros} catalogos={catalogos} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

TablerosPage.path = "/tableros";

const Selector = ({
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  etiqueta: string;
  valor: string | undefined;
  opciones: [string, string][];
  alCambiar: (valor: string | undefined) => void;
}) => (
  <select
    className="h-8 rounded-md border bg-background px-2 text-sm"
    aria-label={etiqueta}
    value={valor ?? ""}
    onChange={(e) => alCambiar(e.target.value || undefined)}
  >
    <option value="">{etiqueta}: todas</option>
    {opciones.map(([codigo, nombre]) => (
      <option key={codigo} value={codigo}>
        {nombre}
      </option>
    ))}
  </select>
);

const ResumenDelPeriodo = ({
  periodo,
  filtros,
}: {
  periodo: { desde: string; hasta: string };
  filtros: FiltrosDeTablero;
}) => {
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await resumenDeTableros(periodo.desde, periodo.hasta, filtros));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [periodo, filtros]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando && !datos ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            <Cifra titulo="Abiertas" valor={String(datos.abiertas)} pie="en el periodo" />
            <Cifra titulo="Ganadas" valor={String(datos.ganadas)} pie="cerradas con venta" />
            <Cifra titulo="Perdidas" valor={String(datos.perdidas)} pie="cerradas sin venta" />
            <Cifra
              titulo="Tasa de cierre"
              valor={datos.tasaDeCierre === null ? "—" : `${datos.tasaDeCierre}%`}
              // Se dice el denominador en la propia tarjeta: sin eso, cada
              // quien supone el suyo y el mismo número significa dos cosas.
              pie="de lo cerrado"
            />
            <Cifra
              titulo="Vendido"
              valor={dinero(datos.vendido)}
              pie={
                datos.diasHastaGanar === null
                  ? "ventas del periodo"
                  : `${datos.diasHastaGanar} días de media hasta ganar`
              }
            />
            <Cifra
              titulo="Ticket promedio"
              valor={datos.ticketPromedio === null ? "—" : dinero(datos.ticketPromedio)}
              pie={`${datos.ventas} venta${datos.ventas === 1 ? "" : "s"}`}
            />
          </div>

          <Embudo tramos={datos.embudo} />

          <MetasYComisiones />

          <div className="grid gap-4 lg:grid-cols-2">
            <Desglose titulo="Por producto" filas={datos.porProducto} />
            <Desglose titulo="Por marca" filas={datos.porMarca} />
            <Desglose titulo="Por origen" filas={datos.porOrigen} />
            <Desglose titulo="Por comercial" filas={datos.porComercial} />
          </div>

          <p className="text-xs text-muted-foreground">
            Las oportunidades archivadas no cuentan. El embudo mide las abiertas
            en el periodo a lo largo de toda su vida, no los movimientos del
            periodo.
          </p>
        </>
      ) : null}
    </>
  );
};

/**
 * El embudo, como barras que se acortan.
 *
 * El ancho es proporcional al primer tramo y no al mayor de todos: así se ve
 * la caída. Normalizando contra el máximo, el primer escalón siempre ocuparía
 * el ancho completo y un embudo que pierde el 90 % se vería igual que uno que
 * no pierde a nadie.
 */
const Embudo = ({ tramos }: { tramos: { codigo: string; nombre: string; llegaron: number; conversion: number | null; atascadas: number }[] }) => {
  const entraron = tramos[0]?.llegaron ?? 0;

  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-2">Embudo</p>
      {entraron === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nada abierto en este periodo.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tramos.map((t) => (
            <div key={t.codigo} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm truncate">{t.nombre}</span>
              <div className="flex-1 bg-muted rounded h-6 relative overflow-hidden">
                <div
                  className="bg-primary/70 h-full"
                  style={{ width: `${(t.llegaron / entraron) * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-xs">
                  {t.llegaron}
                  {t.conversion !== null ? ` · ${t.conversion}% del anterior` : ""}
                </span>
              </div>
              <span className="w-28 shrink-0 text-xs text-muted-foreground text-right">
                {t.atascadas > 0 ? `${t.atascadas} aquí paradas` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Desglose = ({ titulo, filas }: { titulo: string; filas: FilaDeDesglose[] }) => (
  <div className="border rounded-lg p-3">
    <p className="text-xs text-muted-foreground mb-2">{titulo}</p>
    {filas.length === 0 ? (
      <p className="text-sm text-muted-foreground">Nada que mostrar.</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">&nbsp;</th>
            <th className="font-normal pb-1 text-right">Abiertas</th>
            <th className="font-normal pb-1 text-right">Ganadas</th>
            <th className="font-normal pb-1 text-right">Vendido</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.etiqueta} className="border-t">
              <td className="py-1 pr-2 truncate max-w-0 w-full" title={f.etiqueta}>
                {f.etiqueta}
              </td>
              <td className="py-1 text-right tabular-nums">{f.cuenta}</td>
              <td className="py-1 text-right tabular-nums">{f.ganadas}</td>
              <td className="py-1 text-right tabular-nums">{dinero(f.monto)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);
