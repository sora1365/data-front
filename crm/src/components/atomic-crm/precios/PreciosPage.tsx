import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calcularCotizacion,
  guardarCotizador,
  listarCotizadores,
  NOMBRE_DE_MODO,
  NOMBRE_DE_PERIODICIDAD,
  type Calculo,
  type Cotizador,
  type TareaDeCotizador,
  type VariableDeCotizador,
  estadoDelContable,
  listarArticulos,
  listarPerfiles,
  type Articulo,
  type EstadoDelContable,
  type PerfilDeNomina,
} from "../providers/friday/cotizadores";
import {
  dinero,
  listaDePrecios,
  ponerPrecio,
  type PrecioDeProducto,
} from "../providers/friday/proformas";

/**
 * Precios y cotizadores.
 *
 * Dos formas de poner un número, porque hay dos clases de servicio. Lo que
 * siempre vale lo mismo tiene precio de lista. Lo que depende de la empresa
 * —un outsourcing contable— se calcula: tareas, tiempos, costo por hora y
 * margen. Antes esa cuenta vivía en una hoja aparte, y seis meses después
 * nadie podía decir por qué un cliente paga 480 y el de al lado 700.
 */
export const PreciosPage = () => {
  const [pestana, setPestana] = useState<"lista" | "cotizadores" | "inventario">("lista");

  return (
    <div className="flex flex-col gap-4 p-1">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Precios</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={pestana === "lista" ? "default" : "outline"}
            onClick={() => setPestana("lista")}
          >
            Lista de precios
          </Button>
          <Button
            size="sm"
            variant={pestana === "cotizadores" ? "default" : "outline"}
            onClick={() => setPestana("cotizadores")}
          >
            Cotizadores
          </Button>
          <Button
            size="sm"
            variant={pestana === "inventario" ? "default" : "outline"}
            onClick={() => setPestana("inventario")}
          >
            Inventario
          </Button>
        </div>
      </header>

      {pestana === "lista" ? (
        <ListaDePrecios />
      ) : pestana === "cotizadores" ? (
        <Cotizadores />
      ) : (
        <Inventario />
      )}
    </div>
  );
};

PreciosPage.path = "/precios";

// --------------------------------------------------------------- lista

