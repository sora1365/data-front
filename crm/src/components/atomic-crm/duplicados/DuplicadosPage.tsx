import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buscarDuplicados,
  fusionar,
  fusiones,
  NOMBRE_DE_MOTIVO,
  noSonLaMisma,
  type FichaDuplicada,
  type Fusion,
  type ParDuplicado,
  type TipoDuplicado,
} from "../providers/friday/duplicados";

/**
 * Duplicados: el mismo cliente en dos fichas.
 *
 * Primero las empresas, porque una empresa duplicada arrastra a sus contactos y
 * a sus ventas; juntándolas antes, muchos contactos duplicados aparecen ya en
 * la misma empresa y se ven más claros.
 *
 * Fusionar borra una ficha, así que pide confirmación con el nombre de la que
 * desaparece. Lo suyo —notas, tareas, ventas, conversaciones, tickets— pasa a
 * la que se queda, y la borrada queda guardada en el historial de fusiones.
 */
export const DuplicadosPage = () => {
  const [datos, setDatos] = useState<{ contactos: ParDuplicado[]; empresas: ParDuplicado[] } | null>(null);
  const [historial, setHistorial] = useState<Fusion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([buscarDuplicados(), fusiones()]);
      setDatos(d);
      setHistorial(h);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const hacer = async (accion: () => Promise<unknown>, mensaje: string) => {
    try {
      await accion();
      setAviso(mensaje);
      setError(null);
      await cargar();
    } catch (e: any) {
      setError(e.message);
      setAviso(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <header>
        <h1 className="text-xl font-semibold">Duplicados</h1>
        <p className="text-sm text-muted-foreground">
          Clientes que están en dos fichas. Al fusionar, todo lo de una pasa a la otra.
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

      {!datos ? (
        <p className="text-sm text-muted-foreground">Buscando…</p>
      ) : (
        <>
          <Seccion
            titulo="Empresas"
            tipo="empresa"
            pares={datos.empresas}
            hacer={hacer}
          />
          <Seccion
            titulo="Contactos"
            tipo="contacto"
            pares={datos.contactos}
            hacer={hacer}
          />
        </>
      )}

      {historial.length > 0 && (
        <section className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2">Fusiones recientes</p>
          <ul className="text-sm flex flex-col gap-1">
            {historial.slice(0, 15).map((f) => (
              <li key={f.id} className="text-muted-foreground">
                {new Date(f.en).toLocaleDateString("es-EC")} · {f.autor} juntó «{f.perdedor_nombre}» en{" "}
                <Link
                  className="underline"
                  to={f.tipo === "empresa" ? `/companies/${f.ganador}/show` : `/contacts/${f.ganador}/show`}
                >
                  la {f.tipo} #{f.ganador}
                </Link>
                {Object.keys(f.movidos).length > 0 &&
                  ` · movió ${Object.values(f.movidos).reduce((a, b) => a + b, 0)} registro(s)`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

DuplicadosPage.path = "/duplicados";

const total = (f: FichaDuplicada) => Object.values(f.relacionados).reduce((a, b) => a + b, 0);

const Seccion = ({
  titulo,
  tipo,
  pares,
  hacer,
}: {
  titulo: string;
  tipo: TipoDuplicado;
  pares: ParDuplicado[];
  hacer: (accion: () => Promise<unknown>, mensaje: string) => Promise<void>;
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="font-medium">
      {titulo} <span className="text-muted-foreground text-sm">({pares.length})</span>
    </h2>
    {pares.length === 0 ? (
      <p className="text-sm text-muted-foreground border rounded-lg p-3">
        {tipo === "empresa"
          ? "No hay empresas que parezcan repetidas."
          : "No hay contactos que parezcan repetidos."}
      </p>
    ) : (
      pares.map((p) => (
        <ParDeFichas key={`${p.a.id}-${p.b.id}`} tipo={tipo} par={p} hacer={hacer} />
      ))
    )}
  </section>
);

const ParDeFichas = ({
  tipo,
  par,
  hacer,
}: {
  tipo: TipoDuplicado;
  par: ParDuplicado;
  hacer: (accion: () => Promise<unknown>, mensaje: string) => Promise<void>;
}) => {
  // La que se sugiere conservar: la que tiene más historia colgando. Es la
  // que menos se mueve al fusionar, y casi siempre la que la gente conoce.
  const sugerida = total(par.b) > total(par.a) ? par.b.id : par.a.id;
  const [confirmando, setConfirmando] = useState<number | null>(null);

  const quedarse = (ganadora: FichaDuplicada, perdedora: FichaDuplicada) =>
    confirmando === ganadora.id ? (
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="destructive"
          onClick={() =>
            hacer(
              () => fusionar(tipo, ganadora.id, perdedora.id),
              `«${perdedora.nombre}» quedó dentro de «${ganadora.nombre}».`,
            )
          }
        >
          Sí: «{perdedora.nombre}» desaparece
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
          Cancelar
        </Button>
      </div>
    ) : (
      <Button
        size="sm"
        variant={ganadora.id === sugerida ? "default" : "outline"}
        onClick={() => setConfirmando(ganadora.id)}
      >
        Quedarse con esta
      </Button>
    );

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {par.motivos.map((m) => (
          <Badge key={m} variant="secondary">
            {NOMBRE_DE_MOTIVO[m]}
          </Badge>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            hacer(() => noSonLaMisma(tipo, par.a.id, par.b.id), "No se volverán a proponer juntas.")
          }
        >
          No son la misma
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          [par.a, par.b],
          [par.b, par.a],
        ].map(([f, otra]) => (
          <div
            key={f.id}
            className={`rounded border p-3 flex flex-col gap-2 ${f.id === sugerida ? "border-primary" : ""}`}
          >
            <Ficha tipo={tipo} f={f} />
            {quedarse(f, otra)}
          </div>
        ))}
      </div>
    </div>
  );
};

const Ficha = ({ tipo, f }: { tipo: TipoDuplicado; f: FichaDuplicada }) => {
  const enlace = tipo === "empresa" ? `/companies/${f.id}/show` : `/contacts/${f.id}/show`;
  const relacionados = Object.entries(f.relacionados).filter(([, n]) => n > 0);
  return (
    <div className="text-sm flex flex-col gap-0.5">
      <Link to={enlace} className="font-medium underline-offset-2 hover:underline">
        {f.nombre || "(sin nombre)"} <span className="text-muted-foreground">#{f.id}</span>
      </Link>
      {tipo === "empresa" ? (
        <>
          {f.ruc && <span>RUC {f.ruc}</span>}
          {(f.ciudad || f.sector) && (
            <span className="text-muted-foreground">{[f.ciudad, f.sector].filter(Boolean).join(" · ")}</span>
          )}
          {f.enlazada_al_padron && <span className="text-xs text-emerald-700">Enlazada al padrón</span>}
        </>
      ) : (
        <>
          {(f.cargo || f.empresa) && (
            <span className="text-muted-foreground">{[f.cargo, f.empresa].filter(Boolean).join(" · ")}</span>
          )}
          {f.correos?.map((c) => <span key={c}>{c}</span>)}
          {f.telefonos?.map((t) => <span key={t}>{t}</span>)}
        </>
      )}
      <span className="text-xs text-muted-foreground mt-1">
        {relacionados.length
          ? relacionados.map(([t, n]) => `${n} ${t}`).join(" · ")
          : "Nada colgando de esta ficha"}
      </span>
    </div>
  );
};
