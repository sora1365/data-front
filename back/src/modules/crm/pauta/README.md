# Pauta: presupuesto, gasto y retorno por campaña

Módulo 6 del requerimiento (marketing y campañas): cuánto se invierte en cada
campaña pagada y qué vuelve. Cierra el círculo que abrió la captación:

```
anuncio (utm_campaign) → lead → oportunidad (origen_lead) → venta (crm.venta)
   │                                                            │
   └── crm.pauta_gasto: lo que costó ───── CPL · CAC · ROAS · ROI ┘
```

## La campaña se reconoce por su `utm_campaign`

`crm.pauta.utm_campaign` es **única sin distinguir mayúsculas** y es lo único
que une la campaña con sus leads. El cruce se hace al consultar —`lower(lead.
origen_campania) = lower(pauta.utm_campaign)`— y no al guardar el lead, así que
un lead que llegó antes de dar de alta la campaña se le atribuye igual.

Si dos campañas pudieran compartir la etiqueta, el mismo lead contaría en las
dos y el retorno total saldría inflado: por eso el índice único.

La etiqueta no admite espacios: en un enlace llegan como `%20` y dejan de
coincidir. La pantalla arma el enlace del anuncio a partir de un formulario de
captación para que nadie la teclee dos veces con grafías distintas.

`GET /crm/pauta/sin-pauta` lista las etiquetas que traen leads y no tienen
campaña: es gasto que no está en ningún sitio, y con él fuera el retorno sale
mejor de lo que es.

## El gasto es una fila por día

`crm.pauta_gasto` tiene clave `(pauta, dia)`. Subir otra vez el mismo informe
—o uno más largo que lo incluye— reemplaza esos días, no los suma. Cada fila
dice si vino de un archivo o se tecleó, y quién la cargó.

El lector (`leerInformeDeGasto`, en `pauta.reglas.ts`) acepta lo que exportan
Meta, Google y TikTok y un CSV hecho a mano. Lo frágil está probado:

- **Codificación.** Google exporta en UTF-16; Excel en Windows, en Latin-1. Lo
  que no es UTF-16 pasa por `decodificarTexto`, el lector común del proyecto.
- **Decimal.** «1.234» es mil en un informe en español y uno coma dos en uno en
  inglés. Se decide por el archivo entero, nunca valor a valor.
- **Fechas con barra.** Día/mes o mes/día, también por el archivo: decidirlo
  fecha a fecha leería el 3 y el 13 de abril con reglas distintas.
- **Filas de total** («Total», «Total: cuenta») se saltan; sumarlas duplicaría
  el período. Varias filas del mismo día (un informe por conjunto de anuncios)
  se suman.
- **Clics:** se prefiere el clic en el enlace; los «clics (todos)» de Meta
  cuentan también reacciones y abren la foto.
- Los días fuera del período de la campaña no se guardan y se devuelven, por
  si la exportación arrastró otra campaña.

## Los indicadores

Los ingresos se leen de `crm.venta` siguiendo venta → oportunidad →
`origen_lead` → lead, **sin las anuladas**. No se copian a la campaña: habría
que corregirlos cada vez que se anula una venta.

| Indicador | Cuenta |
|---|---|
| CPL | gasto / leads |
| CAC | gasto / clientes (empresas distintas que compraron desde esa campaña) |
| ROAS | vendido / gasto |
| ROI | (vendido − gasto) / gasto; `roiCobrado`, lo mismo con lo cobrado |

Sin denominador el indicador es `null`, no cero: un CPL de cero diría que los
leads salieron gratis. El total de varias campañas se calcula sumando cifras,
no promediando indicadores.

**El ritmo** compara lo gastado con lo que se llevaría gastado repartiendo
parejo el presupuesto, con un 15 % de margen, y proyecta el cierre al ritmo
actual. «Hoy» es el día de Ecuador: con el del servidor, a las ocho de la noche
la campaña parecería llevar un día más.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET`  | `/crm/pauta` | Campañas con indicadores y total (`marca`, `plataforma`, `activas`) |
| `GET`  | `/crm/pauta/:id` | Una campaña, con gasto y leads día a día |
| `GET`  | `/crm/pauta/sin-pauta` | Etiquetas con leads y sin campaña |
| `POST` | `/crm/pauta` · `PATCH /crm/pauta/:id` | Alta y edición |
| `POST` | `/crm/pauta/:id/gasto` | Un día a mano (reemplaza si existía) |
| `DELETE` | `/crm/pauta/:id/gasto/:dia` | Quitar un día |
| `POST` | `/crm/pauta/:id/informe` | Subir el CSV de la plataforma (`file`) |

## Lo que todavía no está

- **Conexión directa con Meta, Google y TikTok Ads.** Hoy el gasto se sube con
  el informe que exportan; leerlo por API pide las cuentas y sus permisos, y
  entraría por el mismo `guardarDias`.
- **Clientes nuevos de verdad.** El CAC cuenta las empresas que compraron
  desde la campaña, aunque ya fueran clientes por otro lado.
- **Atribución multicanal.** Es a la campaña que trajo el lead (primer
  contacto, ver la captación); no reparte una venta entre varios anuncios.
