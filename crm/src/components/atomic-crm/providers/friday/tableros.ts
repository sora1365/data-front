import { firma } from "./dataProvider";

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
  porProducto: FilaDeDesglose[];
  porMarca: FilaDeDesglose[];
  porOrigen: FilaDeDesglose[];
  porComercial: FilaDeDesglose[];
}

export const resumenDeTableros = async (
  desde: string,
  hasta: string,
  filtros: { marca?: string; comercial?: string } = {},
): Promise<Resumen> => {
  const busca = new URLSearchParams({ desde, hasta });
  if (filtros.marca) busca.set("marca", filtros.marca);
  if (filtros.comercial) busca.set("comercial", filtros.comercial);

  const respuesta = await fetch(`${API}/crm/tableros?${busca}`, {
    headers: { ...firma() },
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
      ...firma(),
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
