import { usuarioActual } from "./dataProvider";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const BASE = `${API}/crm/proformas`;

export interface LineaDeProforma {
  id?: string;
  orden?: number;
  producto: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  iva_pct: number;
}

export interface Proforma {
  id: string;
  numero: string;
  oportunidad: string;
  estado: "borrador" | "enviada" | "aceptada" | "rechazada" | "anulada";
  estado_visible: Proforma["estado"] | "vencida";
  valida_hasta: string;
  razon_social: string;
  ruc: string | null;
  direccion: string | null;
  contacto: string | null;
  correo: string | null;
  notas: string | null;
  condiciones: string | null;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
  token: string;
  enviada_en: string | null;
  vista_en: string | null;
  cerrada_en: string | null;
  aceptada_por: string | null;
  motivo: string | null;
  lineas: LineaDeProforma[];
}

export interface PrecioDeProducto {
  codigo: string;
  nombre: string;
  precio: number | null;
  iva: number | null;
}

async function pedir(ruta: string, opciones: RequestInit = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
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

export const proformasDe = (oportunidad: string | number): Promise<Proforma[]> =>
  pedir(`/oportunidad/${oportunidad}`);

export const crearProforma = (oportunidad: string | number): Promise<Proforma> =>
  pedir("", { method: "POST", body: JSON.stringify({ oportunidad: Number(oportunidad) }) });

export const editarProforma = (
  id: string,
  datos: Record<string, unknown>,
): Promise<Proforma> => pedir(`/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const enviarProforma = (id: string): Promise<Proforma & { enlace: string; simulado: boolean }> =>
  pedir(`/${id}/enviar`, { method: "POST" });

export const anularProforma = (id: string, motivo: string): Promise<Proforma> =>
  pedir(`/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });

export const listaDePrecios = (): Promise<PrecioDeProducto[]> => pedir("/precios");

export const ponerPrecio = (datos: { producto: string; precio: number; iva?: number }) =>
  pedir("/precios", { method: "POST", body: JSON.stringify(datos) });

/** El enlace que ve el cliente. Lo sirve el back, no el CRM. */
export const enlaceDeProforma = (token: string) => `${API}/crm/proformas/ver/${token}`;

/**
 * Los mismos totales que calcula el servidor.
 *
 * Se repiten aquí para que la tabla responda mientras se teclea, en vez de
 * esperar una ida y vuelta por cada cifra. El que manda es el del servidor:
 * esto se refresca con su respuesta en cuanto se guarda.
 */
export function totalesDe(lineas: LineaDeProforma[]) {
  const centimos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let descuento = 0;
  let iva = 0;
  let total = 0;

  for (const l of lineas) {
    const bruto = centimos(Number(l.cantidad || 0) * Number(l.precio_unitario || 0));
    const desc = centimos((bruto * Number(l.descuento_pct || 0)) / 100);
    const base = centimos(bruto - desc);
    const impuesto = centimos((base * Number(l.iva_pct || 0)) / 100);
    subtotal = centimos(subtotal + bruto);
    descuento = centimos(descuento + desc);
    iva = centimos(iva + impuesto);
    total = centimos(total + centimos(base + impuesto));
  }

  return { subtotal, descuento, iva, total };
}

export const dinero = (valor: number) =>
  `$${Number(valor ?? 0).toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const NOMBRE_DE_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  vencida: "Vencida",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  anulada: "Anulada",
};
