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

**Lo que se perdió al borrarlas, ya rehecho:** la anotación manual de
interacciones —llamada, visita, WhatsApp hablado por fuera— que vivía en
`Oportunidad.jsx`. Vuelve como `deals/Historial.tsx`, dentro de la ficha de la
oportunidad, que es donde está la persona cuando acaba de colgar el teléfono.
El back no se tocó: ya estaba entero
(`POST /crm/oportunidades/:id/interaccion`, con su lista cerrada de canales y
el rechazo de fechas futuras).

La lista de canales está escrita dos veces, aquí y en `crm.reglas.ts`, porque
los dos proyectos no comparten código. No se adivina desde el servidor a
propósito: un desplegable que se llena por red deja la pantalla sin poder
anotar nada cuando esa llamada falla.

## Una fecha de cierre no tiene hora

`cierre_estimado` es una columna `date`, y el driver la convierte en un `Date`
de JavaScript a medianoche local: al serializarla a JSON sale
`2026-11-30T05:00:00.000Z`. Un día concreto convertido en un instante, que en
un navegador al este de Greenwich se lee como el día siguiente. Sale como
texto `YYYY-MM-DD`, que es lo que la pantalla espera y lo que la fecha es.

Hasta aquí la ficha ni siquiera abría: `formatISODateString` **lanza** cuando
lo que recibe no es `YYYY-MM-DD`, y la guarda que traía Atomic era
`isValid(new Date(...))`, que deja pasar el nulo —`new Date(null)` es el 1 de
enero de 1970, una fecha válida—. Una oportunidad recién abierta, sin fecha de
cierre, mostraba «Something went wrong» en lugar de la ficha entera.

## Agenda

Calendarios compartidos al estilo TimeTree, no uno por persona: el calendario
es la unidad que se comparte, se filtra y se apaga. `puede_editar` separa
mirar de tocar, para que compartir no obligue a elegir entre que nadie lo vea o
que cualquiera lo cambie.

Los eventos pueden colgar de una empresa, un contacto o una oportunidad, y
guardan el **resultado** de la reunión: sin un sitio donde ponerlo acaba en una
nota suelta que nadie relaciona con la cita.

### Las tareas no son eventos, pero se ven en la agenda

Una tarea vence un día y no a una hora; un evento ocupa una franja. Meterlas en
la misma tabla obligaría a inventarle una hora a cada tarea, y aparecería a las
siete de la mañana tapando una cita de verdad. Van en la franja de arriba, que
es donde TimeTree pone lo de todo el día.

El puente va en un solo sentido: **el evento dice a qué tarea sirve**
(`crm.evento.tarea_id`). Reservar un rato para algo pendiente es el caso real,
y así la tarea sigue siendo la dueña de su vencimiento mientras la cita es sólo
cuándo se va a hacer. Una columna `evento` en la tarea sería falsa: nada impide
reservar dos ratos, y guardar el último haría desaparecer el primero.

**Lo pendiente que ya venció se arrastra a hoy**, en rojo y con los días de
retraso. Dejarlo en su día es exactamente cómo se pierde una tarea: la semana
siguiente nadie vuelve a mirar el jueves anterior. Lo ya hecho se queda donde
vencía, porque es el registro de lo que se hizo ese día.

**Cuál es «hoy» lo decide el reloj de quien mira.** `toISOString().slice(0, 10)`
da el día en UTC, y a las siete de la tarde en Ecuador ya es el día siguiente:
con eso, cada tarde lo de mañana se pintaría como vencido. La pantalla manda su
día y el servidor sólo lo usa de respaldo. Por lo mismo, `due_date` viaja como
texto `YYYY-MM-DD`: es una columna `date`, y serializada como instante una
tarea que vence el lunes aparece el domingo en cuanto el navegador está al este
de Greenwich.

## Tableros: el embudo se mide por el recorrido, no por la foto

El tablero de tarjetas dice en qué etapa está cada venta **hoy**, y con eso no
se contesta la pregunta que justifica un embudo: de cien oportunidades
abiertas, cuántas llegaron a propuesta. Una ganada ya no aparece en
«propuesta» aunque pasara por ahí, así que contar por etapa actual mide el
momento y no el recorrido.

Por eso `crm.oportunidad_etapa`: cada movimiento, como datos. El movimiento ya
se anotaba en `crm.interaccion` —«De «contacto» a «propuesta»»— pero como
frase: servía para leerla, no para contarla, y bastaba con cambiar las
comillas para que el embudo empezara a mentir sin que nada fallara. Se
mantienen las dos cosas: el historial que se lee en la ficha es uno solo.

Tres decisiones que hacen que los números signifiquen algo:

