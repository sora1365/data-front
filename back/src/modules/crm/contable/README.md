# API del módulo contable

El contable no vive en este repositorio. Esto no es una integración sino un
**contrato**: tablas que guardan lo que el otro sistema empuja y consultas que
le devuelven lo que necesita. Con las tablas vacías el CRM funciona igual; el
día que exista el contable, se llenan sin tocar nada más.

Todo cuelga de `/crm/contable` y va con llave:

```
X-Api-Key: <CONTABLE_API_KEY>
```

**Sin `CONTABLE_API_KEY` configurada la puerta está cerrada** (503), no
abierta. Un guardia que se desactiva solo cuando falta su configuración
protege exactamente hasta el día del despliegue en que a alguien se le olvida
la variable.

## Lo que entra

### `POST /crm/contable/inventario`

El catálogo **completo**, no un diferencial: lo que no venga se desactiva. Con
diferenciales hay que acertar con el orden de llegada, y perder un mensaje
deja al CRM con precios viejos para siempre.

```json
{ "articulos": [
  { "codigo": "TON-105A", "nombre": "Tóner HP 105A",
    "precio": 48, "iva": 15, "stock": 12, "unidad": "unidad" }
]}
```

Un lote con una fila mala no se tira entero: se guarda lo bueno y se devuelven
los rechazos con su fila y su motivo.

```json
{ "recibidos": 3, "guardados": 2, "desactivados": 0,
  "rechazos": [{ "fila": 3, "codigo": null, "motivo": "Sin código." }] }
```

Lo que desaparece del catálogo se **desactiva, no se borra**: una línea de
proforma de hace dos meses tiene que seguir diciendo qué se ofreció.

### `POST /crm/contable/nomina`

El costo por hora de cada perfil, o el sueldo del que sale. El CRM guarda el
costo del **perfil**, nunca sueldos nominales: un CRM con la nómina dentro
acaba enseñando sueldos a quien no debería verlos.

```json
{ "perfiles": [
  { "perfil": "asistente", "nombre": "Asistente contable",
    "sueldo_mes": 600, "carga_pct": 22, "horas_mes": 160, "personas": 3 },
  { "perfil": "senior", "nombre": "Contador senior", "costo_hora": 22 }
]}
```

Es lo que hace que un cotizador diga la verdad: con el costo hora tecleado a
mano se queda con el sueldo del año pasado y todo sale barato sin que nadie lo
note. Las tareas del cotizador que tienen `perfil` cobran de aquí.

### `POST /crm/contable/cobros`

Avisos sobre una venta: `facturada`, `cobrada` o `anulada`. La venta se
identifica por `venta` (el id que el CRM entregó) o por `proforma` (el número
que el contable tiene a la vista).

```json
{ "movimientos": [
  { "proforma": "P-2026-0004", "tipo": "facturada",
    "documento": "001-001-000012345", "fecha": "2026-10-22T10:00:00Z",
    "referencia": "fac-12345" },
  { "proforma": "P-2026-0004", "tipo": "cobrada", "monto": 2070,
    "fecha": "2026-10-23T09:00:00Z", "referencia": "cob-9981" }
]}
```

`referencia` hace el aviso repetible: mandarlo dos veces no cobra dos veces.
Sin ella, un reintento del contable contaría el cobro dos veces en las
comisiones del mes.

Las fechas que mandan son las del aviso, no las de llegada: una factura de
ayer registrada hoy pertenece a ayer, y con `now()` una venta de fin de mes se
pasaría al mes siguiente, donde cambia de periodo la comisión.

Se puede **cobrar sin haber facturado** —hay ventas que se cobran por
adelantado— pero facturar una ya cobrada no la hace retroceder: el dinero ya
entró y retroceder haría desaparecer la comisión del mes.

## Lo que sale

| Ruta | Qué devuelve |
|---|---|
| `GET /crm/contable/ventas?desde=` | Ventas pendientes de facturar, con las líneas de la proforma aceptada |
| `GET /crm/contable/cotizaciones?desde=` | Proformas aceptadas, por su número, con líneas y quién aceptó |
| `GET /crm/contable/comisiones?anio=&mes=` | Lo que hay que pagar por comercial, con su correo |
| `GET /crm/contable/ventas/:id/movimientos` | El historial de avisos de una venta |

Cada venta pendiente dice **qué le falta para poder facturarse** —RUC, razón
social, importe—. Una empresa creada a mano en el CRM puede no tener RUC, y
entregarla con el campo en nulo hace que el fallo aparezca del otro lado,
donde nadie sabe de qué venta se trata. No se esconde la venta: ocurrió, y se
entrega marcada.

Las comisiones salen de las **mismas reglas** que enseña el tablero —sobre lo
cobrado, con el umbral de cada regla— para que no haya dos cifras de comisión
en la empresa.

## Lo que mira la pantalla del CRM

`GET /crm/inventario`, `/crm/inventario/perfiles` y `/crm/inventario/estado`
van **sin llave**: son de sólo lectura y ya están detrás de la misma puerta
que el resto del CRM. Si colgaran del controlador con llave, la pantalla
tendría que llevar la llave del contable dentro del navegador, que es
exactamente donde no debe estar.
