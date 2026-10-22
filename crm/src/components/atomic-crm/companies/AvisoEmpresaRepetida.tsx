import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useNotify, useRecordContext } from "ra-core";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Company } from "../types";
import { buscarCoincidencias, type Coincidencia } from "../providers/friday/coincidencias";

/**
 * Avisa si la empresa que se está escribiendo ya existe.
 *
 * Mira en dos sitios y los trata distinto, porque no son el mismo problema:
 *
 * - **Ya es ficha del CRM**: crear otra parte en dos el historial del cliente y
 *   deja a dos comerciales trabajándolo sin verse. Se ofrece abrir la que hay.
 * - **Está en el padrón de FRIDAY**: no hay ficha todavía. Enlazarla rellena
 *   los datos y, sobre todo, le da al CRM la actividad, los balances y el
 *   estado comercial que el gestor comercial ya calculó.
 *
 * Avisa, no bloquea: dos empresas pueden llamarse parecido y ser distintas, y
 * cortar el alta por un parecido deja a alguien sin poder registrar a su
 * cliente, que es peor que un duplicado.
 */
export const AvisoEmpresaRepetida = () => {
  const { setValue } = useFormContext();
  const record = useRecordContext<Company>();
  const notify = useNotify();

  const nombre = useWatch({ name: "name" });
  const ruc = useWatch({ name: "tax_identifier" });
  const enlazada = useWatch({ name: "clave" });

  const [coincidencias, setCoincidencias] = useState<Coincidencia[]>([]);
  const [descartado, setDescartado] = useState(false);
  const ultimaBusqueda = useRef("");

  useEffect(() => {
    const clave = `${nombre ?? ""}|${ruc ?? ""}`;
    if (clave === ultimaBusqueda.current) return;

    // Se espera a que deje de teclear. Sin esto hay una consulta por letra
    // contra una tabla de 7,1 millones de filas.
    const temporizador = setTimeout(async () => {
      ultimaBusqueda.current = clave;
      try {
        setCoincidencias(
          await buscarCoincidencias({
            nombre,
            ruc,
            excluir: record?.id ? String(record.id) : undefined,
          }),
        );
      } catch {
        // Que falle la comprobación no puede impedir guardar la empresa: es
        // una ayuda, no un requisito.
        setCoincidencias([]);
      }
    }, 500);

    return () => clearTimeout(temporizador);
  }, [nombre, ruc, record?.id]);

  // Si ya está enlazada a un sujeto, la sugerencia sobra.
  if (enlazada || descartado || coincidencias.length === 0) return null;

  const enElCrm = coincidencias.filter((c) => c.origen === "crm");
  const enElPadron = coincidencias.filter((c) => c.origen === "padron" && !c.ya_enlazada);

  if (enElCrm.length === 0 && enElPadron.length === 0) return null;

  const enlazar = (c: Coincidencia) => {
    setValue("tipo_sujeto", c.tipo_sujeto, { shouldDirty: true });
    setValue("clave", c.clave, { shouldDirty: true });
    // El nombre y el RUC sí se pisan: enlazar es decir «esta empresa es
    // aquella», y los de la Superintendencia son los legales. Quien escribió
    // «FORTEAUDIT» a medias quiere que quede «FORTEAUDIT & CONSULTING S.A.S.»,
    // que es con lo que se le factura.
    setValue("name", c.name, { shouldDirty: true });
    if (c.tax_identifier) setValue("tax_identifier", c.tax_identifier, { shouldDirty: true });
    if (c.sector) setValue("sector", c.sector, { shouldDirty: true });
    if (c.city) setValue("city", c.city, { shouldDirty: true });
    setValue("country", "Ecuador", { shouldDirty: true });
    notify("Empresa enlazada con el padrón de FRIDAY", { type: "info" });
  };

  return (
    <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <AlertTitle>
        {enElCrm.length > 0 ? "Puede que ya exista" : "Está en la base de FRIDAY"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        {enElCrm.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Ya hay una ficha en el CRM que se parece. Si es la misma empresa,
              trabájala ahí en vez de crear otra.
            </p>
            {enElCrm.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <strong>{c.name}</strong>
                  {c.tax_identifier && <> · {c.tax_identifier}</>}
                  {c.motivo === "ruc" && <> · mismo RUC</>}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/companies/${c.id}/show`}>Abrir</Link>
                </Button>
              </div>
            ))}
          </div>
        )}

        {enElPadron.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              FRIDAY ya sabe de esta empresa. Si la enlazas, el CRM verá su
              actividad, sus balances y su estado comercial.
            </p>
            {enElPadron.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <strong>{c.name}</strong>
                  {c.tax_identifier && <> · {c.tax_identifier}</>}
                  {c.city && <> · {c.city}</>}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => enlazar(c)}>
                  Enlazar
                </Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDescartado(true)}>
            No es ninguna de estas
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};
