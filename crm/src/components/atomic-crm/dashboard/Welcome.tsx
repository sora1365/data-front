import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * El aviso de la portada.
 *
 * Mientras el CRM corre contra el API simulado hay que decirlo donde se vea: en
 * modo demo los datos se inventan y se pierden al recargar, y alguien acabaría
 * apuntando ahí una llamada de verdad. El crédito a Atomic CRM se mantiene
 * porque este módulo está construido sobre su código.
 */
export const Welcome = () => (
  <Card>
    <CardHeader className="px-4">
      <CardTitle>FRIDAY CRM</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-sm mb-4">
        Aquí se trabaja lo que pasa <strong>después</strong> de la llamada: con
        quién se habló, qué se le ofreció, por cuánto y en qué va.
      </p>
      <p className="text-sm mb-4">
        Los prospectos llegan del <strong>gestor comercial</strong>, que es
        quien dice a quién llamar, y las ventas ganadas pasan al{" "}
        <strong>módulo contable</strong> para facturarse.
      </p>
      <p className="text-sm mb-4 text-amber-700 dark:text-amber-500">
        Ahora mismo corre sobre datos de prueba: lo que escribas aquí es
        inventado y se borra al recargar la página.
      </p>
      <p className="text-sm text-muted-foreground">
        Construido sobre{" "}
        <a
          href="https://github.com/marmelab/atomic-crm"
          className="underline hover:no-underline"
        >
          Atomic CRM
        </a>{" "}
        de Marmelab.
      </p>
    </CardContent>
  </Card>
);
