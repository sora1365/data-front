import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  abrirDesdeLista,
  anotarGestion,
  listaDeTrabajo,
  listarSegmentos,
  NOMBRE_DE_RESULTADO,
  rendimientoDeSegmentos,
  type MiembroDeLista,
  type RendimientoDeSegmento,
  type Resultado,
} from "../providers/friday/listas";
import { listarProductos } from "../providers/friday/campanias";

/**
 * La lista de trabajo del día.
 *
 * El gestor comercial sabe a quién llamar y el CRM sabe qué pasó después.
 * Esto es lo de en medio: **la memoria del intento**. Sin ella la lista sale
 * igual todos los días, y todos los días se llama a los veinte primeros
 * mientras el final del segmento no se toca nunca.
 *
 * Cada botón anota y saca la fila de la lista de hoy. Quien no contesta vuelve
 * en dos días, a quien no le interesa se le pregunta en seis meses, y quien
 * pide que no lo llamen no vuelve: eso último se le devuelve al gestor, para
 * que no reaparezca por otro segmento.
 */
export const ListasPage = () => {
  const [segmentos, setSegmentos] = useState<{ codigo: string; nombre: string; miembros: number }[]>([]);
  const [productos, setProductos] = useState<{ codigo: string; nombre: string }[]>([]);
  const [elegido, setElegido] = useState("");
  const [producto, setProducto] = useState("");
  const [marca, setMarca] = useState("ascendra");
  const [conContacto, setConContacto] = useState(true);
  const [miembros, setMiembros] = useState<MiembroDeLista[]>([]);
  const [rendimiento, setRendimiento] = useState<RendimientoDeSegmento[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    listarSegmentos().then(setSegmentos).catch((e) => setError(e.message));
    listarProductos().then(setProductos).catch(() => setProductos([]));
    rendimientoDeSegmentos().then(setRendimiento).catch(() => setRendimiento([]));
  }, []);

  const cargar = useCallback(async () => {
    if (!elegido) return;
    setCargando(true);
    try {
      const lista = await listaDeTrabajo(elegido, { producto, limite: 40, conContacto });
      setMiembros(lista.miembros);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [elegido, producto, conContacto]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Al anotar, la fila desaparece de la lista sin recargarla entera.
   *
   * Recargar devolvería otras cuarenta empresas y haría perder el sitio: quien
   * está llamando lleva la vista donde va, y que la lista salte debajo del
   * cursor es la forma más rápida de llamar dos veces al mismo.
   */
  const quitar = (clave: string) =>
    setMiembros((previos) => previos.filter((m) => m.clave !== clave));

  const anotar = async (m: MiembroDeLista, resultado: Resultado) => {
    quitar(m.clave);
    try {
      await anotarGestion({
        tipoSujeto: m.tipo_sujeto,
        clave: m.clave,
        resultado,
        segmento: elegido,
        producto: producto || undefined,
        canal: "llamada",
      });
      rendimientoDeSegmentos().then(setRendimiento).catch(() => {});
    } catch (e: any) {
      setError(e.message);
      await cargar();
    }
  };

  const abrir = async (m: MiembroDeLista) => {
    if (!producto) {
      setError("Elige antes qué producto se le ofrece.");
      return;
    }
    quitar(m.clave);
    try {
      await abrirDesdeLista({
        tipoSujeto: m.tipo_sujeto,
        clave: m.clave,
        producto,
        marca,
        segmento: elegido,
      });
      rendimientoDeSegmentos().then(setRendimiento).catch(() => {});
    } catch (e: any) {
      setError(e.message);
      await cargar();
    }
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header>
        <h1 className="text-xl font-semibold">Listas de trabajo</h1>
        <p className="text-sm text-muted-foreground">
          Los segmentos del gestor comercial, convertidos en llamadas. Cada
          resultado se anota y decide cuándo vuelve esa empresa.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Segmento
          <select
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
          >
            <option value="">Elige una lista…</option>
            {segmentos.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.nombre} ({s.miembros.toLocaleString("es-EC")})
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Qué se le ofrece
          <select
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={producto}
            onChange={(e) => setProducto(e.target.value)}
          >
            <option value="">Sin decidir</option>
            {productos.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Marca
          <Input className="h-9 w-32" value={marca} onChange={(e) => setMarca(e.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm h-9">
          <input
            type="checkbox"
            checked={conContacto}
            onChange={(e) => setConContacto(e.target.checked)}
          />
          Sólo con teléfono o correo
        </label>

        <Button size="sm" variant="outline" onClick={cargar} disabled={!elegido || cargando}>
          {cargando ? "Cargando…" : "Refrescar"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {elegido && miembros.length === 0 && !cargando && (
        <p className="text-sm text-muted-foreground">
          No queda nadie a quien llamar hoy en esta lista. Los que ya se
          intentaron vuelven solos cuando toque.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {miembros.map((m) => (
          <Fila
            key={`${m.tipo_sujeto}:${m.clave}`}
            miembro={m}
            alAnotar={(r) => anotar(m, r)}
            alAbrir={() => abrir(m)}
          />
        ))}
      </div>

      {rendimiento.length > 0 && (
        <section className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Qué da cada lista · el embudo de antes del embudo
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Segmento</th>
                <th className="font-normal pb-1 text-right">Gestiones</th>
                <th className="font-normal pb-1 text-right">Oportunidades</th>
                <th className="font-normal pb-1 text-right">No contesta</th>
                <th className="font-normal pb-1 text-right">No interesa</th>
              </tr>
            </thead>
            <tbody>
              {rendimiento.map((r) => (
                <tr key={r.segmento ?? "sin"} className="border-t">
                  <td className="py-1">{r.segmento_nombre ?? r.segmento ?? "Sin segmento"}</td>
                  <td className="py-1 text-right tabular-nums">{r.gestiones}</td>
                  <td className="py-1 text-right tabular-nums">
                    {r.oportunidades}
                    {r.gestiones > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({Math.round((r.oportunidades / r.gestiones) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">{r.no_contesta}</td>
                  <td className="py-1 text-right tabular-nums">{r.no_interesa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};

ListasPage.path = "/listas";

const Fila = ({
  miembro: m,
  alAnotar,
  alAbrir,
}: {
  miembro: MiembroDeLista;
  alAnotar: (resultado: Resultado) => void;
  alAbrir: () => void;
}) => (
  <div className="border rounded-lg p-3 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium truncate">{m.nombre}</span>
        {m.ruc && <span className="text-xs text-muted-foreground">{m.ruc}</span>}
        {m.ultimo_resultado && (
          <Badge variant="outline" className="font-normal">
            {NOMBRE_DE_RESULTADO[m.ultimo_resultado] ?? m.ultimo_resultado}
            {m.intentos > 1 ? ` ·${m.intentos}` : ""}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">
        {[m.actividad, [m.canton, m.provincia].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {/*
        El teléfono y el correo van como enlaces: en un portátil con softphone
        se marca desde aquí, y en el móvil llama de verdad. Copiar un número a
        mano cuarenta veces al día es donde se pierde la lista.
      */}
      <p className="text-sm">
        {m.telefono && (
          <a className="underline mr-3" href={`tel:${m.telefono}`}>
            {m.telefono}
          </a>
        )}
        {m.correo && (
          <a className="underline" href={`mailto:${m.correo}`}>
            {m.correo}
          </a>
        )}
      </p>
    </div>

    <div className="flex flex-wrap gap-1 justify-end">
      <Button size="sm" onClick={alAbrir}>
        Abrir oportunidad
      </Button>
      <Button size="sm" variant="outline" onClick={() => alAnotar("no_contesta")}>
        No contesta
      </Button>
      <Button size="sm" variant="outline" onClick={() => alAnotar("volver_a_llamar")}>
        Volver a llamar
      </Button>
      <Button size="sm" variant="outline" onClick={() => alAnotar("no_interesa")}>
        No le interesa
      </Button>
      <Button size="sm" variant="ghost" onClick={() => alAnotar("no_contactar")}>
        Que no lo llamen
      </Button>
    </div>
  </div>
);
