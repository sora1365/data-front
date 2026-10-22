import { useState } from "react";
import { useLogin, useNotify } from "ra-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * La entrada al CRM.
 *
 * Sustituye a la pantalla de acceso de Atomic, que pide correo y contraseña.
 * FRIDAY no tiene ni lo uno ni lo otro: lo que guarda de cada cambio es quién
 * lo hizo, en la cabecera `X-Usuario`. Pedir una contraseña que no se
 * comprueba contra nada sería aparentar una seguridad inexistente, y la
 * primera persona que la escriba creerá que su cuenta está protegida.
 *
 * Así que esto pide lo único que se usa de verdad —el nombre— y dice para qué
 * sirve.
 */
export const FirmaPage = () => {
  const login = useLogin();
  const notify = useNotify();
  const [nombre, setNombre] = useState("");
  const [entrando, setEntrando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    setEntrando(true);
    try {
      await login({ username: nombre.trim() });
    } catch (error: any) {
      notify(error?.message ?? "No se pudo entrar", { type: "error" });
      setEntrando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>FRIDAY CRM</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nombre">Tu nombre</Label>
              <Input
                id="nombre"
                value={nombre}
                autoFocus
                placeholder="Como quieres que aparezca"
                onChange={(e) => setNombre(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Todo lo que hagas queda firmado con este nombre. Todavía no hay
                contraseñas: esto identifica, no protege.
              </p>
            </div>
            <Button type="submit" disabled={entrando || !nombre.trim()}>
              {entrando ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
