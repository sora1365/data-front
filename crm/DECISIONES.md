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

### Deshacer un «ganada» retira la venta

Ganar entrega la venta al módulo contable; sacar la tarjeta de «ganada» la
**anula**. Sin esto, deshacer un «ganada» puesto por error dejaba viva una
venta que el contable tenía pendiente de facturar y que el cuadro de
comisiones seguía contando como dinero en camino: una venta fantasma de un
trato que ya no existe.

Se anula y no se borra: la entrega ocurrió, y borrar la fila haría desaparecer
de los dos lados algo que alguien pudo empezar a tramitar. Volver a ganarla
revive esa misma fila con los datos de hoy en vez de crear otra, porque la
venta es única por oportunidad y con `DO NOTHING` la segunda vez no se
registraba ninguna.

Una venta ya facturada o cobrada no llega hasta aquí: el movimiento se rechaza
antes, porque existe un documento con efectos tributarios y deshacerlo es una
nota de crédito en el contable, no un arrastre de tarjeta.

## Proformas: la oferta por escrito y su aceptación

Hasta aquí una oportunidad tenía un importe suelto —un número en una tarjeta—
y lo que el cliente recibía era un correo escrito a mano. La proforma es el
documento: qué se le ofrece, por cuánto, hasta cuándo vale y quién dijo que sí.

**La lista de precios vive en el CRM**, no en `producto`. El catálogo es del
gestor comercial; añadirle una columna `precio` sería el CRM escribiendo en una
tabla de otro módulo. El precio se copia a la línea al cotizar, así que si
mañana sube la lista, lo ofrecido ayer sigue valiendo lo que decía.

**El IVA va por producto y no en una configuración global**: en Ecuador
conviven el 15 % y los servicios con tarifa cero, y un único porcentaje obliga
a corregir a mano cada proforma del otro tipo.

**Se redondea por línea y después se suma.** Sumando los valores largos y
redondeando al final, el total no cuadra con la suma de lo que el cliente ve
impreso, y esa diferencia de un céntimo es la que hace que llame.

**Una enviada no se edita.** El cliente tiene en la mano un documento con ese
número; cambiarle los precios por detrás es perder la discusión sobre lo que
se acordó. Para cambiarla se hace otra.

**El vencimiento no es un estado guardado** sino una comparación con hoy. Un
estado `vencida` en la tabla necesitaría un proceso nocturno que lo escribiera,
y mientras no pasara, la proforma diría que sigue viva. El último día cuenta:
una oferta «válida hasta el 30» que caduca el 30 por la mañana es una trampa.

**Aceptar gana la oportunidad**, con todo lo que arrastra: entrega la venta al
contable, corta el seguimiento y marca al sujeto como cliente. Es el sentido de
tener aceptación en línea; si el «sí» del cliente no moviera nada habría que
volver a teclearlo, y la mitad de las veces no se haría. Si el movimiento
fallara, la aceptación ya está guardada: es lo que no se puede perder.

El enlace del cliente va por un uuid y no por el id. Con el id, cualquiera que
reciba una proforma lee las demás cambiando un número en la barra de
direcciones, y ahí van el RUC y los precios de otros clientes.

## Cotizadores: de cuánto cuesta hacerlo a cuánto se cobra

Un precio de lista sirve para lo que siempre vale lo mismo. Un outsourcing
contable no: depende de qué tareas se hacen y de cuánto se mueve esa empresa.
Esa cuenta vivía en una hoja aparte, y seis meses después nadie podía decir por
qué un cliente paga 480 y el de al lado 700.

Un cotizador son **tareas con tiempos, un costo por hora y un margen**. Las
tareas tienen horas fijas y horas por unidad de una variable —transacciones al
mes, empleados, sucursales—, que es «asigno tiempos según la
transaccionalidad» sin inventar un lenguaje de fórmulas que luego nadie sabe
leer. Cada tarea puede tener su propio costo hora: revisar el balance no cuesta
lo que digitar facturas.

**El modo del margen se declara.** «30 % de margen» significa dos cosas y las
dos son normales: cargar un 30 % sobre el costo (100 → 130) o que la ganancia
sea el 30 % del precio (100 → 142,86). Dejarlo implícito es cotizar un 10 % por
debajo de lo que alguien cree, así que se guarda con cada cotización.

**Se guarda la cotización, no sólo el precio**: las entradas que se usaron y el
detalle por tarea. El costo por hora y el margen cambian, y recalcular una
cotización del año pasado con los números de hoy daría un precio que nadie
ofreció nunca. La línea de la proforma apunta a su cotización, así que «¿por
qué paga esto?» se contesta abriendo el documento.

En pantalla se enseña el costo y la ganancia junto al precio: quien negocia un
descuento tiene que ver cuánto margen le queda **antes** de concederlo.

## La frontera con el contable: la proforma viaja con la venta

