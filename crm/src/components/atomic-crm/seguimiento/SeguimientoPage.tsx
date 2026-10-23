import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cortarSeguimiento,
  listarSecuencias,
  listarVivos,
  nombreDeCanal,
  nombreDeDia,
  type Secuencia,
  type SeguimientoVivo,
} from "../providers/friday/seguimiento";

/**
 * El seguimiento: qué planes hay y cuáles están en marcha.
 *
 * Una secuencia **genera tareas, no envíos**. Mandar solo el WhatsApp del
 * tercer día es igual de fácil y convierte el CRM en algo que escribe a
 * clientes sin que nadie lea lo que contestaron; aquí la tarea aparece en la
 * agenda con su canal y la persona decide.
 */
export const SeguimientoPage = () => {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [vivos, setVivos] = useState<SeguimientoVivo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([listarSecuencias(), listarVivos()]);
      setSecuencias(s);
      setVivos(v);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="flex flex-col gap-4 p-1">
      <header>
        <h1 className="text-xl font-semibold">Seguimiento</h1>
        <p className="text-sm text-muted-foreground">
          Los planes de contacto y lo que hay en marcha. Cada paso se convierte
          en una tarea con su canal: nada se envía solo.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">En marcha ({vivos.length})</h2>
            {vivos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nada en marcha. Se arranca desde la ficha de una oportunidad, o
                solo al mover una tarjeta a la etapa que dispara la secuencia.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {vivos.map((v) => (
                  <EnMarcha key={v.id} seguimiento={v} alCortar={cargar} />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Secuencias</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {secuencias.map((s) => (
                <TarjetaDeSecuencia key={s.codigo} secuencia={s} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

SeguimientoPage.path = "/seguimiento";

const EnMarcha = ({
  seguimiento: v,
  alCortar,
}: {
  seguimiento: SeguimientoVivo;
  alCortar: () => Promise<void>;
}) => {
  const [cortando, setCortando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cortar = async () => {
    if (!motivo.trim()) return;
    try {
      await cortarSeguimiento(v.id, motivo.trim());
      setCortando(false);
      setMotivo("");
      await alCortar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {v.empresa ?? "Sin empresa"} · {v.oportunidad_nombre}
          </p>
          <p className="text-xs text-muted-foreground">
            {v.secuencia_nombre} · {v.hechos} de {v.pasos} hechos
            {v.proximo ? ` · próximo el ${String(v.proximo).slice(0, 10)}` : ""}
            {v.comercial ? ` · ${v.comercial}` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCortando((c) => !c)}>
          {cortando ? "Cancelar" : "Cortar"}
        </Button>
      </div>

      {cortando && (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            El motivo es obligatorio a propósito: «se cortó» sin más no
            distingue haber cerrado el trato de haberse rendido, y es justo
            esa diferencia la que se quiere mirar después.
          */}
          <Input
            className="max-w-md"
            placeholder="¿Por qué se corta? Contestó, no le interesa…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button size="sm" onClick={cortar} disabled={!motivo.trim()}>
            Cortar y quitar lo pendiente
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};

const TarjetaDeSecuencia = ({ secuencia: s }: { secuencia: Secuencia }) => (
  <div className="border rounded-lg p-3 flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium">{s.nombre}</p>
      <div className="flex items-center gap-1">
        {s.vivos > 0 && (
          <Badge variant="outline">{s.vivos} en marcha</Badge>
        )}
        {s.activa ? null : <Badge variant="secondary">Desactivada</Badge>}
      </div>
    </div>

    {s.descripcion && (
      <p className="text-xs text-muted-foreground">{s.descripcion}</p>
    )}

    <p className="text-xs text-muted-foreground">
      {s.etapa_disparo
        ? `Arranca sola al pasar a «${s.etapa_disparo}»`
        : "Se inicia a mano desde la oportunidad"}
    </p>

    <ol className="flex flex-col gap-1">
      {s.pasos.map((p) => (
        <li key={p.orden} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">
            {nombreDeDia(p.dia)}
          </span>
          <Badge variant="outline" className="shrink-0 font-normal">
            {nombreDeCanal(p.canal)}
          </Badge>
          <span className="truncate">{p.texto}</span>
        </li>
      ))}
    </ol>
  </div>
);
