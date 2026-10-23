# Captación de leads

Módulo 7 del requerimiento: formularios públicos, la bandeja que los recibe y
el embudo que mide de la visita a la oportunidad.

```
web / landing / QR / feria
        │  formulario público (sin cuenta)
        ▼
   crm.lead  ── nuevo → contactado → calificado ──► convertido ──► crm.oportunidad
        │                    └──────────► descartado (con motivo)      (origen_lead)
        └─ crm.interaccion (lead_recibido, volvio_a_escribir, llamadas…)
```

## El formulario es una fila, no una pantalla

`crm.formulario` guarda los campos (`jsonb`), la marca, el producto que se
ofrece, el texto de consentimiento y **entre quiénes se reparten** los leads.
Un formulario nuevo para una feria o una landing es un alta desde `/leads`, no
un despliegue.

La página pública la sirve el propio API en `/crm/publico/f/:slug`, y se
incrusta en cualquier web con un `<iframe>` (el código lo da la pantalla). Se
eligió así y no un `fetch` desde la web del cliente porque eso obligaría a
abrir CORS a cualquier dominio, y CORS se configura para todo el API. Funciona
sin JavaScript; el script sólo oculta los campos condicionales, mide la prisa
del robot y ajusta la altura del `<iframe>`.

**El `slug` no se cambia.** Es la URL que ya está pegada en una web o impresa
en un QR. Para otra dirección, otro formulario.

## Las reglas que no se ven

Viven en `leads.reglas.ts`, probadas en `leads.reglas.spec.ts`:

- **Un lead por persona viva.** Si llega alguien con el mismo correo **o** el
  mismo teléfono (normalizados) que un lead no convertido ni descartado, no se
  crea otro: se suma el envío (`envios`), se completan los datos que faltaban
  y se respeta su asignación. Un índice único no puede decir «o», así que la
  entrada se serializa con `pg_advisory_xact_lock`: sin eso, el doble clic
  crea dos leads.
- **Atribución al primer contacto.** El origen (`utm_*`, página) no se
  sobrescribe al volver a escribir; sólo se completa si el primer envío no
  traía.
- **Reparto por turnos, sin contador.** Le toca a quien hace más tiempo que no
  recibe un lead de ese formulario, mirando `asignado_en`. Un contador se
  desordena en cuanto alguien entra o sale de la lista.
- **Convertir es la única forma de llegar a `convertido`.** Lo hace
  `CrmService.abrir`, con `origen_lead`, para que la regla de una oportunidad
  abierta por cliente y producto viva en un solo sitio. El cliente sale de la
  empresa enlazada, del sujeto del padrón que coincide con su RUC, o de una
  empresa nueva.
- **Descartar exige motivo.** Sin él no se puede revisar después.
- **La primera respuesta se marca sola** al salir de `nuevo` o al anotar una
  interacción saliente. Es el indicador que más pesa en la conversión.
- **El RUC pasa por `normalizarRuc`**: una cédula se completa con `001` y un
  RUC sin el cero inicial se repara con `coerceRuc`. Si no, no enlaza con el
  padrón.

## Lo público responde siempre lo mismo

`POST /crm/publico/f/:slug` dice «gracias» igual a un lead nuevo, a uno
repetido y a un robot (campo trampa o envío en menos de dos segundos).
Contestar distinto permitiría averiguar quién es cliente probando correos.
Lo que llega y no está en la definición del formulario se ignora.

## Consentimiento

Si la persona marca la casilla, se registra en `crm.consentimiento` —el mismo
que consultan las campañas— con origen `formulario <slug>`. Si no la marca, no
se toca nada: no marcarla no revoca un consentimiento anterior.

## Embudo

`GET /crm/leads/embudo` cuenta, por formulario y por fuente, visitas →
recibidos → atendidos → calificados → convertidos, y la mediana del tiempo de
primera respuesta. Las visitas son un número por día y formulario, sin datos de
quién: es lo que da la tasa de abandono sin guardar nada de quien no dejó sus
datos. Si hay más leads que visitas (envíos por JSON que no pasaron por la
página), el abandono no se calcula en vez de inventarlo.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET`  | `/crm/publico/f/:slug` | La página pública (cuenta una visita) |
| `GET`  | `/crm/publico/f/:slug/definicion` | Los campos en JSON, para un diseño propio |
| `POST` | `/crm/publico/f/:slug` | El envío: `<form>` (devuelve HTML) o JSON |
| `GET`  | `/crm/leads` | Bandeja, con `estado` (o `vivos`), `asignado`, `formulario`, `q` |
| `GET`  | `/crm/leads/:id` | Ficha con historial y coincidencias |
| `POST` | `/crm/leads` | Registrar a mano (feria, referido, llamada) |
| `POST` | `/crm/leads/:id/estado` | Contactado, calificado, descartado, recuperar |
| `POST` | `/crm/leads/:id/asignar` | Reasignar o devolver a la bandeja |
| `POST` | `/crm/leads/:id/interaccion` | Anotar una llamada, un WhatsApp… |
| `POST` | `/crm/leads/:id/convertir` | Abrir la oportunidad |
| `GET`  | `/crm/leads/embudo` | El embudo del período |
| `GET/POST/PATCH` | `/crm/formularios` | Alta y edición de formularios |

`CRM_URL_PUBLICA` es la base de las URL que se publican (la misma del enlace de
baja de las campañas). En producción, el dominio real del API.

## Lo que todavía no está

- **Captación desde Facebook Lead Ads y Google Ads.** Necesita las cuentas y
  los webhooks de cada plataforma; entrarán por `registrar`, como una fuente
  más.
- **La imagen del QR.** Se da la URL con `utm_source=qr`; generar la imagen
  pide una dependencia nueva y no se añadió para no tocar los lockfiles.
- **Límite de envíos por IP.** El campo trampa y el tiempo mínimo quitan el
  ruido de los robots genéricos; uno dirigido necesitaría además limitar por
  origen.
- **Landing pages.** El formulario se incrusta en páginas que ya existen; el
  constructor de páginas es otra pieza.
- **Calificación con IA.** El `puntaje` actual es por completitud y señales
  explícitas, y sirve para ordenar la bandeja.
