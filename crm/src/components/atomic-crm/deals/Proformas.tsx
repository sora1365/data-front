import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Cotizar } from "./Cotizar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usuarioActual } from "../providers/friday/dataProvider";
import {
  anularProforma,
  aprobarDescuento,
  crearProforma,
  dinero,
  editarProforma,
  enlaceDeProforma,
  enviarProforma,
  eventosDe,
  NOMBRE_DE_ESTADO,
  NOMBRE_DE_EVENTO,
  NOMBRE_DE_MOTIVO,
  NOMBRE_DE_NIVEL,
  nuevaVersion,
  pdfDeProforma,
  pedirAprobacion,
  plantillasDePropuesta,
  proformasDe,
  totalesDe,
  type EventoDePropuesta,
  type LineaDeProforma,
  type PlantillaDePropuesta,
  type Proforma,
} from "../providers/friday/proformas";

/**
 * Las proformas de la venta.
 *
 * Una proforma en borrador se edita aquí mismo —líneas, cantidades,
 * descuentos— y al enviarla deja de tocarse: el cliente tiene en la mano un
 * documento con ese número, y cambiarle los precios por detrás es perder la
 * discusión sobre lo que se acordó. Para cambiarla se hace una versión nueva,
 * que al mandarse deja la anterior reemplazada.
 */
