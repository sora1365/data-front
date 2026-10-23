import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Cotizar } from "./Cotizar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  anularProforma,
  crearProforma,
  dinero,
  editarProforma,
  enlaceDeProforma,
  enviarProforma,
  NOMBRE_DE_ESTADO,
  proformasDe,
  totalesDe,
  type LineaDeProforma,
  type Proforma,
} from "../providers/friday/proformas";

/**
 * Las proformas de la venta.
 *
 * Una proforma en borrador se edita aquí mismo —líneas, cantidades,
 * descuentos— y al enviarla deja de tocarse: el cliente tiene en la mano un
 * documento con ese número, y cambiarle los precios por detrás es perder la
 * discusión sobre lo que se acordó. Para cambiarla se hace otra.
 */
export const Proformas = ({ dealId }: { dealId: string | number }) => {
  const [proformas, setProformas] = useState<Proforma[]>([]);
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
        const nueva = await crearProforma(dealId);
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
  }, [cargar]);

  const crear = async () => {
    setOcupado(true);
    setError(null);
    try {
      await crearProforma(dealId);
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
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground tracking-wide">Proformas</span>
        {/*
          Con un borrador abierto no se ofrece otro: dos borradores de la misma
          venta terminan enviándose los dos, y el cliente recibe dos precios.
        */}
        {!hayBorrador && (
          <Button size="sm" variant="outline" onClick={crear} disabled={ocupado}>
            {ocupado ? "Creando…" : "Nueva proforma"}
          </Button>
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
        <Ficha key={p.id} proforma={p} alCambiar={cargar} />
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
};

const Ficha = ({
  proforma: p,
  alCambiar,
}: {
  proforma: Proforma;
  alCambiar: () => Promise<void>;
}) => {
  const editable = p.estado === "borrador";
  const [lineas, setLineas] = useState<LineaDeProforma[]>(p.lineas);
  const [correo, setCorreo] = useState(p.correo ?? "");
  const [valida, setValida] = useState(p.valida_hasta);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enlace, setEnlace] = useState<string | null>(null);

  useEffect(() => {
    setLineas(p.lineas);
    setCorreo(p.correo ?? "");
    setValida(p.valida_hasta);
  }, [p]);

  const totales = editable ? totalesDe(lineas) : p;

  const cambiar = (i: number, campo: keyof LineaDeProforma, valor: string) =>
    setLineas((previas) =>
      previas.map((l, j) =>
        j === i
          ? { ...l, [campo]: campo === "descripcion" ? valor : Number(valor || 0) }
          : l,
      ),
    );

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await editarProforma(p.id, { lineas, correo, valida_hasta: valida });
      await alCambiar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    setOcupado(true);
    setError(null);
    try {
      // Se guarda antes de mandar: enviar lo que está en la pantalla y no lo
      // último guardado evita el caso de corregir un precio y mandar el viejo.
      await editarProforma(p.id, { lineas, correo, valida_hasta: valida });
      const enviada = await enviarProforma(p.id);
      setEnlace(enviada.enlace);
      await alCambiar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

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
          {p.aceptada_por ? ` · ${p.aceptada_por}` : ""}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">Detalle</th>
            <th className="font-normal pb-1 w-16 text-right">Cant.</th>
            <th className="font-normal pb-1 w-24 text-right">P. unit.</th>
            <th className="font-normal pb-1 w-16 text-right">Dcto.</th>
            <th className="font-normal pb-1 w-16 text-right">IVA</th>
            <th className="font-normal pb-1 w-24 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={l.id ?? i} className="border-t">
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
            </tr>
          ))}
        </tbody>
      </table>

      {editable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setLineas((previas) => [
              ...previas,
              {
                producto: null,
                descripcion: "",
                cantidad: 1,
                precio_unitario: 0,
                descuento_pct: 0,
                iva_pct: 15,
              },
            ])
          }
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
        </div>
      </div>

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
          <Button size="sm" variant="outline" onClick={guardar} disabled={ocupado}>
            Guardar
          </Button>
          <Button size="sm" onClick={enviar} disabled={ocupado}>
            {ocupado ? "Enviando…" : "Enviar al cliente"}
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

      {p.estado !== "aceptada" && p.estado !== "anulada" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const motivo = window.prompt("¿Por qué se anula?");
            if (!motivo?.trim()) return;
            await anularProforma(p.id, motivo.trim());
            await alCambiar();
          }}
        >
          Anular
        </Button>
      )}
    </div>
  );
};
