import { useMutation } from "@tanstack/react-query";
import {
  CanAccess,
  Navigate,
  useDataProvider,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { useState } from "react";
import { SimpleForm } from "@/components/admin/simple-form";
import { Button } from "@/components/ui/button";
import { ClaveProvisional } from "../providers/friday/Claves";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { CrmDataProvider } from "../providers/types";
import type { SalesFormData } from "../types";
import { getSalesErrorNotification } from "./salesErrorNotification";
import { SalesInputs } from "./SalesInputs";

export function SalesCreate() {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const translate = useTranslate();
  const redirect = useRedirect();
  const [alta, setAlta] = useState<{ usuario: string; clave: string } | null>(null);

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      return dataProvider.salesCreate(data);
    },
    // FRIDAY no manda correos de bienvenida: el alta devuelve una clave
    // provisional que sólo se puede ver ahora, así que se queda en pantalla en
    // lugar de volver a la lista.
    onSuccess: (creado: any) => {
      setAlta({ usuario: creado.id, clave: creado.claveProvisional });
    },
    onError: (error) => {
      const { message, args } = getSalesErrorNotification(
        error,
        error.message ||
          translate("resources.sales.create.error", {
            _: "An error occurred while creating the user.",
          }),
      );
      notify(message, { type: "error", messageArgs: args });
    },
  });
  const onSubmit: SubmitHandler<SalesFormData> = async (data) => {
    mutate(data);
  };

  return (
    <CanAccess
      resource="sales"
      action="create"
      accessDenied={<Navigate to="/access-denied" />}
    >
      <div className="max-w-lg w-full mx-auto mt-8">
        <Card>
          <CardHeader>
            <CardTitle>
              {translate("resources.sales.create.title", {
                _: "Create a new user",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alta ? (
              <div className="flex flex-col gap-4">
                <ClaveProvisional usuario={alta.usuario} clave={alta.clave} />
                <Button type="button" onClick={() => redirect("/sales")}>
                  Ya la tengo, volver a la lista
                </Button>
              </div>
            ) : (
              <SimpleForm onSubmit={onSubmit as SubmitHandler<any>}>
                <SalesInputs />
              </SimpleForm>
            )}
          </CardContent>
        </Card>
      </div>
    </CanAccess>
  );
}
