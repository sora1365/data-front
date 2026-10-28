# Duplicados

Encontrar y fusionar contactos y empresas repetidos: el «detectar y fusionar
contactos duplicados» del módulo 1 y el criterio de aceptación 2 de
`Requerimientos CRM.pdf`. En pantalla: menú de usuario → **Duplicados**
(`/duplicados`), y el botón «Fusionar con otro contacto» de Atomic al editar un
contacto, que ahora usa esto mismo.

## Endpoints

| Método | Ruta | Qué |
|---|---|---|
| `GET` | `/crm/duplicados` | Pares de contactos y de empresas, con motivos y lo que cuelga de cada ficha |
| `POST` | `/crm/duplicados/:tipo/fusionar` | `{ganador, perdedor}`. `tipo`: `contacto` o `empresa` |
| `POST` | `/crm/duplicados/:tipo/no-son` | `{a, b}`: no volver a proponerlos |
| `GET` | `/crm/duplicados/fusiones` | Las últimas fusiones |

## Cuándo dos fichas son la misma

| Contactos | Empresas |
|---|---|
| Mismo correo, sin importar mayúsculas | Mismo RUC (por sus cifras) |
| Mismo teléfono (los últimos nueve dígitos: `0991…`, `+593 99…` y `59399…` son el mismo) | Mismo nombre sin forma societaria: «ACME S.A.», «Acme SA» y «ACME, Sociedad Anónima» |
| Mismo nombre y apellido **dentro de la misma empresa** | |

Un dato compartido por más de cuatro fichas no cuenta: es el correo de la
oficina o la centralita, no un duplicado. Un nombre solo («Juan») tampoco.

## Decisiones

**Se fusiona en el servidor, en una transacción.** Atomic lo hacía desde el
navegador con una petición por tarea, nota y oportunidad: si una fallaba a
medias, el cliente quedaba repartido entre dos fichas. Y sólo conocía tres
tablas; en FRIDAY cuelgan de un contacto también conversaciones, eventos,
tickets, leads e interacciones.

**Lo que se mueve sale del catálogo de Postgres**, no de una lista escrita
aquí: todas las claves foráneas que apuntan a `crm.contacto` o `crm.empresa` en
el momento de fusionar, más `oportunidad.contact_ids`, que es un array. Una
lista a mano se queda vieja el día que otro módulo añade una tabla, y la fusión
dejaría esas filas colgando del perdedor —o las borraría con él: las notas y
tareas se borran en cascada con el contacto—.

**Nunca se pisa un dato del ganador.** Se rellenan sus huecos con lo del
perdedor; correos, teléfonos y etiquetas se unen sin repetir.

**Lo que impide fusionar empresas**: estar enlazadas a contribuyentes distintos
del padrón (son dos RUC, dos empresas), o tener las dos una oportunidad
abierta del mismo producto (quedarían dos ventas vivas de lo mismo). Se dice
cuáles, para resolverlo antes.

**La ficha borrada se guarda** entera en `crm.fusion`, con cuánto se movió de
cada tabla. Una fusión equivocada no se deshace sola, pero se puede
reconstruir.

**«No son la misma» se recuerda** (`crm.no_duplicado`): si no, la lista
vuelve a proponer cada día a los dos Juan Pérez distintos y la gente deja de
mirarla.

## Lo que falta

- Avisar al **crear** un contacto si ya existe (las empresas ya avisan).
- Deshacer una fusión con un botón.
- Duplicados entre leads y contactos que no se convirtieron.
