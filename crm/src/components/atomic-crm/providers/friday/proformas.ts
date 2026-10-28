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
  /** Una opción que el cliente puede añadir al aceptar. */
  opcional?: boolean;
  incluida?: boolean | null;
}

export type NivelDeDescuento = "libre" | "supervisor" | "direccion";

export interface Aprobacion {
  descuento_pct: number;
  nivel: NivelDeDescuento;
  pendiente: NivelDeDescuento | null;
}

export interface Proforma {
  id: string;
  numero: string;
  version: number;
  version_de: string | null;
  oportunidad: string;
  estado: "borrador" | "enviada" | "aceptada" | "rechazada" | "anulada" | "reemplazada";
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
  motivo_rechazo: string | null;
  condiciones_pago: string | null;
  plantilla: string | null;
  canal_envio: string | null;
  aprobada_por: string | null;
  aprobacion_pedida_en: string | null;
  creada_por: string;
  aprobacion: Aprobacion;
  lineas: LineaDeProforma[];
}

/** Una fila del listado de propuestas: sin líneas, con la venta al lado. */
export type PropuestaListada = Omit<Proforma, "lineas"> & {
  oportunidad_nombre: string;
  comercial: string | null;
  marca: string | null;
  puedes_aprobar?: boolean;
  motivo?: string | null;
};

export interface PlantillaDePropuesta {
  codigo: string;
  nombre: string;
  marca: string | null;
  dias_validez: number;
  notas: string | null;
  condiciones: string | null;
  condiciones_pago: string | null;
  activa: boolean;
}

export interface EventoDePropuesta {
  id: string;
  tipo: string;
  detalle: string | null;
  autor: string;
  ocurrido_en: string;
}

export interface TopeDeDescuento {
  nivel: NivelDeDescuento;
  hasta_pct: number;
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

export const crearProforma = (
  oportunidad: string | number,
  plantilla?: string,
): Promise<Proforma> =>
  pedir("", {
    method: "POST",
    body: JSON.stringify({ oportunidad: Number(oportunidad), plantilla: plantilla || undefined }),
  });

export const nuevaVersion = (id: string): Promise<Proforma> =>
  pedir(`/${id}/version`, { method: "POST" });

export const pedirAprobacion = (id: string): Promise<Proforma> =>
  pedir(`/${id}/pedir-aprobacion`, { method: "POST" });

export const aprobarDescuento = (id: string): Promise<Proforma> =>
  pedir(`/${id}/aprobar`, { method: "POST" });

export const eventosDe = (id: string): Promise<EventoDePropuesta[]> => pedir(`/${id}/eventos`);

export const listadoDePropuestas = (
  filtros: { estado?: string; comercial?: string; marca?: string } = {},
): Promise<PropuestaListada[]> => {
  const busca = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) if (valor) busca.set(clave, valor);
  return pedir(busca.size ? `?${busca}` : "");
};

export const aprobacionesPendientes = (): Promise<PropuestaListada[]> => pedir("/aprobaciones");

export const plantillasDePropuesta = (): Promise<PlantillaDePropuesta[]> => pedir("/plantillas");

export const guardarPlantilla = (datos: Partial<PlantillaDePropuesta>) =>
  pedir("/plantillas", { method: "POST", body: JSON.stringify(datos) });

export const topesDeDescuento = (): Promise<TopeDeDescuento[]> => pedir("/descuentos");

export const ponerTope = (nivel: NivelDeDescuento, hasta_pct: number): Promise<TopeDeDescuento[]> =>
  pedir("/descuentos", { method: "POST", body: JSON.stringify({ nivel, hasta_pct }) });

export const motivosDeRechazo = (): Promise<{ codigo: string; nombre: string }[]> =>
  pedir("/motivos");

export const editarProforma = (
  id: string,
  datos: Record<string, unknown>,
): Promise<Proforma> => pedir(`/${id}`, { method: "PATCH", body: JSON.stringify(datos) });

export const enviarProforma = (
  id: string,
  canal: "correo" | "whatsapp" = "correo",
): Promise<Proforma & { enlace: string; enlace_whatsapp: string | null; simulado: boolean }> =>
  pedir(`/${id}/enviar`, { method: "POST", body: JSON.stringify({ canal }) });

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
    // Las opcionales no suman hasta que el cliente las elige.
    if (l.opcional && l.incluida !== true) continue;
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
  reemplazada: "Reemplazada",
};

export const NOMBRE_DE_NIVEL: Record<NivelDeDescuento, string> = {
  libre: "nadie",
  supervisor: "su supervisor",
  direccion: "dirección",
};

/** Los motivos de rechazo, iguales que en el servidor, para leerlos sin pedirlos. */
export const NOMBRE_DE_MOTIVO: Record<string, string> = {
  precio: "El precio",
  competencia: "Eligió a otro proveedor",
  presupuesto: "No tiene presupuesto ahora",
  alcance: "No es lo que necesita",
  plazo: "Los plazos no le sirven",
  pospuesto: "Lo deja para más adelante",
  otro: "Otro motivo",
};

export const NOMBRE_DE_EVENTO: Record<string, string> = {
  creada: "Creada",
  editada: "Editada",
  version: "Versión nueva",
  aprobacion_pedida: "Pidió firma del descuento",
  aprobada: "Descuento firmado",
  enviada: "Enviada",
  vista: "El cliente la abrió",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  anulada: "Anulada",
};

/** La versión para imprimir del enlace del cliente: es el PDF. */
export const pdfDeProforma = (token: string) => `${enlaceDeProforma(token)}?imprimir`;
