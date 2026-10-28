import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  aprobacionesPendientes,
  aprobarDescuento,
  dinero,
  guardarPlantilla,
  listadoDePropuestas,
  NOMBRE_DE_ESTADO,
  NOMBRE_DE_MOTIVO,
  NOMBRE_DE_NIVEL,
  plantillasDePropuesta,
  ponerTope,
  topesDeDescuento,
  type PlantillaDePropuesta,
  type PropuestaListada,
  type TopeDeDescuento,
} from "../providers/friday/proformas";

/**
 * Todas las propuestas en un sitio.
 *
 * La ficha de cada venta enseña las suyas; esto contesta lo que no se ve
 * venta a venta: qué se mandó y nadie abrió, qué venció sin respuesta, por
 * qué se rechazan y qué descuentos esperan firma.
 */
export const PropuestasPage = () => (
  <div className="flex flex-col gap-4 p-1">
    <h1 className="text-xl font-semibold">Propuestas</h1>
    <Tabs defaultValue="seguimiento">
      <TabsList>
        <TabsTrigger value="seguimiento">Seguimiento</TabsTrigger>
        <TabsTrigger value="aprobaciones">Aprobaciones</TabsTrigger>
        <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
        <TabsTrigger value="descuentos">Política de descuentos</TabsTrigger>
      </TabsList>
      <TabsContent value="seguimiento">
        <Seguimiento />
      </TabsContent>
      <TabsContent value="aprobaciones">
        <Aprobaciones />
      </TabsContent>
      <TabsContent value="plantillas">
        <Plantillas />
      </TabsContent>
      <TabsContent value="descuentos">
        <Descuentos />
      </TabsContent>
    </Tabs>
  </div>
);

PropuestasPage.path = "/propuestas";

const ESTADOS = ["", "borrador", "enviada", "vencida", "aceptada", "rechazada", "reemplazada", "anulada"];