Ganar entregaba al contable un importe suelto. Ahora la venta dice de qué
proforma salió y la entrega lleva **las líneas que el cliente aceptó**, con
cantidades, descuentos y el IVA de cada producto. Sin eso, la factura se arma a
mano en el otro sistema y es donde deja de cuadrar con la oferta.

Cuando hay proforma aceptada manda ella: su base imponible es lo que el cliente
aceptó por escrito, y sus datos son los del documento que recibió. El importe
de la tarjeta es una estimación interna que casi nunca se corrige después de
cotizar. `monto` sigue siendo la base sin IVA —subtotal menos descuentos—, que
es sobre lo que se calcula la comisión; el IVA lo recompone el contable desde
las líneas.

## El API del contable: lo que entra y lo que sale

El contable no está en este repositorio, así que esto es un contrato, no una
integración: tablas que guardan lo que el otro sistema empuja y consultas que
le devuelven lo que necesita. Con las tablas vacías el CRM funciona igual.
El detalle está en `back/src/modules/crm/contable/README.md`.

**Sin llave configurada, la puerta está cerrada** (503), no abierta. Es la
decisión que importa: un guardia que se desactiva solo cuando falta su
configuración protege hasta el día del despliegue en que se olvida la
variable.

**El inventario se copia, no se consulta en vivo.** Cotizar no puede depender
de que el otro sistema esté levantado: una pantalla en blanco cuando el
contable está en mantenimiento es una pantalla que nadie usa. Se enseña de
cuándo es el dato, que es lo que permite desconfiar de él.

**Llega el catálogo completo y lo que no viene se desactiva**, en vez de
diferenciales: perder un mensaje deja al CRM con precios viejos para siempre.
Y se desactiva en vez de borrarse, porque una línea de proforma de hace dos
meses tiene que seguir diciendo qué se ofreció.

**De la nómina entra el costo del perfil, nunca sueldos nominales.** Un CRM
con la nómina dentro acaba enseñando sueldos a quien no debería verlos, y para
cotizar basta con lo que cuesta la hora de un perfil. El cotizador lo usa: con
el costo hora tecleado a mano se queda con el sueldo del año pasado y todo
sale barato sin que nadie lo note. El orden es lo escrito a propósito en la
tarea, luego su perfil, luego el del cotizador.

**Cada aviso de cobro se guarda, no sólo el estado final.** La pregunta que
llega después no es «cómo está» sino «cuándo se facturó y cuándo entró el
dinero». Una factura anulada y reemitida son dos avisos, no uno corregido. La
`referencia` los hace repetibles: el contable reintenta, y sin eso un cobro
reenviado contaría dos veces en las comisiones.

Las fechas son las del aviso, no las de llegada: con `now()`, una venta de fin
de mes registrada el día 1 cambia de periodo y con él de comisión.

## Postventa: lo que pasa después de ganar

Es donde se cae casi todo el mundo: se persigue al cliente durante semanas, se
cierra la venta, y al día siguiente nadie vuelve a escribirle hasta que toca
renovar, si alguien se acuerda. Las tres piezas que lo evitan son las que ya
existían para vender, usadas al revés.

**Secuencias que arrancan al ganar.** El motor es el mismo que el de
prospección; lo único que faltaba era `aplica_a`, para que una secuencia de
postventa pueda aplicarse a una venta cerrada —que es justo lo que el
impedimento de prospección rechazaba—. Al revés también se comprueba: una
secuencia de postventa sobre una venta sin cerrar es felicitar a alguien por
algo que no ha comprado.

**La encuesta es una sola pregunta de 0 a 10 con su enlace**, como la
proforma. Los números van como botones grandes: una encuesta que cuesta tres
toques se contesta la mitad de las veces, y la mitad que falta es siempre la de
los clientes que no están contentos. El comentario es opcional pero se pide
siempre, porque el número dice que algo va mal y el comentario dice qué. La
respuesta queda además en el historial de la venta, que es donde la mira quien
la lleva.

**El NPS cuenta a los pasivos en el denominador.** Dejarlos fuera infla el
número justo cuando hay muchos clientes tibios, que es cuando más importa
saberlo. Sin respuestas devuelve «—» y no cero: un cero se lee como «vamos
regular», y la verdad es que no se sabe.

**No hay ningún proceso nocturno.** Las renovaciones que tocan se calculan al
preguntar, igual que las tareas vencidas: un programador que corre de
madrugada es una pieza que se cae en silencio y nadie lo nota hasta que pasan
tres meses sin avisos. Lo que ya venció sigue en la lista y marcado: una
renovación que pasó de fecha no desaparece del problema, se convierte en el
problema.

**Renovar abre una oportunidad, no da la venta por hecha.** Una renovación se
negocia —el precio sube, el cliente pide otra cosa— y darla por cerrada haría
que el embudo contara como ganado lo que falta trabajar.

