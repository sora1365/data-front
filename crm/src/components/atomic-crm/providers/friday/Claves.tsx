import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fijarSesion, pedirAuth, type SesionCrm } from "./dataProvider";

/**
 * Cambiar la propia clave.
 *
 * Sirve para las dos situaciones: la primera entrada con la clave provisional
 * que puso un administrador, y el cambio voluntario desde el perfil. Pide la
 * actual también en el segundo caso: un ordenador que se deja abierto no
 * debería bastar para quedarse con la cuenta.
 *
 * Al cambiarla el servidor cierra las demás sesiones y devuelve una nueva para
 * esta, que se guarda aquí; sin eso, quien cambia la clave se echaría a sí
 * mismo.
 */
export const CambiarClave = ({
  actualConocida,
  onHecho,
}: {
  /** La provisional recién escrita, para no pedirla dos veces seguidas. */
  actualConocida?: string;
  onHecho: (sesion: SesionCrm) => void;
}) => {
  const [actual, setActual] = useState(actualConocida ?? "");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nueva !== repetida) {
      setError("Las dos claves nuevas no coinciden.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const sesion: SesionCrm = await pedirAuth("/clave", { actual, nueva });
      fijarSesion(sesion);
      onHecho(sesion);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cambiar la clave.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {actualConocida === undefined && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="clave-actual">Clave actual</Label>
          <Input
            id="clave-actual"
            type="password"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="clave-nueva">Clave nueva</Label>
        <Input
          id="clave-nueva"
          type="password"
          autoComplete="new-password"
          autoFocus={actualConocida !== undefined}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Al menos 10 caracteres. Una frase que recuerdes vale más que una
          palabra con símbolos.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clave-repetida">Repite la clave nueva</Label>
        <Input
          id="clave-repetida"
          type="password"
          autoComplete="new-password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={guardando || !actual || !nueva || !repetida}>
        {guardando ? "Guardando…" : "Cambiar clave"}
      </Button>
    </form>
  );
};

/**
 * Una clave provisional recién generada.
 *
 * Se ve una sola vez: el servidor no la guarda en claro. Por eso se enseña
 * grande, con botón de copiar y diciendo qué pasa después, en vez de una
 * notificación que desaparece a los cuatro segundos.
 */
export const ClaveProvisional = ({ usuario, clave }: { usuario: string; clave: string }) => {
  const [copiada, setCopiada] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
    } catch {
      /* sin portapapeles: queda a la vista para copiarla a mano */
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <p className="text-sm">
        Clave provisional de <strong>{usuario}</strong>:
      </p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-muted px-3 py-2 text-lg tracking-wider">{clave}</code>
        <Button type="button" variant="outline" size="icon" onClick={copiar} aria-label="Copiar">
          {copiada ? <Check /> : <Copy />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Pásasela por un canal distinto del correo donde va su usuario. No se
        vuelve a mostrar: si se pierde, genera otra. Al entrar se le pedirá
        cambiarla.
      </p>
    </div>
  );
};
