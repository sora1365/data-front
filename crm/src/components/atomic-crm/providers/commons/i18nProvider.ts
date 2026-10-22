import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import spanishMessages from "ra-language-spanish";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { englishCrmMessages } from "./englishCrmMessages";
import { spanishCrmMessages } from "./spanishCrmMessages";

const raSupabaseEnglishMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset: "Check your emails for a Reset Password message.",
    },
    oauth: {
      authorize: "Authorize Application",
      authorize_details: "This application wants to access your account.",
      access_scope:
        "It will be able to read and modify your data, with the same permissions as your account.",
      approved: "Authorization Approved",
      close_tab: "You can now close this tab.",
      no_request: "No authorization request found",
    },
  },
};

/**
 * Retoques sobre `ra-language-spanish`, que deja algunas palabras en inglés.
 * «Dashboard» es la más visible: es la primera entrada del menú.
 */
const raSpanishOverride = {
  ra: {
    page: {
      dashboard: "Panel",
    },
  },
};

const raSupabaseSpanishMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset:
        "Revisa tu correo: te hemos enviado un mensaje para restablecer la contraseña.",
    },
    oauth: {
      authorize: "Autorizar la aplicación",
      authorize_details: "Esta aplicación quiere acceder a tu cuenta.",
      access_scope:
        "Podrá leer y modificar tus datos, con los mismos permisos que tu cuenta.",
      approved: "Autorización concedida",
      close_tab: "Ya puedes cerrar esta pestaña.",
      no_request: "No hay ninguna solicitud de autorización",
    },
  },
};

const englishCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  raSupabaseEnglishMessagesOverride,
  englishCrmMessages,
);

/**
 * El catálogo español se monta **encima del inglés** a propósito.
 *
 * `ra-language-spanish` traduce react-admin, pero no los mensajes propios de
 * `ra-supabase`; si el español fuera un catálogo aparte, esas claves saldrían
 * en crudo en pantalla. Apilándolo sobre el inglés, lo que no esté traducido
 * cae a un texto legible en vez de a `ra-supabase.auth.password_reset`.
 */
const spanishCatalog = mergeTranslations(
  englishCatalog,
  spanishMessages,
  raSpanishOverride,
  raSupabaseSpanishMessagesOverride,
  spanishCrmMessages,
);

/**
 * El CRM se usa en Ecuador: el idioma por defecto es el español y el inglés
 * queda disponible por si alguien lo necesita. Antes se decidía según el
 * navegador, que aquí sólo serviría para que la herramienta amaneciera en
 * inglés en el portátil recién comprado de alguien.
 */
export const getInitialLocale = (): "es" | "en" => "es";

export const i18nProvider = polyglotI18nProvider(
  (locale) => {
    if (locale === "en") {
      return englishCatalog;
    }
    return spanishCatalog;
  },
  getInitialLocale(),
  [
    { locale: "es", name: "Español" },
    { locale: "en", name: "English" },
  ],
  { allowMissing: true },
);

export const testI18nProvider = polyglotI18nProvider(
  () => englishCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);
