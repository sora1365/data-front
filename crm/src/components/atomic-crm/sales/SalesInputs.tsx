import { email, regex, required, useGetIdentity, useRecordContext } from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { TextInput } from "@/components/admin/text-input";

import type { Sale } from "../types";

export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  return (
    <div className="space-y-4 w-full">
      {/* El usuario es la identidad que firma cada fila: se elige al dar de
          alta y no se cambia después. */}
      {!record && (
        <TextInput
          source="usuario"
          label="Usuario"
          validate={[required(), regex(/^[a-z0-9._-]{2,40}$/, "Minúsculas, sin espacios")]}
          helperText="Con el que entra. Minúsculas, sin espacios."
        />
      )}
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
      <TextInput
        source="email"
        validate={[required(), email()]}
        helperText={false}
      />
      <BooleanInput
        source="administrator"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
      <BooleanInput
        source="disabled"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
    </div>
  );
}
