import { useMutation } from "@tanstack/react-query";
import {
  useDataProvider,
  useEditController,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { SimpleForm } from "@/components/admin/simple-form";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { Card, CardContent } from "@/components/ui/card";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CrmDataProvider } from "../providers/types";
import type { FridayDataProvider } from "../providers/friday";
import { ClaveProvisional } from "../providers/friday/Claves";
import type { Sale, SalesFormData } from "../types";
import { getSalesErrorNotification } from "./salesErrorNotification";
import { SalesInputs } from "./SalesInputs";

function EditToolbar() {
  return (
    <div className="flex justify-end gap-4">
      <CancelButton />
      <SaveButton />
    </div>
  );
}

export function SalesEdit() {
  const { record } = useEditController();

  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("resources.sales.edit.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(record.id, data);
    },
    onSuccess: () => {
      redirect("/sales");
      notify("resources.sales.edit.success", {
        messageArgs: {
          _: "User updated successfully",
        },
      });
    },
    onError: (error) => {
      const { message, args } = getSalesErrorNotification(
        error,
        "resources.sales.edit.error",
      );
      notify(message, {
        type: "error",
        messageArgs: { ...args, _: "An error occurred. Please try again." },
      });
    },
  });

  const onSubmit: SubmitHandler<SalesFormData> = async (data) => {
    mutate(data);
  };

  return (
    <div className="max-w-lg w-full mx-auto mt-8">
      <Card>
        <CardContent>
          <SimpleForm
            toolbar={<EditToolbar />}
            onSubmit={onSubmit as SubmitHandler<any>}
            record={record}
          >
            <SaleEditTitle />
            <SalesInputs />
          </SimpleForm>
        </CardContent>
      </Card>
      {record && <RestablecerClave usuario={String(record.id)} />}
    </div>
  );
}

/**
 * Clave provisional nueva para alguien que no puede entrar. Cierra las
 * sesiones que tuviera abiertas: restablecer es lo que se hace cuando alguien
 * cree que su cuenta está comprometida.
 */
const RestablecerClave = ({ usuario }: { usuario: string }) => {
  const dataProvider = useDataProvider<FridayDataProvider>();
  const notify = useNotify();
  const [clave, setClave] = useState<string | null>(null);
  const { mutate, isPending } = useMutation({
    mutationFn: () => dataProvider.restablecerClave(usuario),
    onSuccess: setClave,
    onError: (e: Error) => notify(e.message, { type: "error" }),
  });
  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col gap-3">
        <h3 className="font-semibold">Clave</h3>
        {clave ? (
          <ClaveProvisional usuario={usuario} clave={clave} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Genera una clave provisional y cierra las sesiones abiertas de esta
              persona. Al entrar se le pedirá elegir la suya.
            </p>
            <div>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => mutate()}>
                Restablecer clave
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const SaleEditTitle = () => {
  const record = useRecordContext<Sale>();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <h2 className="text-lg font-semibold mb-4">
      {translate("resources.sales.edit.title", {
        name: `${record.first_name} ${record.last_name}`,
      })}
    </h2>
  );
};