const Seguimiento = () => {
  const [estado, setEstado] = useState("");
  const [filas, setFilas] = useState<PropuestaListada[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listadoDePropuestas({ estado })
      .then((f) => {
        setFilas(f);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [estado]);

  /**
   * Los números de arriba, sobre lo listado.
   *
   * La tasa de aceptación cuenta sólo las que el cliente contestó: las que
   * siguen enviadas no han dicho nada, y contarlas como «no» castiga mandar
   * propuestas.
   */
  const cifras = useMemo(() => {
    const aceptadas = filas.filter((f) => f.estado === "aceptada").length;
    const rechazadas = filas.filter((f) => f.estado === "rechazada").length;
    const sinAbrir = filas.filter((f) => f.estado === "enviada" && !f.vista_en).length;
    const motivos = new Map<string, number>();
    for (const f of filas) {
      if (f.estado === "rechazada" && f.motivo_rechazo) {
        motivos.set(f.motivo_rechazo, (motivos.get(f.motivo_rechazo) ?? 0) + 1);
      }
    }
    return {
      aceptadas,
      rechazadas,
      sinAbrir,
      tasa: aceptadas + rechazadas ? Math.round((aceptadas / (aceptadas + rechazadas)) * 100) : null,
      motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [filas]);

  return (
    <div className="flex flex-col gap-3 mt-3">
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => (
          <Button
            key={e || "todas"}
            size="sm"
            variant={estado === e ? "default" : "outline"}
            onClick={() => setEstado(e)}
          >
            {e ? NOMBRE_DE_ESTADO[e] : "Todas"}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!estado && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Cifra titulo="Propuestas" valor={String(filas.length)} pie="las 500 más recientes" />
          <Cifra
            titulo="Aceptación"
            valor={cifras.tasa === null ? "—" : `${cifras.tasa} %`}
            pie={`${cifras.aceptadas} de ${cifras.aceptadas + cifras.rechazadas} contestadas`}
          />
          <Cifra titulo="Sin abrir" valor={String(cifras.sinAbrir)} pie="enviadas que nadie abrió" />
          <div className="border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Por qué dicen que no</p>
            {cifras.motivos.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">Sin rechazos.</p>
            ) : (
              <ul className="text-sm mt-1">
                {cifras.motivos.slice(0, 4).map(([codigo, n]) => (
                  <li key={codigo} className="flex justify-between">
                    <span>{NOMBRE_DE_MOTIVO[codigo] ?? codigo}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Tabla filas={filas} />
    </div>
  );
};

const Tabla = ({
  filas,
  accion,
}: {
  filas: PropuestaListada[];
  accion?: (f: PropuestaListada) => React.ReactNode;
}) =>
  filas.length === 0 ? (
    <p className="text-sm text-muted-foreground">Nada que mostrar.</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">Número</th>
            <th className="font-normal pb-1">Cliente / venta</th>
            <th className="font-normal pb-1">Comercial</th>
            <th className="font-normal pb-1">Estado</th>
            <th className="font-normal pb-1 pr-2 text-right">Total</th>
            <th className="font-normal pb-1">Seguimiento</th>
            {accion && <th className="font-normal pb-1" />}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-t align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">
                <Link className="underline" to={`/deals/${f.oportunidad}/show`}>
                  {f.numero}
                </Link>
              </td>
              <td className="py-1.5 pr-2">
                <div className="truncate max-w-72" title={f.razon_social}>
                  {f.razon_social}
                </div>
                <div className="text-xs text-muted-foreground">{f.oportunidad_nombre}</div>
              </td>
              <td className="py-1.5 pr-2">{f.comercial ?? "—"}</td>
              <td className="py-1.5 pr-2">
                <Badge variant="outline">{NOMBRE_DE_ESTADO[f.estado_visible] ?? f.estado_visible}</Badge>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{dinero(f.total)}</td>
              <td className="py-1.5 pr-2 text-xs text-muted-foreground">
                {seguimiento(f)}
              </td>
              {accion && <td className="py-1.5">{accion(f)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

/** Una frase con lo que hay que saber de cada una para decidir si llamar. */
function seguimiento(f: PropuestaListada): string {
  const dias = (fecha: string) =>
    Math.floor((Date.now() - new Date(fecha).getTime()) / 86_400_000);
  if (f.estado === "rechazada") {
    return NOMBRE_DE_MOTIVO[f.motivo_rechazo ?? ""] ?? "Rechazada sin motivo";
  }
  if (f.estado === "borrador") {
    return f.aprobacion?.pendiente
      ? `Espera la firma de ${NOMBRE_DE_NIVEL[f.aprobacion.pendiente]}`
      : `Borrador de ${f.creada_por}`;
  }
  if (f.estado === "enviada" && f.enviada_en) {
    const canal = f.canal_envio === "whatsapp" ? " por WhatsApp" : "";
    return f.vista_en
      ? `Enviada${canal} hace ${dias(f.enviada_en)} d · abierta`
      : `Enviada${canal} hace ${dias(f.enviada_en)} d · sin abrir`;
  }
  if (f.estado === "aceptada" && f.cerrada_en) return `Aceptada el ${f.cerrada_en.slice(0, 10)}`;
  return "";
}

const Aprobaciones = () => {
  const [filas, setFilas] = useState<PropuestaListada[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFilas(await aprobacionesPendientes());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="flex flex-col gap-3 mt-3">
      <p className="text-sm text-muted-foreground">
        Los descuentos por encima del tope libre los firma alguien por encima de
        quien hizo la proforma, según la jerarquía de equipos de Tableros. Se
        firma el porcentaje: si después se sube, hay que volver a firmar.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Tabla
        filas={filas}
        accion={(f) =>
          f.puedes_aprobar ? (
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await aprobarDescuento(f.id);
                  await cargar();
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Firmar {f.aprobacion.descuento_pct} %
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{f.motivo}</span>
          )
        }
      />
    </div>
  );
};

const PLANTILLA_VACIA: Partial<PlantillaDePropuesta> = {
  codigo: "",
  nombre: "",
  dias_validez: 15,
  condiciones_pago: "",
  condiciones: "",
  notas: "",
  activa: true,
};

const Plantillas = () => {
  const [plantillas, setPlantillas] = useState<PlantillaDePropuesta[]>([]);
  const [editando, setEditando] = useState<Partial<PlantillaDePropuesta> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setPlantillas(await plantillasDePropuesta());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const guardar = async () => {
    if (!editando) return;
    try {
      await guardarPlantilla(editando);
      setEditando(null);
      setError(null);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const campo = (clave: keyof PlantillaDePropuesta, valor: string | number | boolean) =>
    setEditando((p) => ({ ...p, [clave]: valor }));

  return (
    <div className="flex flex-col gap-3 mt-3">
      <p className="text-sm text-muted-foreground">
        El texto de siempre, escrito una vez. Al crear una proforma con plantilla
        se copian la validez, la forma de pago y las condiciones; cambiar la
        plantilla después no toca lo que ya se mandó.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {plantillas.map((p) => (
        <div key={p.codigo} className="border rounded-md p-3 flex flex-wrap items-start justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">{p.nombre}</span>{" "}
            <span className="text-xs text-muted-foreground">
              {p.codigo} · {p.dias_validez} días{p.activa ? "" : " · inactiva"}
            </span>
            {p.condiciones_pago && (
              <p className="text-xs text-muted-foreground">Pago: {p.condiciones_pago}</p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
            Editar
          </Button>
        </div>
      ))}

      {editando ? (
        <div className="border rounded-md p-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Código
            <Input
              value={editando.codigo ?? ""}
              disabled={plantillas.some((p) => p.codigo === editando.codigo)}
              placeholder="auditoria-anual"
              onChange={(e) => campo("codigo", e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Nombre
            <Input value={editando.nombre ?? ""} onChange={(e) => campo("nombre", e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Días de validez
            <Input
              type="number"
              min={1}
              max={365}
              value={editando.dias_validez ?? 15}
              onChange={(e) => campo("dias_validez", Number(e.target.value))}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Forma de pago
            <Input
              value={editando.condiciones_pago ?? ""}
              onChange={(e) => campo("condiciones_pago", e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1 sm:col-span-2">
            Condiciones
            <Textarea
              rows={3}
              value={editando.condiciones ?? ""}
              onChange={(e) => campo("condiciones", e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1 sm:col-span-2">
            Notas
            <Textarea rows={2} value={editando.notas ?? ""} onChange={(e) => campo("notas", e.target.value)} />
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={editando.activa ?? true}
              onChange={(e) => campo("activa", e.target.checked)}
            />
            Activa
          </label>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={guardar}>
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setEditando({ ...PLANTILLA_VACIA })}>
          Nueva plantilla
        </Button>
      )}
    </div>
  );
};

const Descuentos = () => {
  const [topes, setTopes] = useState<TopeDeDescuento[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const poner = (t: TopeDeDescuento[]) => {
    setTopes(t);
    setValores(Object.fromEntries(t.map((x) => [x.nivel, String(x.hasta_pct)])));
  };

  useEffect(() => {
    topesDeDescuento().then(poner).catch((e) => setError(e.message));
  }, []);

  const tope = (nivel: string) => topes.find((t) => t.nivel === nivel)?.hasta_pct;

  return (
    <div className="flex flex-col gap-3 mt-3 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Cuenta el mayor descuento de las líneas, no el medio: un descuento grande
        en una línea pequeña es justo el que alguien querrá explicar después.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {(["libre", "supervisor"] as const).map((nivel) => (
        <div key={nivel} className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground flex flex-col gap-1 flex-1">
            {nivel === "libre" ? "Sin firma, hasta" : "Firma el supervisor, hasta"}
            <Input
              inputMode="decimal"
              value={valores[nivel] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [nivel]: e.target.value }))}
            />
          </label>
          <span className="pb-2 text-sm">%</span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                poner(await ponerTope(nivel, Number(valores[nivel])));
                setError(null);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Guardar
          </Button>
        </div>
      ))}
      <p className="text-sm">
        Por encima del {tope("supervisor") ?? "—"} % firma dirección: quien está
        arriba del todo en la cadena del comercial.
      </p>
    </div>
  );
};

const Cifra = ({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) => (
  <div className="border rounded-lg p-3">
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    <p className="text-[11px] text-muted-foreground">{pie}</p>
  </div>
);