### El índice de oportunidad única sólo mira las abiertas

Apareció al probar la primera renovación: el índice que impide dos
oportunidades del mismo producto contaba también las ganadas, así que un
cliente al que se le vendió contabilidad hace un año **no podía volver a
comprarla**. Lo mismo con quien dijo que no en marzo y vuelve en octubre.

La alternativa era archivar la oportunidad vieja al renovar, pero archivar es
lo que se hace con lo que se abrió por error: una ganada archivada desaparece
del embudo y del histórico, así que renovar habría borrado la venta del año
pasado de los números.

Los códigos de las etapas terminales van escritos dentro del índice, porque un
índice parcial no puede consultar `crm.etapa`. Si se añade otra etapa
terminal, hay que rehacerlo.

## Listas de trabajo: la memoria del intento

El gestor comercial sabe a quién llamar —convierte 7,1 millones de sujetos en
segmentos— y el CRM sabe qué pasó después de la llamada. Faltaba lo de en
medio: **que la lista recuerde**. Sin eso sale igual todos los días, y todos
los días se llama a los veinte primeros mientras el final del segmento no se
toca nunca.

Los miembros los da `SegmentosService`, no una consulta copiada: el día que
cambien las condiciones de un segmento, la lista de trabajo tiene que cambiar
con él. El CRM sólo les añade lo que sabe —si ya se llamó, cuándo toca volver,
si ya hay oportunidad abierta—.

**Una gestión no es una interacción.** `crm.interaccion` cuelga de una
oportunidad o de un contacto, y aquí el caso normal es el contrario: llamé a
una empresa que todavía no es nada en el CRM y no contestó. Crear una
oportunidad para poder anotarlo llenaría el tablero de tarjetas que nadie
abrió, y el embudo diría que se trabajaron ventas que no existieron.

**Cuándo vuelve cada uno:** quien no contesta, en dos días, y cada intento
seguido aleja el siguiente hasta un tope de treinta —llamar siete veces en una
semana no consigue nada que no consiga llamar tres veces en un mes, y quema el
contacto—; a quien no le interesa se le pregunta en seis meses; quien pide que
no lo llamen no vuelve nunca.

**«No le interesa» no es «no me llames».** Son dos cosas distintas y
confundirlas borra del mercado a medio segmento por una conversación de
treinta segundos. Sólo lo segundo se devuelve al gestor como `no_contactar`.

La devolución va por `marcarEstado`, el mismo método que usa el resto del CRM,
porque el estado comercial de un sujeto es uno solo. Y si el gestor no la
acepta, la gestión ya quedó guardada: lo que no se puede perder es lo que
acaba de anotar quien colgó el teléfono.

El orden pone primero **a quien nunca se ha llamado**, que es lo contrario de
lo que pasa solo. Y el rendimiento por segmento contesta la pregunta que
justifica tener segmentos: de lo que se llamó, cuánto acabó en oportunidad. Es
el embudo de antes del embudo.

### Guiones de llamada, al lado de la lista

Las primeras llamadas de alguien nuevo son malas no porque no sepa vender,
sino porque no sabe qué decir de **este** producto a **esta** empresa, y lo
aprende a costa de los primeros cuarenta números de la lista.

Lo que de verdad se guarda son **las objeciones y su respuesta**. La apertura
se aprende en tres llamadas; «ya tengo contador» se contesta bien o se pierde
la venta, y esa respuesta vive hoy en la cabeza de quien lleva más tiempo.

Gana el guion más específico —producto y segmento, luego producto, luego
segmento, luego el general—, el mismo orden que las reglas de comisión: dos
formas distintas de resolver «cuál de estos aplica» en el mismo sistema
obligan a recordar cuál es cuál, y es la clase de detalle que se recuerda al
revés. La pantalla dice de qué ámbito es el guion que está enseñando.

Una objeción sin respuesta no se guarda: media objeción en la pantalla de
quien está llamando es peor que ninguna, porque la lee y se queda a medias.

## Dos worktrees comparten la caché de Vite

Si se trabaja el CRM desde dos copias del repositorio a la vez —un worktree
enlaza `node_modules` a la carpeta principal—, los dos servidores de Vite
escriben en el mismo `crm/node_modules/.vite`. Como `npm run dev` lleva
`--force`, cada arranque de un lado reconstruye la caché del otro, y la
pantalla que estaba abierta acaba mezclando trozos de dos compilaciones: se
congela, o entra en un bucle de «Maximum update depth exceeded» que no
corresponde a ningún fallo del código.

No es un error que se pueda buscar en el código, así que queda escrito aquí.
Se arregla dándole a cada copia su propia caché (`cacheDir` en la
configuración de Vite) y, si ya pasó, parando ese servidor, borrando
`crm/node_modules/.vite` y volviéndolo a levantar.
