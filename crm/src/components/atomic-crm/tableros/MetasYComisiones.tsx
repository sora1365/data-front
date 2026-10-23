import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dinero,
  MESES,
  metasDelMes,
  ponerMeta,
  ponerRegla,
  reglasDeComision,
  type FilaDeMetas,
  type ReglaDeComision,
} from "../providers/friday/tableros";

/**
 * Metas del mes, cumplimiento y comisión.
 *
 * La comisión se calcula **sobre lo cobrado**, no sobre lo ganado: pagar por
 * una venta que todavía no entró es adelantar dinero contra una factura que
 * puede no cobrarse. Lo ganado y pendiente se enseña al lado como comisión en
 * camino, que es lo que el comercial quiere ver y lo que evita que la cifra
 * de arriba parezca un error el mes que se vendió mucho y se cobró tarde.
 */
export const MetasYComisiones = () => {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [filas, setFilas] = useState<FilaDeMetas[]>([]);
  const [reglas, setReglas] = useState<ReglaDeComision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [monto, setMonto] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([metasDelMes(anio, mes), reglasDeComision()]);
      setFilas(f);
      setReglas(r);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [anio, mes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async (comercial: string) => {
    try {
      await ponerMeta({ comercial, anio, mes, monto: Number(monto) });
      setEditando(null);
      setMonto("");
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const mover = (paso: number) => {
    const fecha = new Date(anio, mes - 1 + paso, 1);
    setAnio(fecha.getFullYear());
    setMes(fecha.getMonth() + 1);
  };

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Metas y comisiones · {MESES[mes - 1]} {anio}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => mover(-1)}>
            ←
          </Button>
          <Button size="sm" variant="outline" onClick={() => mover(1)}>
            →
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {reglas.length === 0 ? (
        <SinReglas alCrear={cargar} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {reglas.map((r) => (
            <span key={r.codigo} className="mr-3">
              {r.nombre}: {r.porcentaje}%
              {r.producto ? ` (${r.producto})` : ""}
              {r.desde_cumplimiento > 0 ? ` desde el ${r.desde_cumplimiento}%` : ""}
            </span>
          ))}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">Comercial</th>
            <th className="font-normal pb-1 text-right">Meta</th>
            <th className="font-normal pb-1 text-right">Cobrado</th>
            <th className="font-normal pb-1 text-right">Cumple</th>
            <th className="font-normal pb-1 text-right">Comisión</th>
            <th className="font-normal pb-1 text-right">En camino</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.comercial} className="border-t">
              <td className="py-1 pr-2">{f.nombre}</td>
              <td className="py-1 text-right tabular-nums">
                {editando === f.comercial ? (
                  <Input
                    className="h-7 w-28 text-right"
                    autoFocus
                    value={monto}
                    placeholder="5000"
                    onChange={(e) => setMonto(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && guardar(f.comercial)}
                  />
                ) : f.meta === null ? (
                  <span className="text-muted-foreground">sin meta</span>
                ) : (
                  dinero(f.meta)
                )}
              </td>
              <td className="py-1 text-right tabular-nums">{dinero(f.cobrado)}</td>
              <td className="py-1 text-right tabular-nums">
                {f.cumplimiento === null ? (
                  "—"
                ) : (
                  <Badge variant={f.cumplimiento >= 100 ? "default" : "outline"}>
                    {f.cumplimiento}%
                  </Badge>
                )}
              </td>
              <td className="py-1 text-right tabular-nums font-medium">
                {dinero(f.comision)}
              </td>
              {/*
                Lo pendiente de cobro va en gris y aparte: es dinero que todavía
                no se paga, y mezclarlo con la comisión haría que el número que
                se mira sea el que no se cobra.
              */}
              <td className="py-1 text-right tabular-nums text-muted-foreground">
                {f.porCobrar > 0 ? dinero(f.comisionEnCamino) : "—"}
              </td>
              <td className="py-1 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditando(editando === f.comercial ? null : f.comercial);
                    setMonto(f.meta ? String(f.meta) : "");
                  }}
                >
                  {editando === f.comercial ? "Cancelar" : "Meta"}
                </Button>
                {editando === f.comercial && (
                  <Button size="sm" onClick={() => guardar(f.comercial)}>
                    Guardar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[11px] text-muted-foreground">
        La comisión se paga sobre lo cobrado en el mes. Lo ganado y pendiente de
        cobro sale en «en camino», y el cumplimiento también se mide sobre lo
        cobrado: una venta sin cobrar no destraba el umbral de una regla.
      </p>
    </div>
  );
};

/**
 * Sin ninguna regla, la columna de comisión sería cero para todo el mundo sin
 * decir por qué. Mejor pedirla aquí mismo que dejar un cuadro que parece roto.
 */
const SinReglas = ({ alCrear }: { alCrear: () => Promise<void> }) => {
  const [porcentaje, setPorcentaje] = useState("");
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    try {
      await ponerRegla({
        codigo: "general",
        nombre: "Comisión general",
        porcentaje: Number(porcentaje),
      });
      await alCrear();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        No hay ninguna regla de comisión. Pon el porcentaje general:
      </span>
      <Input
        className="h-8 w-24"
        placeholder="5"
        value={porcentaje}
        onChange={(e) => setPorcentaje(e.target.value)}
      />
      <Button size="sm" onClick={crear} disabled={!porcentaje}>
        Crear la regla
      </Button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
};
