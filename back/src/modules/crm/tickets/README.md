# Tickets: servicio al cliente

El módulo 11 de `Requerimientos CRM.pdf`: lo que el cliente pide después de
comprar, con su plazo, su historial y qué tal se le atendió. Pantalla en el CRM:
**Soporte** (`/tickets`).

## Por dónde entran

| Canal | Cómo |
|---|---|
| Formulario público | `GET/POST /crm/publico/soporte`. Se enlaza solo si el RUC o el correo coinciden exactos |
| WhatsApp | Botón **Crear ticket** en la conversación (`POST /crm/tickets/desde-whatsapp/:id`) |
| Teléfono / en persona | **Nuevo ticket** en la pantalla |
| Correo | Todavía no: no hay buzón de entrada conectado |

## Endpoints

| Método | Ruta | Qué |
|---|---|---|
| `GET` | `/crm/tickets?vista=abiertos\|vencidos\|mios\|esperando\|terminados\|todos&q=` | Bandeja, ordenada por urgencia |
| `GET` | `/crm/tickets/resumen` | Indicadores de los últimos 30 días |
| `GET` | `/crm/tickets/catalogos` | Tipos, prioridades con su SLA, comerciales |
| `GET` | `/crm/tickets/:id` | Ficha con historial y otros tickets del cliente |
| `POST` | `/crm/tickets` | Crear |
| `PATCH` | `/crm/tickets/:id` | Prioridad, tipo, responsable, empresa |
| `POST` | `/crm/tickets/:id/estado` | `{estado, nota?}` |
| `POST` | `/crm/tickets/:id/eventos` | `{tipo: respuesta\|nota\|cliente, texto}` |
| `POST` | `/crm/tickets/:id/csat` | Mandar la encuesta de satisfacción |
| `GET/POST` | `/crm/tickets/csat/:token` | La encuesta, para el cliente |

## Decisiones

**El SLA va por prioridad y se copia al ticket.** `crm.ticket_sla` dice cuántas
horas hay para responder y para resolver (urgente 1/8, alta 4/24, media 8/72,
baja 24/168); cada ticket se lleva las suyas al crearse. Si mañana se aprieta la
política, el cumplimiento del mes pasado no cambia. Cambiar la prioridad sí
recalcula, desde la creación: subir a urgente un ticket de hace dos días lo deja
vencido en el acto, que es lo que es. Son horas de reloj, no laborables.

**Esperar al cliente para el reloj de la resolución**, no el de la primera
respuesta. Sin la pausa, un ticket que espera cuatro días un documento del
cliente sale incumplido por culpa del cliente. Anotar «lo que dijo el cliente»
lo vuelve a poner en curso.

**Vencido no es un estado guardado**: se calcula al preguntar
(`tickets.reglas.ts`), como las proformas y las renovaciones. Y la lista se
filtra por vencidos después de calcular, no en SQL, para no tener dos
definiciones de «vencido».

**La etiqueta de la lista mira sólo lo pendiente.** Una primera respuesta que
salió tarde ya no tiene arreglo; si contara, el ticket saldría vencido hasta el
final y la vista de vencidos se llenaría de cosas donde no hay nada que hacer.
Ese retraso aparece en el indicador «% a tiempo».

**Quejas y reclamos nacen en alta**, salvo que se pida otra. El formulario
público no deja elegir prioridad: si se deja, todo llega urgente.

**Sin responder no se resuelve.** Resolver sin haber anotado qué se le dijo es
cerrar algo que el cliente no sabe que se resolvió.

**Cerrado es final.** Si vuelve a pasar es otro ticket; reabrir uno cerrado
haría que el tiempo de resolución de hace tres meses cambiara hoy. Lo resuelto
sí se reabre, y se cuenta.

**Sin responsable, el que lleva la cuenta.** No siempre es quien atiende
soporte, pero es quien tiene que enterarse, y un ticket sin dueño no lo mira
nadie.

**La encuesta (CSAT, 1 a 5) la manda una persona**, no el sistema al resolver:
a veces resolver es «el cliente dejó de contestar», y preguntarle ahí qué tal le
atendimos es echar sal en la herida. Se publica como % de 4 y 5, no como
promedio. Es otra pregunta que el NPS de postventa: aquél es «¿nos
recomendarías?», éste «¿te resolvimos esto?».

**Las respuestas todavía no salen solas.** Se contesta por el canal de siempre
y se anota aquí, como el historial de las oportunidades. La tabla
(`crm.ticket_evento`) es la misma en la que caerán cuando WhatsApp y correo
estén conectados.

## Lo que falta del módulo 11

- Base de conocimiento y preguntas frecuentes.
- Tickets desde el correo (no hay buzón de entrada).
- Alertas fuera de la pantalla (hoy se ve al abrir Soporte; no avisa por correo).
- Tickets en la ficha de la empresa, y que un CSAT bajo cuente en el riesgo de
  pérdida del cliente.
- Pantalla para editar la política de SLA (hoy se cambia en `crm.ticket_sla`).
