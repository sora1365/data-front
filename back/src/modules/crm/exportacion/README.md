# Exportación completa

Criterio de aceptación 12 de `Requerimientos CRM.pdf` —«exportar la
información de forma completa y verificable»—, el requisito de portabilidad y
el «historial de exportaciones y descargas» del módulo 16. En pantalla: menú de
usuario → **Exportar datos** (`/exportar`).

## Qué sale

Un ZIP con:

- `tablas/*.csv`: una tabla por archivo. Todo el esquema `crm` y las tablas de
  fuera a las que apunta (`public.producto`, `public.segmento`).
- `manifiesto.json`: tablas, filas, columnas, columnas omitidas y por qué, la
  huella SHA-256 de cada CSV y la última migración aplicada.
- `LEEME.txt`: cómo comprobarlo y cómo volver a cargarlo.

| Método | Ruta | Qué |
|---|---|---|
| `POST` | `/crm/exportacion/descargar` | El ZIP. Firmado con `X-Usuario` |
| `POST` | `/crm/exportacion/verificar` | Subir un ZIP (`archivo`): si está entero y si salió de aquí |
| `GET` | `/crm/exportacion` | Las últimas 50 exportaciones |

## Decisiones

**Completa, de verdad.** Las tablas salen del catálogo de Postgres, no de una
lista: una tabla nueva entra sola. Lo único que no sale son las llaves de los
enlaces públicos (`token`, `csat_token`), que son credenciales —quien tuviera
el archivo podría aceptar proformas en nombre de otros—, y el manifiesto lo
dice columna por columna.

**Una sola foto.** Todo se lee en una transacción `REPEATABLE READ` de sólo
lectura. Si no, alguien que crea una oportunidad a mitad de la exportación deja
una tarea apuntando a una oportunidad que no está en el archivo.

**El mismo dato da el mismo archivo.** Cada valor lo convierte a texto el
propio Postgres, en UTC, y las filas van por clave primaria. Nulo es una celda
vacía y el texto vacío `""`, que es como lo lee `COPY ... CSV`: el archivo
vuelve a la base tal como salió.

**Verificable de dos formas.** Con `sha256sum` contra el manifiesto, sin nada de
FRIDAY. Y subiéndolo aquí, que además compara contra **la copia del manifiesto
guardada al exportar**: quien edita una fila y pone la huella nueva en el
manifiesto deja el ZIP coherente, pero no puede tocar esa copia. Se busca por
fecha y autor y no por la huella del ZIP, que cambia con sólo volver a
comprimirlo.

**Queda anotado quién la sacó.** Por eso la descarga es un `POST` firmado y no
un enlace: un enlace del navegador no lleva la cabecera de quién es.

En el manifiesto `crm.exportacion` sale con una fila menos que en la base: la
exportación se anota después de la foto, como debe ser.

## Lo que falta

- Exportación parcial (una tabla, un filtro) a Excel desde las listas.
- Programar exportaciones automáticas (respaldo nocturno fuera del servidor).
- Cargar un ZIP en otra base desde la pantalla (hoy es `\copy` a mano, como
  explica el `LEEME.txt`).
