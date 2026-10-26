import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ventaCruzada,
  type ClienteParaCruzar,
  type SugerenciaDeCruce,
} from "../providers/friday/postventa";
import { abrirDesdeLista, anotarGestion } from "../providers/friday/listas";
import { dinero } from "../providers/friday/proformas";

/**
 * Qué más venderle a quien ya es cliente.
 *
 * Es la venta más fácil que hay y la que menos se hace: la segunda a quien ya
 * dijo que sí una vez. Cada sugerencia dice **por qué** está ahí —porque el
 * gestor la propone para esa empresa, porque la vende la marca que ya le
 * factura, o porque está en el catálogo—, que es lo que separa esto de una
 * lista mágica que nadie se cree.
 */
export const VentaCruzada = () => {
  const [clientes, setClientes] = useState<ClienteParaCruzar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      setClientes(await ventaCruzada(25));
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

  /**
   * Abrir y descartar quitan la sugerencia sin recargar la lista entera.
   *
   * Recargar reordenaría a los clientes debajo del cursor de quien está
   * trabajando la lista, que es como se acaba ofreciendo dos veces lo mismo.
   */
  const quitar = (empresa: string, producto: string) =>
    setClientes((previos) =>
      previos
        .map((c) =>
          c.company_id === empresa
            ? { ...c, sugerencias: c.sugerencias.filter((s) => s.codigo !== producto) }
            : c,
        )
        .filter((c) => c.sugerencias.length > 0),
    );

  const abrir = async (cliente: ClienteParaCruzar, s: SugerenciaDeCruce) => {
    if (!cliente.tipo_sujeto || !cliente.clave) {
      setError(
        `${cliente.razon_social} no está enlazada al padrón; ábrele la oportunidad desde su ficha.`,
      );
      return;
    }
    quitar(cliente.company_id, s.codigo);
    try {
      await abrirDesdeLista({
        tipoSujeto: cliente.tipo_sujeto,
        clave: cliente.clave,
        producto: s.codigo,
        marca: s.marca ?? cliente.marcas[0],
        nota: `Venta cruzada · ${s.motivo}`,
      });
    } catch (e: any) {
      setError(e.message);
      await cargar();
    }
  };

  const descartar = async (cliente: ClienteParaCruzar, s: SugerenciaDeCruce) => {
    if (!cliente.tipo_sujeto || !cliente.clave) {
      quitar(cliente.company_id, s.codigo);
      return;
    }
    quitar(cliente.company_id, s.codigo);
    try {
      // Se anota como gestión del producto, no del cliente: «no le interesa la
      // auditoría» no quiere decir que no haya que volver a llamarle nunca.
      await anotarGestion({
        tipoSujeto: cliente.tipo_sujeto,
        clave: cliente.clave,
        resultado: "no_interesa",
        producto: s.codigo,
        nota: "Descartado desde venta cruzada",
      });
    } catch (e: any) {
      setError(e.message);
      await cargar();
    }
  };

  return (
    <section className="border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-2">
        Qué más venderle a quien ya es cliente
      </p>

      {error && <p className="text-sm text-destructive mb-2">{error}</p>}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : clientes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay nada que cruzar: o no hay clientes todavía, o a los que hay ya
          se les vende todo el catálogo.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {clientes.map((c) => (
            <div key={c.company_id} className="border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{c.razon_social}</span>
                <span className="text-xs text-muted-foreground">
                  {dinero(c.facturado)} en {c.ventas} venta(s) ·{" "}
                  {c.marcas.filter(Boolean).join(", ")}
                </span>
              </div>

              <div className="mt-1 flex flex-col gap-1">
                {c.sugerencias.map((s) => (
                  <div
                    key={s.codigo}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm">{s.nombre}</span>
                      {/*
                        Que sea de otra marca se dice: es la venta cruzada de
                        verdad, y también el aviso de que la factura la emite
                        otra empresa del grupo.
                      */}
                      {s.otraMarca && (
                        <Badge variant="outline" className="font-normal">
                          {s.marca_nombre ?? s.marca}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground truncate">
                        {s.motivo}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => abrir(c, s)}>
                        Abrir oportunidad
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => descartar(c, s)}>
                        No le interesa
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