- **Llegar a una etapa es haber estado en ella o más allá.** Quien salta de
  «por contactar» a «negociación» pasó por propuesta; contándolo sólo donde se
  registró, el embudo enseñaría un agujero que no existe.
- **El embudo mide las oportunidades abiertas en el periodo, a lo largo de toda
  su vida**, no los movimientos del periodo. Contar movimientos mezcla
  recorridos: una venta de hace un año que se cierra hoy sumaría en la
  «propuesta» de este mes sin haber entrado por arriba, y la conversión saldría
  por encima del 100 %.
- **La tasa de cierre se mide sobre lo cerrado**, no sobre todo lo abierto. Con
  el otro denominador, el porcentaje sube solo al cerrar cosas viejas y baja
  cada vez que alguien abre una oportunidad nueva.

Las archivadas quedan fuera: se archiva lo abierto por error o por duplicado, y
contarlo hundiría la conversión con ventas que nunca existieron.

## Seguimiento: el plan genera tareas, no envíos

«Día 1 llamada, día 3 WhatsApp, día 7 correo» estaba en los requerimientos y
hoy vive en la cabeza de quien vende. Lo que se pierde no es el primer
contacto —ese lo hace todo el mundo— sino el tercero: la empresa que dijo
«escríbeme la semana que viene».

**Una secuencia crea tareas con su canal; no manda nada.** Mandar solo el
WhatsApp del tercer día es técnicamente igual de fácil y convierte el CRM en
algo que escribe a clientes sin que nadie lea lo que contestaron. Es la misma
regla que el rastreador de presencia: lo automático propone, una persona firma.
Las tareas caen en la agenda como cualquier otra, que es lo que hace que esto
sirva: el seguimiento aparece el martes junto a las visitas del martes.

Cuatro decisiones que no se ven:

- **Los días se cuentan desde el arranque, no desde el paso anterior.**
  Encadenando, un retraso de tres días en la primera llamada corre todo lo que
  viene detrás y el plan de una semana dura diez sin que nadie lo decida.
- **Lo que cae en sábado o domingo se mueve al lunes.** Una tarea comercial que
  vence en fin de semana se mira el lunes ya vencida, en rojo; si eso pasa con
  medio plan, el rojo deja de significar que algo va mal.
- **Las tareas se crean todas de golpe**, no una según se va haciendo la
  anterior. Así se ve el plan completo en la agenda de la semana que viene, y
  no hace falta un proceso que despierte cada noche a crear la siguiente.
- **Un seguimiento vivo por oportunidad.** Dos planes a la vez son dos
  calendarios de llamadas que no se conocen: al cliente le llaman dos veces el
  mismo día y las dos tareas dicen que toca.

Al ganar o perder, el seguimiento se corta solo y **lo pendiente se borra**, no
se marca como hecho: darlo por hecho diría que alguien llamó, y el historial
dejaría de servir para saber qué pasó de verdad. Lo ya hecho se queda. El
motivo del corte es obligatorio, porque «se cortó» no distingue haber cerrado
el trato de haberse rendido.

## Comisiones: se pagan sobre lo cobrado

La comisión se calcula sobre las ventas **cobradas** en el mes, no sobre las
ganadas. Pagar por una venta que todavía no entró es adelantar dinero contra
una factura que puede no cobrarse nunca, y descontarlo después del sueldo de
alguien es una conversación que no se quiere tener.

Lo ganado y pendiente de cobro se enseña aparte, como comisión **en camino**:
es lo que el comercial sí quiere ver, y es lo que evita que la cifra de arriba
parezca un error el mes que se vendió mucho y se cobró tarde.

El cumplimiento también se mide sobre lo cobrado, por lo mismo: si se midiera
sobre lo ganado, una venta que nadie ha pagado destrabaría el umbral a partir
del cual una regla empieza a pagar.

Otras tres decisiones:

- **Cada venta se fecha por lo que le toca**: lo cobrado por la fecha de cobro,
  lo pendiente por la fecha en que se ganó. Fechando todo por «ganada» una
  venta de diciembre cobrada en enero no contaría en enero, que es el mes en
  que se paga.
- **La regla más específica gana**: producto, luego marca, luego la general.
  Sin ese orden, una regla general del 5 % y una de producto del 8 % son dos
  respuestas correctas a la misma venta y la comisión depende del orden en que
  salgan de la consulta.
- **Una comisión en cero siempre dice por qué** —sin regla aplicable, o por
  debajo del umbral—. Un cero sin explicación se lee como un fallo del sistema
  y acaba en una reclamación.

Sin meta cargada, el umbral no bloquea el pago: no se le deja de pagar a
alguien por un dato que la empresa no puso.
