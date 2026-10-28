import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export interface TramoDelEmbudo {
  codigo: string;
  nombre: string;
  llegaron: number;
  conversion: number | null;
  atascadas: number;
}

export interface FilaDeDesglose {
  etiqueta: string;
  cuenta: number;
  ganadas: number;
  monto: number;
}

export interface Resumen {
  periodo: { desde: string; hasta: string; marca?: string; comercial?: string };
  embudo: TramoDelEmbudo[];
  abiertas: number;
  ganadas: number;
  perdidas: number;
  tasaDeCierre: number | null;
  diasHastaGanar: number | null;
  vendido: number;
  ventas: number;
  ticketPromedio: number | null;
  porProducto: FilaDeDesglose[];
  porMarca: FilaDeDesglose[];
  porOrigen: FilaDeDesglose[];
  porComercial: FilaDeDesglose[];
}

export const resumenDeTableros = async (
  desde: string,
  hasta: string,
  filtros: { marca?: string; comercial?: string; equipo?: string } = {},
): Promise<Resumen> => {
  const busca = new URLSearchParams({ desde, hasta });
  if (filtros.marca) busca.set("marca", filtros.marca);
  if (filtros.equipo) busca.set("equipo", filtros.equipo);
  if (filtros.comercial) busca.set("comercial", filtros.comercial);

  const respuesta = await fetch(`${API}/crm/tableros?${busca}`, {
    headers: { "X-Usuario": usuarioActual() },
  });
  if (!respuesta.ok) {
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }
  return respuesta.json();
};

/**
 * Los periodos que se miran de verdad.
 *
 * El fin es **exclusivo**: con un rango cerrado, «hasta el 31» deja fuera todo
 * lo de ese día después de medianoche y el mes sale corto sin que se note.
 * Se componen con las piezas locales de la fecha y no con `toISOString()`, que
 * daría el día en UTC y correría el mes una tarde de cada día en Ecuador.
 */
export function periodosHabituales(hoy = new Date()) {
  const dia = (f: Date) => {
    const dos = (n: number) => String(n).padStart(2, "0");
    return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
  };
  const primeroDe = (anio: number, mes: number) => dia(new Date(anio, mes, 1));
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();

  return [
    {
      codigo: "mes",
      nombre: "Este mes",
      desde: primeroDe(anio, mes),
      hasta: primeroDe(anio, mes + 1),
    },
    {
      codigo: "mes_anterior",
      nombre: "Mes anterior",
      desde: primeroDe(anio, mes - 1),
      hasta: primeroDe(anio, mes),
    },
    {
      codigo: "trimestre",
      nombre: "Últimos 3 meses",
      desde: primeroDe(anio, mes - 2),
      hasta: primeroDe(anio, mes + 1),
    },
    {
      codigo: "anio",
      nombre: "Este año",
      desde: primeroDe(anio, 0),
      hasta: primeroDe(anio + 1, 0),
    },
  ];
}

