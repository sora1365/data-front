/** Una cifra con su título y lo que significa. Sin el pie, cada quien supone el suyo. */
export const Cifra = ({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) => (
  <div className="border rounded-lg p-3">
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    <p className="text-[11px] text-muted-foreground">{pie}</p>
  </div>
);