const ListaDePrecios = () => {
  const [filas, setFilas] = useState<PrecioDeProducto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [precio, setPrecio] = useState("");
  const [iva, setIva] = useState("15");

  const cargar = useCallback(async () => {
    try {
      setFilas(await listaDePrecios());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async (producto: string) => {
    try {
      await ponerPrecio({ producto, precio: Number(precio), iva: Number(iva) });
      setEditando(null);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-2">
        El precio de lista es el que se pone solo al crear una proforma. Se
        congela en la línea: subirlo mañana no cambia lo ofrecido hoy.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left">
            <th className="font-normal pb-1">Producto</th>
            <th className="font-normal pb-1 text-right w-32">Precio</th>
            <th className="font-normal pb-1 text-right w-24">IVA</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.codigo} className="border-t">
              <td className="py-1 pr-2">{f.nombre}</td>
              <td className="py-1 text-right tabular-nums">
                {editando === f.codigo ? (
                  <Input
                    className="h-7 text-right"
                    autoFocus
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && guardar(f.codigo)}
                  />
                ) : f.precio === null ? (
                  <span className="text-muted-foreground">sin precio</span>
                ) : (
                  dinero(f.precio)
                )}
              </td>
              <td className="py-1 text-right tabular-nums">
                {editando === f.codigo ? (
                  <Input
                    className="h-7 text-right"
                    value={iva}
                    onChange={(e) => setIva(e.target.value)}
                  />
                ) : f.iva === null ? (
                  "—"
                ) : (
                  `${f.iva}%`
                )}
              </td>
              <td className="py-1 text-right">
                {editando === f.codigo ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => guardar(f.codigo)}>
                      Guardar
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditando(f.codigo);
                      setPrecio(f.precio === null ? "" : String(f.precio));
                      setIva(f.iva === null ? "15" : String(f.iva));
                    }}
                  >
                    {f.precio === null ? "Poner precio" : "Cambiar"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// --------------------------------------------------------- cotizadores

const Cotizadores = () => {
  const [cotizadores, setCotizadores] = useState<Cotizador[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCotizadores(await listarCotizadores());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nuevo = async () => {
    const codigo = window.prompt("Código del cotizador (sin espacios)", "nuevo_servicio");
    if (!codigo?.trim()) return;
    try {
      await guardarCotizador({
        codigo: codigo.trim(),
        nombre: "Servicio nuevo",
        costo_hora: 12,
        margen: 30,
        variables: [{ codigo: "cantidad", nombre: "Cantidad", valor_defecto: 1 }],
        tareas: [{ nombre: "Trabajo", horas_fijas: 1, horas_por_unidad: 0, variable: null }],
      });
      await cargar();
      setAbierto(codigo.trim());
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Para lo que no tiene precio fijo: tareas con tiempos, por el costo de
          la hora, más el margen.
        </p>
        <Button size="sm" variant="outline" onClick={nuevo}>
          Nuevo cotizador
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {cotizadores.map((c) => (
        <Editor
          key={c.codigo}
          cotizador={c}
          abierto={abierto === c.codigo}
          alAbrir={() => setAbierto(abierto === c.codigo ? null : c.codigo)}
          alGuardar={cargar}
        />
      ))}
    </div>
  );
};

const Editor = ({
  cotizador,
  abierto,
  alAbrir,
  alGuardar,
}: {
  cotizador: Cotizador;
  abierto: boolean;
  alAbrir: () => void;
  alGuardar: () => Promise<void>;
}) => {
  const [def, setDef] = useState(cotizador);
  const [calculo, setCalculo] = useState<Calculo | null>(null);
  const [perfiles, setPerfiles] = useState<PerfilDeNomina[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setDef(cotizador), [cotizador]);

  // Los perfiles de la nómina, para poder colgar de ellos cada tarea.
  useEffect(() => {
    listarPerfiles().then(setPerfiles).catch(() => setPerfiles([]));
  }, []);

  useEffect(() => setDef(cotizador), [cotizador]);

  /**
   * La prueba se recalcula contra el servidor y no en la pantalla.
   *
   * Es el mismo cálculo que va a usarse al cotizar de verdad: si se repitiera
   * aquí, el día que cambie la fórmula habría dos precios distintos y el de la
   * pantalla sería el que la gente creería.
   */
  const probar = useCallback(async () => {
    try {
      const valores: Record<string, number> = {};
      for (const v of def.variables) valores[v.codigo] = Number(v.valor_defecto);
      setCalculo(await calcularCotizacion(def.codigo, valores));
    } catch {
      setCalculo(null);
    }
  }, [def.codigo, def.variables]);

  useEffect(() => {
    if (abierto) void probar();
  }, [abierto, probar]);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await guardarCotizador({
        ...def,
        costo_hora: Number(def.costo_hora),
        margen: Number(def.margen),
        variables: def.variables,
        tareas: def.tareas,
      });
      await alGuardar();
      await probar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const cambiarTarea = (i: number, campo: keyof TareaDeCotizador, valor: string) =>
    setDef((d) => ({
      ...d,
      tareas: d.tareas.map((t, j) =>
        j === i
          ? {
              ...t,
              [campo]:
                campo === "nombre"
                  ? valor
                  : campo === "variable"
                    ? valor || null
                    : valor === ""
                      ? campo === "costo_hora"
                        ? null
                        : 0
                      : Number(valor),
            }
          : t,
      ),
    }));

  const cambiarVariable = (i: number, campo: keyof VariableDeCotizador, valor: string) =>
    setDef((d) => ({
      ...d,
      variables: d.variables.map((v, j) =>
        j === i ? { ...v, [campo]: campo === "valor_defecto" ? Number(valor || 0) : valor } : v,
      ),
    }));

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-left" onClick={alAbrir}>
          <span className="text-sm font-medium">{def.nombre}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {def.producto_nombre ?? "sin producto"} · {dinero(def.costo_hora)}/h ·{" "}
            {def.margen}% {NOMBRE_DE_MODO[def.modo_margen]}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {def.problemas.length > 0 && (
            <Badge variant="destructive">{def.problemas.length} aviso(s)</Badge>
          )}
          {calculo && (
            <Badge variant="outline">
              {dinero(calculo.precio)} {NOMBRE_DE_PERIODICIDAD[calculo.cotizador.periodicidad]}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={alAbrir}>
            {abierto ? "Cerrar" : "Abrir"}
          </Button>
        </div>
      </div>

      {def.problemas.map((p) => (
        <p key={p} className="text-xs text-destructive">
          {p}
        </p>
      ))}

      {abierto && (
        <>
          <div className="flex flex-wrap gap-3">
            <Campo label="Nombre" ancho="w-48" valor={def.nombre} alCambiar={(v) => setDef({ ...def, nombre: v })} />
            <Campo
              label="Costo por hora"
              ancho="w-28"
              valor={String(def.costo_hora)}
              alCambiar={(v) => setDef({ ...def, costo_hora: Number(v || 0) })}
            />
            <Campo
              label="Margen %"
              ancho="w-24"
              valor={String(def.margen)}
              alCambiar={(v) => setDef({ ...def, margen: Number(v || 0) })}
            />
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              Margen calculado
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={def.modo_margen}
                onChange={(e) =>
                  setDef({ ...def, modo_margen: e.target.value as Cotizador["modo_margen"] })
                }
              >
                <option value="sobre_costo">sobre el costo (100 → 130)</option>
                <option value="sobre_precio">sobre el precio (100 → 142,86)</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              El precio es
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={def.periodicidad}
                onChange={(e) =>
                  setDef({ ...def, periodicidad: e.target.value as Cotizador["periodicidad"] })
                }
              >
                <option value="mensual">al mes</option>
                <option value="anual">al año</option>
                <option value="unica">una sola vez</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-muted-foreground pt-2">Qué se pregunta al cotizar</p>
          {def.variables.map((v, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Campo label="Código" ancho="w-36" valor={v.codigo} alCambiar={(x) => cambiarVariable(i, "codigo", x)} />
              <Campo label="Pregunta" ancho="w-56" valor={v.nombre} alCambiar={(x) => cambiarVariable(i, "nombre", x)} />
              <Campo
                label="Valor típico"
                ancho="w-28"
                valor={String(v.valor_defecto)}
                alCambiar={(x) => cambiarVariable(i, "valor_defecto", x)}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDef({
                ...def,
                variables: [...def.variables, { codigo: "", nombre: "", unidad: null, valor_defecto: 0 }],
              })
            }
          >
            + Variable
          </Button>

          <p className="text-xs text-muted-foreground pt-2">Tareas y tiempos</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Tarea</th>
                <th className="font-normal pb-1 w-24 text-right">Horas fijas</th>
                <th className="font-normal pb-1 w-28 text-right">Horas × unidad</th>
                <th className="font-normal pb-1 w-40">Por cada</th>
                <th className="font-normal pb-1 w-40">Quién la hace</th>
                <th className="font-normal pb-1 w-28 text-right">Costo hora</th>
              </tr>
            </thead>
            <tbody>
              {def.tareas.map((t, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 pr-2">
                    <Input className="h-7" value={t.nombre} onChange={(e) => cambiarTarea(i, "nombre", e.target.value)} />
                  </td>
                  <td className="py-1">
                    <Input
                      className="h-7 text-right"
                      value={String(t.horas_fijas)}
                      onChange={(e) => cambiarTarea(i, "horas_fijas", e.target.value)}
                    />
                  </td>
                  <td className="py-1">
                    <Input
                      className="h-7 text-right"
                      value={String(t.horas_por_unidad)}
                      onChange={(e) => cambiarTarea(i, "horas_por_unidad", e.target.value)}
                    />
                  </td>
                  <td className="py-1">
                    <select
                      className="h-7 w-full rounded-md border bg-transparent px-1 text-sm"
                      value={t.variable ?? ""}
                      onChange={(e) => cambiarTarea(i, "variable", e.target.value)}
                    >
                      <option value="">— fija —</option>
                      {def.variables.map((v) => (
                        <option key={v.codigo} value={v.codigo}>
                          {v.nombre || v.codigo}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/*
                    Con perfil, el costo sale de la nómina que manda el
                    contable y se actualiza solo. El número de al lado sigue
                    ganando si alguien lo escribe: se pone a propósito.
                  */}
                  <td className="py-1">
                    <select
                      className="h-7 w-full rounded-md border bg-transparent px-1 text-sm"
                      value={t.perfil ?? ""}
                      onChange={(e) => cambiarTarea(i, "perfil", e.target.value)}
                    >
                      <option value="">— sin perfil —</option>
                      {perfiles.map((p) => (
                        <option key={p.perfil} value={p.perfil}>
                          {p.nombre} ({dinero(p.costo_hora)}/h)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <Input
                      className="h-7 text-right"
                      placeholder={
                        t.perfil
                          ? String(perfiles.find((p) => p.perfil === t.perfil)?.costo_hora ?? def.costo_hora)
                          : String(def.costo_hora)
                      }
                      value={t.costo_hora === null ? "" : String(t.costo_hora)}
                      onChange={(e) => cambiarTarea(i, "costo_hora", e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDef({
                ...def,
                tareas: [
                  ...def.tareas,
                  { nombre: "", horas_fijas: 0, horas_por_unidad: 0, variable: null, costo_hora: null },
                ],
              })
            }
          >
            + Tarea
          </Button>

          {calculo && (
            <div className="border-t pt-2 text-sm">
              <p className="text-xs text-muted-foreground mb-1">
                Con los valores típicos: {calculo.horas} h · costo {dinero(calculo.costo)} ·
                ganancia {dinero(calculo.ganancia)}
              </p>
              <p className="font-medium">
                Precio {dinero(calculo.precio)}{" "}
                {NOMBRE_DE_PERIODICIDAD[calculo.cotizador.periodicidad]}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={guardar} disabled={ocupado}>
              {ocupado ? "Guardando…" : "Guardar el cotizador"}
            </Button>
            <Button size="sm" variant="outline" onClick={probar}>
              Probar
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

const Campo = ({
  label,
  valor,
  ancho = "w-40",
  alCambiar,
}: {
  label: string;
  valor: string;
  ancho?: string;
  alCambiar: (valor: string) => void;
}) => (
  <label className="text-xs text-muted-foreground flex flex-col gap-1">
    {label}
    <Input className={`h-9 ${ancho}`} value={valor} onChange={(e) => alCambiar(e.target.value)} />
  </label>
);

// --------------------------------------------------------- inventario

/**
 * Lo que llega del contable: artículos y costo del personal.
 *
 * Es de sólo lectura a propósito. Un precio de inventario corregido aquí dura
 * hasta la siguiente sincronización, y en medio los dos sistemas dicen cosas
 * distintas sobre lo mismo. Lo que sí se enseña es **de cuándo es el dato**,
 * que es lo que permite desconfiar de él cuando lleva días sin moverse.
 */
const Inventario = () => {
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [perfiles, setPerfiles] = useState<PerfilDeNomina[]>([]);
  const [estado, setEstado] = useState<EstadoDelContable | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listarArticulos(busqueda), listarPerfiles(), estadoDelContable()])
      .then(([a, p, e]) => {
        setArticulos(a);
        setPerfiles(p);
        setEstado(e);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [busqueda]);

  const cuando = (fecha: string | null) =>
    fecha ? new Date(fecha).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" }) : "nunca";

  return (
    <div className="flex flex-col gap-3">
      {estado && (
        <div className="border rounded-lg p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={estado.conectado ? "default" : "secondary"}>
              {estado.conectado ? "Conectado al contable" : "Sin llave configurada"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Inventario: {estado.inventario.total} artículos · {cuando(estado.inventario.ultima)}
              {" · "}
              Nómina: {estado.nomina.total} perfiles · {cuando(estado.nomina.ultima)}
              {" · "}
              Avisos de cobro: {estado.movimientos.total} · {cuando(estado.movimientos.ultima)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Esto lo escribe el contable por su API; desde aquí sólo se mira.
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">Artículos</p>
          <Input
            className="h-8 w-56"
            placeholder="Buscar por nombre o código"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        {articulos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay artículos. Los manda el contable a <code>POST /crm/contable/inventario</code>.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Código</th>
                <th className="font-normal pb-1">Artículo</th>
                <th className="font-normal pb-1 text-right w-24">Precio</th>
                <th className="font-normal pb-1 text-right w-16">IVA</th>
                <th className="font-normal pb-1 text-right w-20">Stock</th>
              </tr>
            </thead>
            <tbody>
              {articulos.map((a) => (
                <tr key={a.codigo} className="border-t">
                  <td className="py-1 pr-2 text-muted-foreground">{a.codigo}</td>
                  <td className="py-1 pr-2">{a.nombre}</td>
                  <td className="py-1 text-right tabular-nums">
                    {a.precio === null ? "—" : dinero(a.precio)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {a.iva === null ? "—" : `${a.iva}%`}
                  </td>
                  {/*
                    Sin existencias se dice, no se esconde: cotizar algo que no
                    hay es prometer una fecha de entrega que no se va a cumplir.
                  */}
                  <td className="py-1 text-right tabular-nums">
                    {a.stock === null ? (
                      "—"
                    ) : a.stock <= 0 ? (
                      <span className="text-destructive">sin stock</span>
                    ) : (
                      a.stock
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">
          Costo del personal · es lo que usan las tareas del cotizador que tienen perfil
        </p>
        {perfiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin perfiles. Los manda el contable a <code>POST /crm/contable/nomina</code>.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left">
                <th className="font-normal pb-1">Perfil</th>
                <th className="font-normal pb-1 text-right w-28">Costo hora</th>
                <th className="font-normal pb-1 text-right w-24">Personas</th>
              </tr>
            </thead>
            <tbody>
              {perfiles.map((p) => (
                <tr key={p.perfil} className="border-t">
                  <td className="py-1">{p.nombre}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.costo_hora)}</td>
                  <td className="py-1 text-right tabular-nums">{p.personas ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