export const dinero = (valor: number) =>
  valor.toLocaleString("es-EC", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

// ------------------------------------------------------ metas y comisiones

export interface FilaDeMetas {
  comercial: string;
  nombre: string;
  meta: number | null;
  cobrado: number;
  porCobrar: number;
  cumplimiento: number | null;
  comision: number;
  comisionEnCamino: number;
}

export interface ReglaDeComision {
  codigo: string;
  nombre: string;
  producto: string | null;
  marca: string | null;
  porcentaje: number;
  desde_cumplimiento: number;
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch(`${API}/crm/tableros${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      "X-Usuario": usuarioActual(),
      ...(opciones.headers as Record<string, string>),
    },
  });
  if (!respuesta.ok) {
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }
  return respuesta.json();
}

export const metasDelMes = (anio: number, mes: number): Promise<FilaDeMetas[]> =>
  pedir(`/metas?anio=${anio}&mes=${mes}`);

export const reglasDeComision = (): Promise<ReglaDeComision[]> =>
  pedir("/comisiones/reglas");

export const ponerMeta = (datos: {
  comercial: string;
  anio: number;
  mes: number;
  monto: number;
}) => pedir("/metas", { method: "POST", body: JSON.stringify(datos) });

export const ponerRegla = (datos: {
  codigo: string;
  nombre: string;
  porcentaje: number;
  producto?: string;
  desdeCumplimiento?: number;
}) => pedir("/comisiones/reglas", { method: "POST", body: JSON.stringify(datos) });

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// ------------------------------------------------- analítica hacia delante

/** Los filtros que entienden todas las vistas de Tableros. */
export interface FiltrosDeTablero {
  marca?: string;
  comercial?: string;
  /** Un supervisor: él y todos los que cuelgan de él. */
  equipo?: string;
}

const conFiltros = (f: FiltrosDeTablero, extra: Record<string, string | number> = {}) => {
  const busca = new URLSearchParams();
  for (const [clave, valor] of Object.entries({ ...f, ...extra })) {
    if (valor !== undefined && valor !== "") busca.set(clave, String(valor));
  }
  return busca.size ? `?${busca}` : "";
};

export interface MesDePronostico {
  mes: string;
  cuenta: number;
  abierto: number;
  ponderado: number;
  ponderadoObservado: number | null;
  comprometido: number;
}

export interface Pronostico {
  meses: MesDePronostico[];
  atrasadas: { cuenta: number; monto: number };
  sinFecha: { cuenta: number; monto: number };
  etapas: {
    codigo: string;
    nombre: string;
    declarada: number;
    probabilidad: number | null;
    muestra: number;
  }[];
  mesActual: { meta: number | null; ganado: number; esperado: number };
  porComercial: { comercial: string; nombre: string; abierto: number; ponderado: number }[];
}

export interface Pipeline {
  abiertas: number;
  valor: number;
  ponderado: number;
  edadMedia: number | null;
  totalEstancadas: number;
  diasParaEstancada: number;
  porEtapa: {
    codigo: string;
    nombre: string;
    probabilidad: number;
    cuenta: number;
    valor: number;
    ponderado: number;
    diasEnEtapa: number | null;
    estancadas: number;
  }[];
  tiempos: {
    codigo: string;
    nombre: string;
    salidas: number;
    diasMedios: number | null;
    diasMediana: number | null;
  }[];
  cuello: { nombre: string; diasMediana: number | null; salidas: number } | null;
  estancadas: {
    id: number;
    nombre: string;
    empresa: string | null;
    comercial: string | null;
    etapa: string;
    monto: number;
    diasSinMovimiento: number;
  }[];
}

export interface FilaDeProductividad {
  comercial: string;
  nombre: string;
  supervisor: string | null;
  interacciones: number;
  llamadas: number;
  reuniones: number;
  reuniones_realizadas: number;
  tareas_hechas: number;
  tareas_vencidas: number;
  abiertas: number;
  propuestas: number;
  ganadas: number;
  vendido: number;
}

export interface MesDeTendencia {
  mes: string;
  abiertas: number;
  ganadas: number;
  perdidas: number;
  tasaDeCierre: number | null;
  vendido: number;
  ticketPromedio: number | null;
  vendidoAnioAnterior: number;
  variacionAnual: number | null;
  enCurso: boolean;
}

export interface Alerta {
  codigo: string;
  nivel: "alta" | "media";
  titulo: string;
  detalle: string;
  recomendacion: string;
}

export interface Alertas {
  hoy: string;
  meta: number | null;
  vendidoMes: number;
  esperado: number;
  alertas: Alerta[];
}

export const pronostico = (f: FiltrosDeTablero, meses = 3): Promise<Pronostico> =>
  pedir(`/pronostico${conFiltros(f, { meses })}`);

export const pipeline = (f: FiltrosDeTablero): Promise<Pipeline> =>
  pedir(`/pipeline${conFiltros(f)}`);

export const productividad = (
  desde: string,
  hasta: string,
  f: FiltrosDeTablero,
): Promise<FilaDeProductividad[]> => pedir(`/productividad${conFiltros(f, { desde, hasta })}`);

export const tendencia = (f: FiltrosDeTablero, meses = 12): Promise<MesDeTendencia[]> =>
  pedir(`/tendencia${conFiltros(f, { meses })}`);

export const alertasDelTablero = (f: FiltrosDeTablero): Promise<Alertas> =>
  pedir(`/alertas${conFiltros(f)}`);

// ----------------------------------------------------------------- equipos

export interface MiembroDeEquipo {
  usuario: string;
  nombre: string;
  supervisor: string | null;
}

export const equipos = (): Promise<MiembroDeEquipo[]> => pedir("/equipos");

export const ponerSupervisor = (usuario: string, supervisor: string | null) =>
  pedir("/equipos", { method: "POST", body: JSON.stringify({ usuario, supervisor }) });

// ---------------------------------------------------------------- reportes

export type Formato = "texto" | "numero" | "dinero" | "porcentaje";

export interface CatalogoDeReportes {
  dimensiones: { codigo: string; nombre: string }[];
  metricas: { codigo: string; nombre: string; formato: Formato }[];
}

export interface DefinicionDeReporte extends FiltrosDeTablero {
  dimension: string;
  metricas: string[];
  desde?: string;
  hasta?: string;
  producto?: string;
}

export interface ResultadoDeReporte {
  definicion: DefinicionDeReporte;
  columnas: { codigo: string; nombre: string; formato: Formato }[];
  filas: Record<string, string | number | null>[];
  totales: Record<string, string | number | null>;
  recortado: boolean;
}

export interface ReporteGuardado {
  id: string;
  nombre: string;
  definicion: DefinicionDeReporte;
  frecuencia: "semanal" | "mensual" | null;
  destinatarios: string[];
  proximo_envio: string | null;
  ultimo_envio: string | null;
  ultimo_error: string | null;
}

export const catalogoDeReportes = (): Promise<CatalogoDeReportes> => pedir("/reportes/catalogo");

export const ejecutarReporte = (def: DefinicionDeReporte): Promise<ResultadoDeReporte> =>
  pedir("/reportes/ejecutar", { method: "POST", body: JSON.stringify(def) });

export const reportesGuardados = (): Promise<ReporteGuardado[]> => pedir("/reportes");

export const guardarReporte = (datos: {
  id?: string;
  nombre: string;
  definicion: DefinicionDeReporte;
  frecuencia: string | null;
  destinatarios: string[];
}): Promise<ReporteGuardado> =>
  pedir("/reportes", { method: "POST", body: JSON.stringify(datos) });

export const borrarReporte = (id: string) => pedir(`/reportes/${id}`, { method: "DELETE" });

export const enviarReporteAhora = (id: string) =>
  pedir(`/reportes/${id}/enviar`, { method: "POST" });

/**
 * Descarga el `.xlsx` del reporte.
 *
 * Por `fetch` y no con un enlace: la definición viaja en el cuerpo, y el
 * servidor exige la cabecera del usuario.
 */
export async function descargarExcel(def: DefinicionDeReporte, nombre: string) {
  const respuesta = await fetch(`${API}/crm/tableros/reportes/exportar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Usuario": usuarioActual() },
    body: JSON.stringify({ ...def, nombre }),
  });
  if (!respuesta.ok) {
    let mensaje = `${respuesta.status} ${respuesta.statusText}`;
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) mensaje = cuerpo.message;
    } catch {
      /* el cuerpo no era JSON */
    }
    throw new Error(mensaje);
  }
  const url = URL.createObjectURL(await respuesta.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "reporte"}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Un valor con su formato, como se lee en una tabla. */
export function conFormato(valor: unknown, formato: Formato): string {
  if (valor === null || valor === undefined) return "—";
  if (formato === "dinero") return dinero(Number(valor));
  if (formato === "porcentaje") return `${Number(valor).toLocaleString("es-EC")} %`;
  if (formato === "numero") return Number(valor).toLocaleString("es-EC");
  return String(valor);
}

/** `2026-10` → «oct 2026». */
export function nombreDeMes(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  return `${MESES[m - 1].slice(0, 3)} ${anio}`;
}
