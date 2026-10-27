import { useState } from "react";
import { useLogin, useNotify, useRedirect } from "ra-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CambiarClave } from "./Claves";

/**
 * La entrada al CRM: usuario y clave.
 *
 * Sustituye a la pantalla de Atomic, que entra por correo y manda enlaces de
 * Supabase. Aquí las cuentas las da de alta un administrador con una clave
 * provisional, y la primera entrada pide cambiarla antes de dejar pasar: es
 * el segundo paso de esta misma pantalla, para no perder a nadie entre dos
 * rutas.
 *
 * No dice si lo que falló es el usuario o la clave —el servidor tampoco lo
 * dice—: distinguirlo le regala a quien prueba la mitad del trabajo.
 */
export const FirmaPage = () => {
  const login = useLogin();
  const notify = useNotify();
  const redirect = useRedirect();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [provisional, setProvisional] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave) return;
    setEntrando(true);
    try {
      await login({ username: usuario.trim(), password: clave });
    } catch (error: any) {
      if (error?.debeCambiarClave) {
        setProvisional(clave);
      } else {
        notify(error?.message ?? "No se pudo entrar", { type: "error" });
      }
      setEntrando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{provisional ? "Elige tu clave" : "FRIDAY CRM"}</CardTitle>
        </CardHeader>
        <CardContent>
          {provisional ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Entraste con una clave provisional, que ha visto otra persona.
                Elige la tuya para seguir.
              </p>
              <CambiarClave
                actualConocida={provisional}
                onHecho={() => {
                  setProvisional(null);
                  redirect("/");
                  // react-admin recuerda que la comprobación falló; recargar
                  // es la forma corta de que vuelva a preguntar con la sesión
                  // nueva.
                  window.location.reload();
                }}
              />
            </div>
          ) : (
            <form onSubmit={enviar} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="usuario">Usuario</Label>
                <Input
                  id="usuario"
                  value={usuario}
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  onChange={(e) => setUsuario(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="clave">Clave</Label>
                <Input
                  id="clave"
                  type="password"
                  value={clave}
                  autoComplete="current-password"
                  onChange={(e) => setClave(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={entrando || !usuario.trim() || !clave}>
                {entrando ? "Entrando…" : "Entrar"}
              </Button>
              <p className="text-xs text-muted-foreground">
                ¿No tienes cuenta o perdiste la clave? Pídesela a un
                administrador del CRM.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