export const Proformas = ({ dealId }: { dealId: string | number }) => {
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [plantillas, setPlantillas] = useState<PlantillaDePropuesta[]>([]);
  const [plantilla, setPlantilla] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /**
   * Lo que acaba de cotizarse entra como línea del borrador.
   *
   * Si no hay ninguno se crea, y la línea cotizada **sustituye** a la que sale
   * sola del producto: las dos dicen el precio de lo mismo, y dejar las dos
   * cotiza el doble.
   */
  const ponerEnLaProforma = async (
    precio: number,
    descripcion: string,
    cotizacion: string,
  ) => {
    setError(null);
    try {
      const linea = {
        producto: null,
        descripcion,
        cantidad: 1,
        precio_unitario: precio,
        descuento_pct: 0,
        iva_pct: 15,
        cotizacion,
      };

      const borrador = proformas.find((p) => p.estado === "borrador");
      if (borrador) {
        await editarProforma(borrador.id, { lineas: [...borrador.lineas, linea] });
      } else {
        const nueva = await crearProforma(dealId, plantilla);
        await editarProforma(nueva.id, { lineas: [linea] });
      }
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const cargar = useCallback(async () => {
    try {
      setProformas(await proformasDe(dealId));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [dealId]);

  useEffect(() => {
    void cargar();
    plantillasDePropuesta()
      .then((todas) => setPlantillas(todas.filter((p) => p.activa)))
      .catch(() => setPlantillas([]));
  }, [cargar]);

  const crear = async () => {
    setOcupado(true);
    setError(null);
    try {
      await crearProforma(dealId, plantilla);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const hayBorrador = proformas.some((p) => p.estado === "borrador");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tracking-wide">Proformas</span>
        {/*
          Con un borrador abierto no se ofrece otro: dos borradores de la misma
          venta terminan enviándose los dos, y el cliente recibe dos precios.
        */}
        {!hayBorrador && (
          <div className="flex items-center gap-2">
            {plantillas.length > 0 && (
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={plantilla}
                onChange={(e) => setPlantilla(e.target.value)}
                aria-label="Plantilla"
              >
                <option value="">Sin plantilla</option>
                {plantillas.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" variant="outline" onClick={crear} disabled={ocupado}>
              {ocupado ? "Creando…" : "Nueva proforma"}
            </Button>
          </div>
        )}
      </div>

      <Cotizar dealId={dealId} alCotizar={ponerEnLaProforma} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {proformas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay ninguna. La nueva sale con el producto de la venta y el
          precio de la lista.
        </p>
      )}

      {proformas.map((p) => (
        <Ficha
          key={p.id}
          proforma={p}
          hayBorrador={hayBorrador}
          alCambiar={cargar}
        />
      ))}
    </div>
  );
};

const COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  enviada: "default",
  vencida: "destructive",
  aceptada: "default",
  rechazada: "secondary",
  anulada: "secondary",
  reemplazada: "secondary",
};

const LINEA_VACIA: LineaDeProforma = {
  producto: null,
  descripcion: "",
  cantidad: 1,
  precio_unitario: 0,
  descuento_pct: 0,
  iva_pct: 15,
  opcional: false,
};

const Ficha = ({
  proforma: p,
  hayBorrador,
  alCambiar,
}: {
  proforma: Proforma;
  hayBorrador: boolean;
  alCambiar: () => Promise<void>;
}) => {
  const editable = p.estado === "borrador";
  const [lineas, setLineas] = useState<LineaDeProforma[]>(p.lineas);
  const [correo, setCorreo] = useState(p.correo ?? "");
  const [valida, setValida] = useState(p.valida_hasta);
  const [pago, setPago] = useState(p.condiciones_pago ?? "");
  const [condiciones, setCondiciones] = useState(p.condiciones ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enlace, setEnlace] = useState<string | null>(null);
  const [historial, setHistorial] = useState<EventoDePropuesta[] | null>(null);

  useEffect(() => {
    setLineas(p.lineas);
    setCorreo(p.correo ?? "");
    setValida(p.valida_hasta);
    setPago(p.condiciones_pago ?? "");
    setCondiciones(p.condiciones ?? "");
  }, [p]);

  const totales = editable ? totalesDe(lineas) : p;
  const datos = () => ({
    lineas,
    correo,
    valida_hasta: valida,
    condiciones_pago: pago,
    condiciones,
  });

  const cambiar = (i: number, campo: keyof LineaDeProforma, valor: string | boolean) =>
    setLineas((previas) =>
      previas.map((l, j) =>
        j === i
          ? {
              ...l,
              [campo]:
                campo === "descripcion" || campo === "opcional" ? valor : Number(valor || 0),
            }
          : l,
      ),
    );

  /** Envuelve una acción: ocupado, error y recarga, siempre igual. */
  const hacer = async (accion: () => Promise<unknown>) => {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await alCambiar();
      if (historial) setHistorial(await eventosDe(p.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  // Se guarda antes de mandar o de pedir firma: hacerlo con lo que está en la
  // pantalla y no con lo último guardado evita corregir un precio y mandar el
  // viejo.
  const enviar = (canal: "correo" | "whatsapp") =>
    hacer(async () => {
      await editarProforma(p.id, datos());
      const enviada = await enviarProforma(p.id, canal);
      setEnlace(enviada.enlace);
      if (enviada.enlace_whatsapp) window.open(enviada.enlace_whatsapp, "_blank", "noopener");
    });

  const pendiente = editable ? p.aprobacion.pendiente : null;
  // Una pista, no una regla: la que decide es la del servidor, que conoce la
  // cadena de supervisores. Aquí sólo se esconde el botón a quien la hizo.
  const soyAutor = p.creada_por === usuarioActual();

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{p.numero}</span>
        <Badge variant={COLOR[p.estado_visible] ?? "outline"}>
          {NOMBRE_DE_ESTADO[p.estado_visible] ?? p.estado_visible}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {dinero(totales.total)} · vale hasta el {p.valida_hasta}
          {p.vista_en ? " · la abrió" : p.enviada_en ? " · sin abrir" : ""}
          {p.canal_envio === "whatsapp" ? " · por WhatsApp" : ""}
          {p.aceptada_por ? ` · ${p.aceptada_por}` : ""}
        </span>
      </div>

      {p.estado === "rechazada" && p.motivo_rechazo && (
        <p className="text-xs text-muted-foreground">
          Motivo: {NOMBRE_DE_MOTIVO[p.motivo_rechazo] ?? p.motivo_rechazo}
          {p.motivo ? ` — «${p.motivo}»` : ""}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">Detalle</th>
            <th className="font-normal pb-1 w-16 text-right">Cant.</th>
            <th className="font-normal pb-1 w-24 text-right">P. unit.</th>
            <th className="font-normal pb-1 w-16 text-right">Dcto.</th>
            <th className="font-normal pb-1 w-16 text-right">IVA</th>
            <th className="font-normal pb-1 w-24 text-right">Importe</th>
            <th
              className="font-normal pb-1 w-12 text-center"
              title="Opcional: el cliente decide si la añade al aceptar"
            >
              Opc.
            </th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr
              key={l.id ?? i}
              className={`border-t ${l.opcional && !editable ? "text-muted-foreground" : ""}`}
            >
              <td className="py-1 pr-2">
                {editable ? (
                  <Input
                    className="h-7"
                    value={l.descripcion}
                    onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                  />
                ) : (
                  l.descripcion
                )}
              </td>
              {(["cantidad", "precio_unitario", "descuento_pct", "iva_pct"] as const).map(
                (campo) => (
                  <td key={campo} className="py-1 text-right">
                    {editable ? (
                      <Input
                        className="h-7 text-right"
                        inputMode="decimal"
                        value={String(l[campo])}
                        onChange={(e) => cambiar(i, campo, e.target.value)}
                      />
                    ) : (
                      String(l[campo])
                    )}
                  </td>
                ),
              )}
              <td className="py-1 text-right tabular-nums">
                {dinero(
                  Number(l.cantidad) *
                    Number(l.precio_unitario) *
                    (1 - Number(l.descuento_pct) / 100),
                )}
              </td>
              <td className="py-1 text-center">
                {editable ? (
                  <Checkbox
                    checked={Boolean(l.opcional)}
                    onCheckedChange={(v) => cambiar(i, "opcional", v === true)}
                    aria-label="Línea opcional"
                  />
                ) : l.opcional ? (
                  l.incluida === true ? "elegida" : l.incluida === false ? "no" : "opc."
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLineas((previas) => [...previas, { ...LINEA_VACIA }])}
        >
          + Añadir línea
        </Button>
      )}

      <div className="flex justify-end">
        <div className="w-56 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{dinero(totales.subtotal)}</span>
          </div>
          {totales.descuento > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Descuento</span>
              <span className="tabular-nums">− {dinero(totales.descuento)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">IVA</span>
            <span className="tabular-nums">{dinero(totales.iva)}</span>
          </div>
          <div className="flex justify-between font-medium border-t mt-1 pt-1">
            <span>Total</span>
            <span className="tabular-nums">{dinero(totales.total)}</span>
          </div>
          {lineas.some((l) => l.opcional) && editable && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Sin las opcionales: las suma el cliente si las marca.
            </p>
          )}
        </div>
      </div>

      {editable ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Forma de pago
            <Input
              className="h-8"
              value={pago}
              placeholder="50 % al firmar, 50 % a la entrega"
              onChange={(e) => setPago(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Condiciones
            <Textarea
              className="min-h-8 text-sm"
              rows={2}
              value={condiciones}
              onChange={(e) => setCondiciones(e.target.value)}
            />
          </label>
        </div>
      ) : (
        (p.condiciones_pago || p.condiciones) && (
          <p className="text-xs text-muted-foreground whitespace-pre-line">
            {p.condiciones_pago ? `Forma de pago: ${p.condiciones_pago}\n` : ""}
            {p.condiciones ?? ""}
          </p>
        )
      )}

      {pendiente && (
        <div className="rounded-md border border-dashed p-2 text-sm flex flex-wrap items-center gap-2">
          <span>
            El descuento de {p.aprobacion.descuento_pct} % necesita la firma de{" "}
            {NOMBRE_DE_NIVEL[pendiente]} antes de salir.
            {p.aprobacion_pedida_en ? " Ya se pidió." : ""}
          </span>
          {!p.aprobacion_pedida_en && (
            <Button
              size="sm"
              variant="outline"
              disabled={ocupado}
              onClick={() =>
                hacer(async () => {
                  await editarProforma(p.id, datos());
                  await pedirAprobacion(p.id);
                })
              }
            >
              Pedir firma
            </Button>
          )}
          <Button
            size="sm"
            variant={soyAutor ? "ghost" : "outline"}
            disabled={ocupado}
            onClick={() =>
              hacer(async () => {
                await editarProforma(p.id, datos());
                await aprobarDescuento(p.id);
              })
            }
          >
            Firmar como {usuarioActual() || "…"}
          </Button>
        </div>
      )}
      {editable && !pendiente && p.aprobada_por && p.aprobacion.nivel !== "libre" && (
        <p className="text-xs text-muted-foreground">
          Descuento firmado por {p.aprobada_por}.
        </p>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Correo del cliente
            <Input
              className="h-8 w-56"
              value={correo}
              placeholder="contacto@empresa.com"
              onChange={(e) => setCorreo(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            Vale hasta
            <Input
              className="h-8 w-40"
              type="date"
              value={valida}
              onChange={(e) => setValida(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => hacer(() => editarProforma(p.id, datos()))}
            disabled={ocupado}
          >
            Guardar
          </Button>
          <Button size="sm" onClick={() => enviar("correo")} disabled={ocupado || !!pendiente}>
            {ocupado ? "Enviando…" : "Enviar por correo"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => enviar("whatsapp")}
            disabled={ocupado || !!pendiente}
            title="Abre WhatsApp con el mensaje y el enlace ya escritos"
          >
            Por WhatsApp
          </Button>
        </div>
      )}

      {(enlace || p.estado === "enviada") && (
        <p className="text-xs text-muted-foreground break-all">
          Enlace del cliente:{" "}
          <a
            className="underline"
            href={enlace ?? enlaceDeProforma(p.token)}
            target="_blank"
            rel="noreferrer"
          >
            {enlace ?? enlaceDeProforma(p.token)}
          </a>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" asChild>
          <a href={pdfDeProforma(p.token)} target="_blank" rel="noreferrer">
            PDF
          </a>
        </Button>
        {(p.estado === "enviada" || p.estado === "rechazada") && !hayBorrador && (
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() => hacer(() => nuevaVersion(p.id))}
            title="Copia esta proforma en un borrador para negociar. Al mandarla, ésta queda reemplazada."
          >
            Nueva versión
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => setHistorial(historial ? null : await eventosDe(p.id))}
        >
          {historial ? "Ocultar historial" : "Historial"}
        </Button>
        {!["aceptada", "anulada", "reemplazada"].includes(p.estado) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const motivo = window.prompt("¿Por qué se anula?");
              if (!motivo?.trim()) return;
              await hacer(() => anularProforma(p.id, motivo.trim()));
            }}
          >
            Anular
          </Button>
        )}
      </div>

      {historial && (
        <ol className="text-xs space-y-1 border-l pl-3">
          {historial.length === 0 && <li className="text-muted-foreground">Sin movimientos anotados.</li>}
          {historial.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">
                {new Date(e.ocurrido_en).toLocaleString("es-EC", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>{" "}
              <span className="font-medium">{NOMBRE_DE_EVENTO[e.tipo] ?? e.tipo}</span>
              {e.detalle ? ` · ${e.detalle}` : ""} · {e.autor}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
