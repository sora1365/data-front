import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MetasYComisiones } from "./MetasYComisiones";
import {
  dinero,
  periodosHabituales,
  resumenDeTableros,
  type FilaDeDesglose,
  type Resumen,
} from "../providers/friday/tableros";

/**
 * Los números del CRM.
 *
 * Contesta tres cosas y no veinte: por dónde se caen las ventas (el embudo),
 * qué se vendió y de dónde salió. Un tablero que lo enseña todo no se mira,
 * porque mirarlo entero cuesta más que abrir el tablero de tarjetas.
 *
 * Todo cuelga de un periodo, y el periodo se elige arriba: un número sin
 * periodo —«23 ganadas»— no significa nada, y es la forma más fácil de que
 * dos personas discutan con dos cifras distintas que las dos son ciertas.
 */
export const TablerosPage = () => {
  const periodos = useMemo(() => periodosHabituales(), []);
  const [periodo, setPeriodo] = useState(periodos[0]);
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await resumenDeTableros(periodo.desde, periodo.hasta));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tableros</h1>
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
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando && !datos ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
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
    </div>
  );
};

TablerosPage.path = "/tableros";

const Cifra = ({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) => (
  <div className="border rounded-lg p-3">
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    <p className="text-[11px] text-muted-foreground">{pie}</p>
  </div>
);

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
