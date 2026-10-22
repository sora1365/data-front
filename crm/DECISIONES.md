# Decisiones del CRM

Lo que se decidió y por qué, para no volver a discutirlo ni descubrirlo leyendo
el código. La lista completa de lo que el CRM debe llegar a hacer está en
`Requerimientos CRM.pdf` (20 módulos, cuatro fases); esto recoge sólo lo que ya
está resuelto o comprometido.

## El CRM y el gestor comercial son dos módulos

El gestor comercial (`/segmentos`) dice **a quién llamar**; el CRM guarda **qué
pasó después de la llamada**. Nada del CRM vive dentro del gestor: son dos
aplicaciones, en dos puertos, con dos esquemas de base de datos.

Comparten la misma base —lo que permite que una venta referencie un producto y
que una empresa se enlace a un sujeto sin copiar nada— pero cada uno tiene su
esquema: `crm.*` y `public.*`. Un prefijo no separa; un esquema sí, y permite
dar permisos distintos a cada módulo cuando haga falta.

## Las empresas son del CRM, no del padrón

Al principio la empresa **era** un sujeto del padrón ecuatoriano, de sólo
lectura. Se cambió: ahora es una fila de `crm.empresa`, editable, con
`tipo_sujeto` y `clave` enlazando al padrón **cuando el cliente está en él**.

- Con enlace, el CRM ve la actividad, los balances y el estado comercial que el
  gestor ya calculó.
- Sin enlace, la empresa funciona igual. Es lo que permite registrar a un
  proveedor extranjero, a una empresa recién creada o a una cartera subida
  desde un Excel — y es imprescindible para vender el CRM a una empresa que no
  sea de Ecuador.

**Al crear una empresa, el CRM avisa si ya existe**: en el propio CRM (crear
otra partiría el historial del cliente en dos) o en el padrón (enlazarla ahorra
teclear y aporta lo que FRIDAY sabe). Avisa, no bloquea: dos empresas pueden
llamarse parecido y ser distintas.

## El paso al módulo contable

El módulo contable vive fuera de este repositorio y **consulta a FRIDAY**: pide
qué hay pendiente de facturar y marca lo que emite. Ganar una oportunidad crea
una fila en `crm.venta` con su propio ciclo (pendiente → facturada → cobrada).

Detalles en `back/src/modules/crm/README.md`.

## Idioma

La interfaz va en español entera. El código se queda en inglés, que es como
vino de Atomic CRM. El esquema está en español salvo las columnas que las
pantallas leen por su nombre (`first_name`, `due_date`…), que no se traducen
porque hacerlo obligaría a mapear cada campo en el camino.

## Agenda: el modelo de TimeTree

Cuando se construya el módulo 8, la agenda sigue el modelo de **TimeTree** y no
el de un calendario por persona:

- **Varios calendarios compartidos**, no uno por usuario. Un calendario se crea,
  se invita a quien corresponda y listo: comercial, por marca, por equipo, de
  visitas.
- **Filtros para combinarlos o aislarlos**, de modo que cada quien vea lo suyo,
  lo del equipo o todo junto sin cambiar de pantalla.
- **Archivos adjuntos en los eventos** (la propuesta que se va a presentar, el
  acta anterior).
- **Vista vertical** del día y la semana.
- **Eventos marcados como importantes**, que destacan sobre el resto.

Sobre eso, la sincronización: **agenda propia como fuente de verdad**, y cada
persona conecta su Google Calendar o su Outlook si quiere, o ninguno. Depender
de un solo proveedor deja sin disponibilidad fiable a un equipo con medio mundo
en Google y medio en Microsoft.

## Lo que todavía no es verdad

- **No hay autenticación.** El nombre que se escribe al entrar firma lo que se
  hace; no se comprueba contra nada. Identifica, no protege.
- **WhatsApp no está conectado.** Hace falta cuenta de WhatsApp Business
  Platform, número verificado y plantillas aprobadas por Meta; el trámite tarda
  días.
- **Contactos, notas y tareas** tienen tabla y pantalla, pero no se han
  ejercitado de punta a punta.
- **El historial no se llena solo.** Una llamada, un WhatsApp o una visita se
  anotan a mano en la ficha de la oportunidad (`/crm/oportunidades/:id`). La
  tabla es la misma en la que caerán WhatsApp y correo cuando haya integración,
  así que lo anotado hoy no habrá que migrarlo. El `ActivityLog` de Atomic no
  la mira: compone su lista en el navegador cruzando notas y oportunidades.

## Una sola ficha: el CRM vive en el 3002

El front de FRIDAY (3000) tuvo pantallas de CRM mientras se construía. Se
borraron: dos fichas de la misma oportunidad llevan a trabajar en la que no es,
y a añadir cosas a la que se va a tirar. El menú de FRIDAY conserva un enlace
externo al CRM y nada más.

**Lo que se perdió al borrarlas y falta rehacer:** la anotación manual de
interacciones —llamada, visita, WhatsApp hablado por fuera— que vivía en
`Oportunidad.jsx`. El back sigue entero (`POST /crm/oportunidades/:id/interaccion`,
con su lista cerrada de canales y el rechazo de fechas futuras); lo que no hay
es dónde hacerlo desde la pantalla.

## Agenda

Calendarios compartidos al estilo TimeTree, no uno por persona: el calendario
es la unidad que se comparte, se filtra y se apaga. `puede_editar` separa
mirar de tocar, para que compartir no obligue a elegir entre que nadie lo vea o
que cualquiera lo cambie.

Los eventos pueden colgar de una empresa, un contacto o una oportunidad, y
guardan el **resultado** de la reunión: sin un sitio donde ponerlo acaba en una
nota suelta que nadie relaciona con la cita.
