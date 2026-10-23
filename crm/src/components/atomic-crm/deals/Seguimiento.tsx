import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  iniciarSeguimiento,
  listarSecuencias,
  nombreDeCanal,
  nombreDeDia,
  previoDe,
  seguimientoDe,
  type Paso,
  type Secuencia,
  type SeguimientoDeOportunidad,
} from "../providers/friday/seguimiento";

/**
 * El seguimiento de esta venta, dentro de su ficha.
 *
 * Arrancar un plan pone tres tareas en la agenda de quien lleva la venta, así
 * que antes de crear nada se enseña en qué días caerían: un seguimiento que
 * aparece solo en la agenda de otra persona es una sorpresa, y las sorpresas
 * en la agenda se desactivan a la segunda.
 */
export const Seguimiento = ({ dealId }: { dealId: string | number }) => {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [míos, setMios] = useState<SeguimientoDeOportunidad[]>([]);
  const [elegida, setElegida] = useState<string>("");
  const [previo, setPrevio] = useState<Paso[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([listarSecuencias(), seguimientoDe(dealId)]);
      setSecuencias(s.filter((x) => x.activa));
      setMios(m);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [dealId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!elegida) {
      setPrevio([]);
      return;
    }
    previoDe(elegida).then(setPrevio).catch(() => setPrevio([]));
  }, [elegida]);

  const vivo = míos.find((m) => m.estado === "vivo");

  const iniciar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await iniciarSeguimiento(elegida, dealId);
      setElegida("");
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3">
      <span className="text-xs text-muted-foreground tracking-wide">Seguimiento</span>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {míos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Sin plan de seguimiento. Cada paso se convierte en una tarea con su
          canal; nada se envía solo.
        </p>
      )}

      {míos.map((m) => (
        <div key={m.id} className="border rounded-md p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{m.secuencia_nombre}</span>
            <Badge variant={m.estado === "vivo" ? "default" : "secondary"}>
              {m.estado === "vivo"
                ? "En marcha"
                : m.estado === "terminado"
                  ? "Terminado"
                  : `Cortado · ${m.motivo_corte ?? "sin motivo"}`}
            </Badge>
          </div>
          <ol className="space-y-0.5">
            {m.tareas.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground w-24 shrink-0">
                  {t.vence}
                </span>
                <Badge variant="outline" className="shrink-0 font-normal">
                  {nombreDeCanal(t.canal)}
                </Badge>
                <span className={t.hecha ? "line-through text-muted-foreground" : ""}>
                  {t.texto}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {!vivo && secuencias.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          <select
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={elegida}
            onChange={(e) => setElegida(e.target.value)}
          >
            <option value="">Iniciar un seguimiento…</option>
            {secuencias.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.nombre}
              </option>
            ))}
          </select>

          {elegida && (
            <>
              <div className="text-xs text-muted-foreground">
                {previo.map((p) => (
                  <div key={p.orden}>
                    {nombreDeDia(p.dia)} · {nombreDeCanal(p.canal)} · {p.vence}
                    {p.movido ? " (movido al lunes)" : ""}
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={iniciar} disabled={guardando}>
                {guardando ? "Creando…" : "Crear las tareas"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
