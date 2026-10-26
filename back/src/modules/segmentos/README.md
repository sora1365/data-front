# Capa comercial: perfil, segmentos y productos

Convierte la base en una herramienta de prospección: quién encaja con qué
producto, y sobre todo **quién encajó desde ayer**.

## Tres piezas

```
perfil_comercial   una fila por sujeto, con lo caro ya calculado  (vista materializada)
segmento           una definición guardada sobre ese perfil       (tabla, poblada en migraciones)
producto           lo que se vende, colgado de uno o más segmentos
```

## Por qué el segmento no vive dentro del producto

La tentación es colgar la consulta de cada producto. Se rompe en cuanto un
criterio alimenta a varios, que es el caso real: a una compañía recién creada se
le ofrecen **cinco** productos —FRIDAY, contabilidad, marketing, web y registro
de marca— con una sola definición. Si cada producto trajera sus datos, esa
definición se escribiría cinco veces, y el día que «reciente» pase de 12 a 18
meses cambiaría en cuatro sitios y en uno no.

Aquí el segmento es la unidad reutilizable y el producto lo consume. La consulta
inversa —«tengo esta empresa delante, ¿qué le ofrezco?»— sale del mismo sitio:
`GET /segmentos/sujeto/:tipo/:clave`.

## El perfil: una fila por sujeto, no por compañía

7,1 millones de filas: 226.191 compañías, 6,5 M personas naturales y 337.684
sociedades no supervisadas. Es deliberado — el segmento de contadores son 4.035
compañías y **69.396 personas naturales**: dejar fuera a las personas sería
dejar fuera el 94 % del segmento.

Reconstruirlo entero cuesta **~30 segundos**. Por eso es una vista materializada
y no una tabla mantenida a mano: no puede quedar desincronizada porque un
importador se olvide de actualizarla.

**No guarda nada relativo a «hoy».** Ni antigüedad en meses ni «creada hace
poco»: en una vista materializada eso envejece hasta ser mentira. Se guarda
`fecha_constitucion` y es la condición del segmento la que compara contra
`current_date`.

**Los dos últimos ejercicios CON balance, no dos años fijos.** Comparar «2025
contra 2024» a pelo daría nulo para quien presentó 2025 y 2023, que sí tiene una
variación que interesa. Los años quedan en `anio_ult` y `anio_prev` para el
segmento que necesite fijarlos.

## Las condiciones son SQL, y por eso no vienen del cliente

`segmento.condicion` es un fragmento que se interpola en un `WHERE`. Eso permite
expresar lo que un constructor de casillas no expresa:

```sql
p.activos_ult > 500000 AND coalesce(p.activos_prev, 0) <= 500000
```

Y es seguro **sólo** mientras la condición venga de la tabla, que se llena desde
migraciones revisadas como cualquier otro código. El API acepta códigos de
segmento, nunca fragmentos SQL. Si algún día hace falta que un usuario componga
segmentos, tendrá que ser con un constructor que genere la condición en el
servidor — no aceptándola por parámetro.

## Miembros y eventos, no fotos por corrida

La lista completa de un segmento se mira una vez. Lo que se trabaja a diario son
las **altas**: quién entró desde la corrida anterior. Por eso se guarda la
pertenencia actual (`segmento_miembro`) y el histórico de entradas y salidas
(`segmento_evento`), en vez de una foto completa por corrida que crecería sin
aportar nada.

La **primera** corrida de un segmento no genera eventos: sus 49.379 miembros
iniciales no son 49.379 novedades. Queda el conteo en `segmento_corrida`.

## El estado comercial se aplica al listar, no al segmentar

`sujeto_estado_comercial` marca a alguien como cliente, en gestión o «no
contactar», y esos desaparecen de la lista de trabajo. **No** se excluyen al
calcular el segmento: los conteos tienen que seguir diciendo la verdad sobre el
mercado, no sobre lo que queda por llamar.

Sin esta tabla, el mismo prospecto recibe cinco llamadas de cinco unidades
distintas en la misma semana.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET`  | `/segmentos` | Segmentos con tamaño, última corrida y productos |
| `GET`  | `/segmentos/catalogo` | Unidades → productos → segmentos |
| `POST` | `/segmentos/perfil/refrescar` | Reconstruye el perfil (~30 s) |
| `POST` | `/segmentos/correr` | Corre todos los activos |
| `POST` | `/segmentos/:codigo/correr` | Corre uno |
| `GET`  | `/segmentos/:codigo/miembros` | Lista de trabajo, con filtros |
| `GET`  | `/segmentos/:codigo/csv` | Exportación (tope 50.000 filas) |
| `GET`  | `/segmentos/sujeto/:tipo/:clave` | Qué ofrecerle a este sujeto |
| `POST` | `/segmentos/sujeto/:tipo/:clave/estado` | Cliente / en gestión / no contactar |

**El orden importa**: tras una importación hay que refrescar el perfil *antes*
de correr los segmentos. Los segmentos leen del perfil, no de las tablas de
origen.

## Los cinco segmentos iniciales

| Código | Miembros | Nota |
|---|---|---|
| `contadores` | 49.379 | CIIU `M6920` con RUC activo. El filtro de ACTIVO quita 24.000 RUC dormidos |
| `pymes_por_ingresos` | 26.225 | Ingresos entre 300 k y 5 M del último ejercicio |
| `companias_recien_creadas` | 22.664 | Alimenta cinco productos a la vez |
| `salto_umbral_auditoria` | 3.759 | Cruzaron los 500.000 en activos entre sus dos últimos cierres |
| `pymes_con_mas_de_5_empleados` | — | **Inactivo**: falta el número de empleados |

El último está registrado a propósito con `activo = false` y su motivo en
`bloqueo`, y la pantalla lo muestra igual: el hueco de datos tiene que verse
dentro de la herramienta en vez de vivir en la cabeza de alguien. Se desbloquea
cuando corra la carga de DataPortal, que es la única fuente de nómina.

## Devolución de impuestos

| Código | Miembros | Nota |
|---|---|---|
| `devolucion_iva` | 8.632 | Crédito de IVA que **se acumula** y ≥ 10.000 USD en el último ejercicio |
| `devolucion_renta` | 7.494 | Lo mismo con el crédito de impuesto a la renta |

Salen del diagnóstico del análisis tributario (`credito_tributario_empresa`):
sólo entra la etiqueta `acumula`, la única que apunta a impuesto no imputado.
Son dos y no uno porque una misma compañía puede estar compensando un impuesto
y acumulando el otro; las 1.881 que acumulan en ambos están en las dos listas.
Sólo compañías: el dato sale de los balances de la Superintendencia.

Su lista de trabajo es distinta: se ordena por el saldo del último ejercicio y
trae el crédito año por año con su diagnóstico (también en el CSV), en vez de
los activos. Los dos segmentos y su magnitud están en `SEGMENTOS_CREDITO`, en el
servicio. Entrar en el segmento **no** dice que la devolución proceda: eso
depende de la naturaleza del crédito, la caducidad y el respaldo.

## Un aviso que no es técnico

Los segmentos que incluyen personas naturales alcanzan decenas de miles de
personas físicas. Los datos son públicos, pero el uso comercial de datos
personales en Ecuador cae bajo la LOPDP. Conviene tener la respuesta preparada
antes de que la pregunte el primer cliente corporativo.
