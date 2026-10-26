import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  claseDePuntaje,
  crearEncuesta,
  enviarEncuesta,
  fijarRenovacion,
  renovar,
  resumenDePostventa,
  type ResumenDePostventa,
} from "../providers/friday/postventa";
import { dinero } from "../providers/friday/proformas";
import { VentaCruzada } from "./VentaCruzada";

/**
 * Postventa: lo que pasa después de ganar.
 *
 * Tres cosas que se pierden solas si nadie las mira: qué hay que renovar, qué
 * opinan los clientes, y a quién todavía no se le ha preguntado. No hay ningún
 * proceso nocturno detrás: se calcula al abrir la pantalla, porque un
 * programador que corre de madrugada es una pieza que se cae en silencio y
 * nadie lo nota hasta que pasan tres meses sin avisos.
 */
export const PostventaPage = () => {
  const [datos, setDatos] = useState<ResumenDePostventa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await resumenDePostventa());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const conError = async (accion: () => Promise<unknown>, mensaje?: string) => {
    try {
      await accion();
      if (mensaje) setAviso(mensaje);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!datos) {
    return (
      <div className="p-1">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
      </div>
    );
  }

  const { nps } = datos;

  return (
    <div className="flex flex-col gap-4 p-1">
      <header>
        <h1 className="text-xl font-semibold">Postventa</h1>
        <p className="text-sm text-muted-foreground">
          Lo que hay que renovar, lo que opinan los clientes y a quién falta
          preguntarle.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {aviso && (
        <Alert>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {/*
          Sin respuestas se enseña «—» y no un cero: un cero se lee como
          «vamos regular», y la verdad es que no se sabe.
        */}
        <Cifra
          titulo="NPS"
          valor={nps.nps === null ? "—" : String(nps.nps)}
          pie={`${nps.respuestas} respuesta(s)`}
        />
        <Cifra
          titulo="Promedio"
          valor={nps.promedio === null ? "—" : String(nps.promedio)}
          pie="sobre 10"
        />
        <Cifra titulo="Detractores" valor={String(nps.detractores)} pie="de 0 a 6" />
        <Cifra
          titulo="Renovaciones"
          valor={String(datos.renovaciones.length)}
          pie="en los próximos 45 días"
        />
      </div>

      <VentaCruzada />

      <section className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">Renovaciones</p>
        {datos.renovaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada que renovar por ahora. La fecha sale de la periodicidad de lo
            que se cotizó; también se puede poner a mano.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {datos.renovaciones.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1 pr-2">
                    <div className="truncate max-w-xs">{r.razon_social}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.producto_nombre ?? r.producto} · {dinero(r.monto)}
                    </div>
                  </td>
                  <td className="py-1 text-right">
                    <Badge variant={r.vencida ? "destructive" : "outline"}>
                      {r.vencida
                        ? `vencida hace ${Math.abs(r.dias)} d`
                        : `en ${r.dias} d · ${r.renueva_en}`}
                    </Badge>
                  </td>
                  <td className="py-1 text-right w-44">
                    <Button
                      size="sm"
                      onClick={() =>
                        conError(
                          () => renovar(r.id),
                          "Abierta la oportunidad de renovación en el tablero.",
                        )
                      }
                    >
                      Abrir renovación
                    </Button>
                    {/*
                      Renovar abre una oportunidad y no da la venta por hecha:
                      una renovación se negocia, y contarla como ganada haría
                      que el embudo enseñara cerrado lo que falta trabajar.
                    */}
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Dejar de avisar de esta renovación"
                      onClick={() => conError(() => fijarRenovacion(r.id, null))}
                    >
                      No renueva
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">
          Ventas cobradas a las que no se les ha preguntado
        </p>
        {datos.sinEncuesta.length === 0 ? (
          <p className="text-sm text-muted-foreground">No queda ninguna.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {datos.sinEncuesta.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-1 pr-2">
                    <div className="truncate max-w-xs">{v.razon_social}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.producto_nombre ?? ""}
                    </div>
                  </td>
                  <td className="py-1 text-right w-48">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        conError(async () => {
                          const encuesta = await crearEncuesta(v.id);
                          await enviarEncuesta(encuesta.id);
                        }, "Encuesta enviada.")
                      }
                    >
                      Enviar encuesta
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">Encuestas</p>
        {datos.encuestas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha mandado ninguna.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {datos.encuestas.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="py-1 pr-2">
                    <div className="truncate max-w-xs">{e.razon_social}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.producto_nombre ?? ""}
                      {e.respondida_por ? ` · ${e.respondida_por}` : ""}
                    </div>
                    {e.comentario && (
                      <p className="text-sm mt-1 whitespace-pre-line">{e.comentario}</p>
                    )}
                  </td>
                  <td className="py-1 text-right w-32">
                    {e.puntaje === null ? (
                      <span className="text-xs text-muted-foreground">
                        {e.vista_en ? "la abrió" : e.enviada_en ? "enviada" : "sin enviar"}
                      </span>
                    ) : (
                      <Badge
                        variant={
                          claseDePuntaje(e.puntaje) === "detractor"
                            ? "destructive"
                            : claseDePuntaje(e.puntaje) === "pasivo"
                              ? "secondary"
                              : "default"
                        }
                      >
                        {e.puntaje}/10 · {claseDePuntaje(e.puntaje)}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

PostventaPage.path = "/postventa";

const Cifra = ({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) => (
  <div className="border rounded-lg p-3">
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    <p className="text-[11px] text-muted-foreground">{pie}</p>
  </div>
);
