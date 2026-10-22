import type { ConfigurationContextValue } from "./ConfigurationContext";
// Import the logos as module assets so Vite resolves their URL relative to the
// JS chunk (import.meta.url), not the current route. A plain "./logos/..." path
// breaks on nested routes like /oauth/consent and under a deployment sub-path.
import darkModeLogo from "./logos/logo_atomic_crm_dark.svg";
import lightModeLogo from "./logos/logo_atomic_crm_light.svg";

export const defaultDarkModeLogo = darkModeLogo;
export const defaultLightModeLogo = lightModeLogo;

export const defaultCurrency = "USD";

export const defaultTitle = "FRIDAY CRM";

/**
 * Los sectores no se listan a mano: en FRIDAY la actividad de una empresa sale
 * del CIIU, que ya está en la base y es el que usan los segmentos. Esta lista
 * queda vacía a propósito para que nadie clasifique por su cuenta y acabe con
 * dos taxonomías que no casan.
 */
export const defaultCompanySectors: { value: string; label: string }[] = [];

/**
 * Las mismas seis etapas que tiene `crm_etapa` en el back, con sus mismos
 * códigos. Si divergieran, el tablero pintaría columnas que el servidor no
 * reconoce y mover una tarjeta fallaría sin que se vea por qué.
 */
export const defaultDealStages = [
  { value: "contacto", label: "Por contactar" },
  { value: "conversando", label: "En conversación" },
  { value: "propuesta", label: "Propuesta enviada" },
  { value: "negociacion", label: "En negociación" },
  { value: "ganada", label: "Ganada" },
  { value: "perdida", label: "Perdida" },
];

export const defaultDealPipelineStatuses = ["ganada"];

/**
 * La categoría de una oportunidad es el **producto** del catálogo de FRIDAY, y
 * por eso tampoco se escribe aquí: se carga del servidor. Con texto libre,
 * «cuánto vendimos de Registro de Marca» obliga a clasificar a mano lo que
 * alguien escribió de siete formas.
 */
export const defaultDealCategories: { value: string; label: string }[] = [];

export const defaultNoteStatuses = [
  { value: "frio", label: "Frío", color: "#7dbde8" },
  { value: "templado", label: "Templado", color: "#e8cb7d" },
  { value: "caliente", label: "Caliente", color: "#e88b7d" },
  { value: "en-contrato", label: "En contrato", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "ninguno", label: "Ninguno" },
  { value: "llamada", label: "Llamada" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "correo", label: "Correo" },
  { value: "reunion", label: "Reunión" },
  { value: "demostracion", label: "Demostración" },
  { value: "seguimiento", label: "Seguimiento" },
  { value: "propuesta", label: "Enviar propuesta" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
