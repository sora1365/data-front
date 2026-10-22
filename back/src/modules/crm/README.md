# CRM: lo que pasó después de la llamada

La capa comercial (`segmentos/`) responde **a quién llamar**. Esto guarda lo
otro: con quién se habló, qué se le ofreció, por cuánto y en qué va.

```
segmento  →  lista de trabajo  →  OPORTUNIDAD  →  ganada / perdida
                                       │
                                  contactos, interacciones, notas, tareas
```

## El cliente es un sujeto, no una ficha nueva

`crm_oportunidad` referencia `(tipo_sujeto, clave)` igual que
`segmento_miembro`, y el nombre, el RUC, la actividad y los ingresos se leen de
`perfil_comercial` en cada consulta.

La tentación es copiarlos a la oportunidad «para no cruzar siempre». Son dos
verdades desde el primer día: la importación corrige un nombre y el CRM sigue
enseñando el viejo, sin que nada falle. El perfil es una vista materializada con
índice único por `(tipo_sujeto, clave)`, así que el cruce es una búsqueda por
índice y no compensa desnormalizar.

Esto vale para los tres tipos de sujeto, no sólo para compañías: el segmento de
contadores son 4.035 compañías y 69.396 personas naturales.

## El enganche con el gestor comercial

Son cuatro reglas, y existen para que las dos pantallas no se contradigan:

1. **Abrir una oportunidad deja al sujeto `en_gestion`.** Es el único punto
   donde ese estado se pone solo. Ponerlo a mano es lo que nadie hace, y por eso
   cinco unidades llaman al mismo prospecto en la misma semana.
2. **Ganarla lo deja como `cliente`.**
3. **`no_contactar` bloquea la apertura** con un 409. Sin esto, la lista de
   trabajo esconde al sujeto y el CRM lo trabaja igual.
4. **Perder no devuelve a nadie a la lista de trabajo.** Perder una venta no
   borra que se habló con ese cliente, y puede tener otras oportunidades
   abiertas.

El estado se escribe llamando a `SegmentosService.marcarEstado`, **no con un
INSERT propio**: el estado comercial de un sujeto es uno solo, y escribirlo
desde dos sitios es cómo acaban difiriendo.

Las tres primeras reglas viven en `crm.reglas.ts` como funciones puras, que es
lo único de este módulo que se puede probar sin base de datos — y lo único que
tiene decisiones de negocio de verdad. Ver `crm.reglas.spec.ts`.

## Una oportunidad abierta por sujeto y producto

Lo garantiza un índice único parcial, no el código:

```sql
CREATE UNIQUE INDEX idx_crm_oport_abierta_unica
  ON crm_oportunidad (tipo_sujeto, clave, producto)
 WHERE archivada_en IS NULL
```

Es el error clásico cuando dos comerciales trabajan la misma lista: los dos
abren la misma venta y el embudo cuenta doble. Comprobarlo con un `SELECT`
antes del `INSERT` no cierra la carrera entre dos peticiones simultáneas; el
índice sí. El servicio sólo traduce el 23505 a un mensaje que diga qué pasó.

Las archivadas quedan fuera del índice, así que al mismo cliente se le puede
volver a ofrecer lo mismo el año que viene.

## El producto viene del catálogo, no es texto libre

`crm_oportunidad.producto` apunta a `producto(codigo)`, la misma tabla que
alimenta los segmentos. Con texto libre, «cuánto vendimos de Registro de Marca»
obliga a clasificar a mano lo que alguien escribió de siete formas distintas.

Por eso el alta vive en la lista de trabajo de un segmento y no en un formulario
vacío: `GET /segmentos/sujeto/:tipo/:clave` ya sabe qué se le ofrece a ese
sujeto y por qué. **Ese endpoint devuelve una fila por segmento y producto**, así
que el mismo producto llega repetido cuando el sujeto cae en dos segmentos que
lo ofrecen —el caso normal—: hay que deduplicar por código antes de pintarlo.

## Lo que se guarda pensando en lo que viene

Tres columnas no las usa todavía nadie, y están desde la primera migración
porque después se pagan caras:

- **`marca`** en oportunidades y leads. Añadirla luego es migrar datos ya
  cargados y revisar cada consulta.
- **`origen_segmento` y `origen_lead`.** Son los que permiten responder qué
  segmento y qué campaña convierten. No se reconstruyen después.
- **`crm_lead.recibido_en` / `primera_respuesta_en`.** El tiempo de respuesta
  sólo se mide si se guarda cuándo entró el lead.

Y una tabla entera: **`crm_interaccion`**. Nace registrando cambios de etapa y
llamadas a mano, pero es donde luego caen WhatsApp y correo. Si las llamadas
nacieran como notas, el día del historial unificado habría que migrarlas y
reescribir la ficha.

## Los leads no son sujetos

Un lead de pauta llega con un teléfono y nada más: no tiene RUC ni está en el
padrón, así que no puede ser un sujeto. Vive en `crm_lead` con `tipo_sujeto` y
`clave` en nulo, y se enlaza cuando alguien lo identifica. La oportunidad sí
exige sujeto.

## Quién firma

Toda escritura exige `X-Usuario` (`common/http/usuario.decorator.ts`). El
comercial **se da de alta solo la primera vez que firma**: mientras no haya
autenticación no existe un alta previa de usuarios, y exigir que alguien los
registre antes convertiría la primera oportunidad de cada persona en un error de
clave foránea. Asignarle la venta a *otro* sí exige que exista: ahí el nombre lo
escribe quien reparte el trabajo y un error de dedo crearía un comercial
fantasma con oportunidades que no vería nadie.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET`  | `/crm/catalogos` | Marcas, etapas, comerciales y etiquetas |
| `GET`  | `/crm/tablero` | Oportunidades por etapa (incluye las vacías) |
| `GET`  | `/crm/oportunidades/:id` | Ficha con sujeto, contactos, historial, notas y tareas |
| `POST` | `/crm/oportunidades` | Abrir |
| `PATCH`| `/crm/oportunidades/:id` | Monto, comercial, cierre, marca |
| `POST` | `/crm/oportunidades/:id/etapa` | Mover de etapa |
| `POST` | `/crm/oportunidades/:id/archivar` | Sacar del tablero sin borrar |
| `GET`  | `/crm/sujeto/:tipo/:clave` | Todo lo que el CRM sabe de un sujeto |

## Lo que todavía no está

Contactos, notas, tareas e interacciones **tienen tabla pero no endpoints de
escritura**: la ficha los muestra y el historial se llena solo con los cambios
de etapa. Es la siguiente entrega, junto con la agenda y `/crm/embudo`.
