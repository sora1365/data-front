import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  descargarExportacion,
  historialDeExportaciones,
  verificarExportacion,
  type Exportacion,
  type Verificacion,
} from "../providers/friday/exportacion";

const tamano = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Exportar todo el CRM, y comprobar después que un archivo está entero.
 *
 * La exportación es un ZIP con un CSV por tabla y un manifiesto con la huella
 * de cada una. Queda anotada aquí: un archivo con todos los clientes se puede
 * llevar a cualquier parte, y saber quién lo sacó y cuándo es lo mínimo.
 */
export const ExportacionPage = () => {
  const [historial, setHistorial] = useState<Exportacion[]>([]);
  const [exportando, setExportando] = useState(false);
  const [verificacion, setVerificacion] = useState<Verificacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(() => {
    historialDeExportaciones().then(setHistorial).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const exportar = async () => {
    setExportando(true);
    setError(null);
    try {
      const { nombre } = await descargarExportacion();
      setAviso(`Descargado ${nombre}. Queda anotado abajo.`);
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExportando(false);
    }
  };

  const verificar = async (archivo?: File) => {
    if (!archivo) return;
    setVerificacion(null);
    setError(null);
    try {
      setVerificacion(await verificarExportacion(archivo));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-1 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold">Exportar datos</h1>
        <p className="text-sm text-muted-foreground">
          Todo el CRM en un archivo: un CSV por tabla y un manifiesto con lo que lleva y
          su huella, para poder comprobar después que nadie lo tocó.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {aviso && (
        <Alert>
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      <section className="border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="font-medium">Exportación completa</h2>
        <p className="text-sm text-muted-foreground">
          Se leen todas las tablas en el mismo instante, así que el archivo es coherente aunque
          alguien esté trabajando. No lleva las llaves de los enlaces públicos (proformas,
          encuestas, bajas de correo): son credenciales, no datos, y el manifiesto dice cuáles
          faltan.
        </p>
        <div>
          <Button onClick={exportar} disabled={exportando}>
            {exportando ? "Preparando…" : "Descargar exportación"}
          </Button>
        </div>
      </section>

      <section className="border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="font-medium">Verificar un archivo</h2>
        <p className="text-sm text-muted-foreground">
          Sube un ZIP exportado para saber si está entero y si salió de este CRM.
        </p>
        <input
          type="file"
          accept=".zip,application/zip"
          className="text-sm"
          onChange={(e) => verificar(e.target.files?.[0])}
        />
        {verificacion && (
          <div
            className={`rounded border p-3 text-sm flex flex-col gap-1 ${
              verificacion.valido ? "border-emerald-500" : "border-destructive"
            }`}
          >
            <p className="font-medium">
              {verificacion.valido ? "Está entero." : "No está como se exportó."}
            </p>
            <p className="text-muted-foreground">
              {verificacion.tablas} tablas, {verificacion.filas} filas · exportado el{" "}
              {new Date(verificacion.generado_en).toLocaleString("es-EC")} por {verificacion.por}
            </p>
            <p className="text-muted-foreground">
              {verificacion.registrada
                ? `Salió de aquí: es la exportación #${verificacion.registrada.id}.`
                : "No consta que haya salido de este CRM (puede ser de otro entorno)."}
            </p>
            {verificacion.problemas.length > 0 && (
              <ul className="list-disc pl-5 text-destructive">
                {verificacion.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-2">Exportaciones anteriores</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha exportado nada.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {historial.map((x) => (
                <tr key={x.id} className="border-t align-top">
                  <td className="py-1 pr-2">#{x.id}</td>
                  <td className="py-1 pr-2">{new Date(x.en).toLocaleString("es-EC")}</td>
                  <td className="py-1 pr-2">{x.por}</td>
                  <td className="py-1 pr-2 text-muted-foreground">
                    {x.tablas} tablas · {x.filas} filas · {tamano(Number(x.bytes))}
                  </td>
                  <td className="py-1 font-mono text-[11px] text-muted-foreground" title={x.sha256}>
                    {x.sha256.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

ExportacionPage.path = "/exportar";
