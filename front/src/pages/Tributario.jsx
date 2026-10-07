import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Calculator, LoaderCircle, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  listarRiesgo,
  obtenerFichaTributaria,
  obtenerResumenTributario,
} from '../services/tributario.service'
import UtilidadesNoDistribuidas from './UtilidadesNoDistribuidas'
import CreditoTributario from './CreditoTributario'
import './Tributario.css'

/**
 * Las aristas del análisis tributario, cada una con su propia lógica.
 *
 * No comparten filtros ni orden a propósito: la presuntiva es un ranking que
 * hay que interpretar, y el pago a cuenta es una lista de avisos donde no hay
 * nada que interpretar. Meterlas en la misma tabla habría obligado a inventar
 * un criterio común que ninguna de las dos necesita.
 */
const VISTAS = [
  { id: 'presuntiva', titulo: 'Estimación presuntiva' },
  { id: 'no-distribuidas', titulo: 'Utilidades no distribuidas' },
  { id: 'credito', titulo: 'Crédito tributario' },
]

const dinero = n =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString('es-EC', { maximumFractionDigits: 0 })

const veces = n => (n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}×`)
const pctil = n => (n === null || n === undefined ? '—' : (Number(n) * 100).toFixed(0))
const coef = n => (n === null || n === undefined ? '—' : Number(n).toFixed(4))

const ETIQUETA_BASE = {
  activos: 'Activos',
  costos_gastos: 'Costos y gastos',
  ingresos: 'Ingresos',
}

const POBLACIONES = [
  { id: 'comparable', titulo: 'Comparables', ayuda: 'Declararon utilidad e ingresos positivos. Es el único ranking con percentil.' },
  { id: 'sin_utilidad', titulo: 'Sin utilidad', ayuda: 'Utilidad ≤ 0: la brecha es toda la base presunta, así que no se ordenan por ella.' },
  { id: 'sin_ingresos', titulo: 'Sin ingresos', ayuda: 'Sin ingresos ordinarios pero con activos: la presunción sale entera del coeficiente de activos.' },
]

const FILTROS_INICIALES = {
  anio: '',
  poblacion: 'comparable',
  persistencia: '',
  rama: '',
  q: '',
  brechaMinima: '100000',
  orden: 'percentil',
}

/** El decil alto es el corte que separa patrón de ruido, y se marca en pantalla. */
const claseP = p => (p === null || p === undefined ? '' : p >= 0.9 ? 'alto' : p >= 0.75 ? 'medio' : '')

export default function Tributario() {
  const [vista, setVista] = useState('presuntiva')
  const [resumen, setResumen] = useState(null)
  const [filtros, setFiltros] = useState(FILTROS_INICIALES)
  const [datos, setDatos] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [ficha, setFicha] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const LIMIT = 50

  useEffect(() => {
    obtenerResumenTributario().then(setResumen).catch(e => setError(e.message))
  }, [])

  const buscar = useCallback(async (f, desde) => {
    setCargando(true)
    setError(null)
    try {
      const params = { limit: LIMIT, offset: desde }
      Object.entries(f).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) params[k] = v
      })
      const res = await listarRiesgo(params)
      setDatos(res.datos)
      setTotal(res.total)
      setOffset(desde)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  // Debounce sólo del texto: el resto de filtros son clics y no repiquetean.
  const timer = useRef(null)
  useEffect(() => {
    if (vista !== 'presuntiva') return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => buscar(filtros, 0), 300)
    return () => clearTimeout(timer.current)
  }, [filtros, buscar, vista])

  const abrirFicha = async expediente => {
    setError(null)
    try {
      setFicha(await obtenerFichaTributaria(expediente))
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    }
  }

  const cambiar = (campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))
  const poblacionActual = POBLACIONES.find(p => p.id === filtros.poblacion)
  const navegarPestanas = (event, index) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % VISTAS.length
      : event.key === 'ArrowLeft' ? (index - 1 + VISTAS.length) % VISTAS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? VISTAS.length - 1 : null
    if (next === null) return
    event.preventDefault()
    setVista(VISTAS[next].id)
    document.getElementById(`tributario-tab-${VISTAS[next].id}`)?.focus()
  }

  return (
    <main className="tributario">
      <header className="tributario-hero">
        <div className="tributario-title-row">
          <span className="tributario-hero-icon" aria-hidden="true"><Calculator size={20} /></span>
          <div>
            <p className="tributario-eyebrow">LECTURA TRIBUTARIA</p>
            <h1>Análisis tributario</h1>
            <p className="tributario-intro">Explora exposición presuntiva, utilidades no distribuidas y crédito tributario.</p>
          </div>
        </div>
      </header>

      <div className="vistas" role="tablist" aria-label="Herramientas tributarias">
        {VISTAS.map((v, index) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`tributario-tab-${v.id}`}
            aria-controls="tributario-panel"
            aria-selected={vista === v.id}
            tabIndex={vista === v.id ? 0 : -1}
            className={vista === v.id ? 'activa' : ''}
            onKeyDown={event => navegarPestanas(event, index)}
            onClick={() => setVista(v.id)}
          >
            {v.titulo}
          </button>
        ))}
      </div>

      {vista === 'no-distribuidas' ? (
        <div role="tabpanel" id="tributario-panel" aria-labelledby={`tributario-tab-${vista}`}><UtilidadesNoDistribuidas /></div>
      ) : vista === 'credito' ? (
        <div role="tabpanel" id="tributario-panel" aria-labelledby={`tributario-tab-${vista}`}><CreditoTributario /></div>
      ) : (
        <>
      <div role="tabpanel" id="tributario-panel" aria-labelledby={`tributario-tab-${vista}`} className="tributario-panel">
      <Alert className="tributario-nota">
        <AlertTitle>Alcance de la estimación presuntiva</AlertTitle>
        <AlertDescription>Aplica los coeficientes del SRI (art. 4: se calcula sobre ingresos, sobre costos y gastos y sobre activos, y manda <strong>el mayor de los tres</strong>) y compara esa base con la utilidad del balance. Mide <strong>exposición, no deuda</strong>: la estimación presuntiva sólo procede cuando la contabilidad no permite determinar la base de forma directa. La base declarada es contable, no fiscal —no incluye la conciliación tributaria—. RIMPE queda fuera.</AlertDescription>
      </Alert>

      {resumen && (
        <Card className="tributario-panorama-card">
        <CardHeader className="tributario-section-header"><div><CardTitle>Panorama de la población</CardTitle><CardDescription>Balances por ejercicio, grupo de comparación y base que más pesa.</CardDescription></div></CardHeader>
        <CardContent><div className="panorama">
          {resumen.porAnio.map(a => (
            <div key={a.anio} className="tarjeta">
              <div className="anio">{a.anio}</div>
              <div className="cifra">{dinero(a.balances)}</div>
              <div className="pie">balances</div>
              <div className="reparto">
                <span title="Comparables">{dinero(a.comparables)} comp.</span>
                <span title="Sin utilidad">{dinero(a.sin_utilidad)} s/util.</span>
                <span title="Sin ingresos">{dinero(a.sin_ingresos)} s/ingr.</span>
              </div>
              <div className="manda" title="Qué base manda en la presunción">
                activos {Math.round((100 * a.manda_activos) / a.balances)} %
              </div>
            </div>
          ))}
          {resumen.persistencia && (
            <div className="tarjeta destacada">
              <div className="anio">Persistencia</div>
              <div className="cifra">{dinero(resumen.persistencia.decil_alto_4)}</div>
              <div className="pie">en el decil alto los 4 ejercicios</div>
              <div className="reparto">
                <span>{dinero(resumen.persistencia.decil_alto_3)} en 3</span>
                <span>{dinero(resumen.persistencia.companias)} perfiladas</span>
              </div>
            </div>
          )}
        </div></CardContent>
        </Card>
      )}

      <Card className="tributario-filtros-card">
      <CardHeader className="tributario-section-header">
        <div className="tributario-filter-heading"><span className="tributario-section-icon" aria-hidden="true"><Search size={16} /></span><div><CardTitle>Filtros del ranking</CardTitle><CardDescription>Define qué compañías y ejercicios quieres comparar.</CardDescription></div></div>
        <CardAction><Button type="button" variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_INICIALES)} disabled={Object.keys(FILTROS_INICIALES).every(k => filtros[k] === FILTROS_INICIALES[k])}>Restablecer</Button></CardAction>
      </CardHeader>
      <CardContent className="tributario-filter-content">
        <div className="filtros">
        <div className="poblaciones" role="group" aria-label="Población de compañías">
          {POBLACIONES.map(p => (
            <button
              key={p.id}
              type="button"
              aria-pressed={filtros.poblacion === p.id}
              className={filtros.poblacion === p.id ? 'activa' : ''}
              onClick={() => cambiar('poblacion', p.id)}
            >
              {p.titulo}
            </button>
          ))}
        </div>

        <FieldGroup className="tributario-filtros-grid">
          <Field><FieldLabel htmlFor="tributario-q">Nombre, RUC o expediente</FieldLabel><Input id="tributario-q" name="q" type="search" placeholder="Buscar compañía…" value={filtros.q} onChange={e => cambiar('q', e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="tributario-anio">Ejercicio</FieldLabel><select id="tributario-anio" name="anio" value={filtros.anio} onChange={e => cambiar('anio', e.target.value)}><option value="">Último ejercicio de cada una</option>{resumen?.porAnio.map(a => <option key={a.anio} value={a.anio}>Ejercicio {a.anio}</option>)}</select></Field>
          <Field><FieldLabel htmlFor="tributario-persistencia">Persistencia</FieldLabel><select id="tributario-persistencia" name="persistencia" value={filtros.persistencia} onChange={e => cambiar('persistencia', e.target.value)}><option value="">Cualquier persistencia</option><option value="1">1+ ejercicios en el decil alto</option><option value="2">2+ ejercicios</option><option value="3">3+ ejercicios</option><option value="4">Los 4 ejercicios</option></select></Field>
          <Field><FieldLabel htmlFor="tributario-rama">Rama de actividad</FieldLabel><Input id="tributario-rama" name="rama" placeholder="C, H52, H522" value={filtros.rama} onChange={e => cambiar('rama', e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="tributario-brecha">Brecha mínima</FieldLabel><select id="tributario-brecha" name="brechaMinima" value={filtros.brechaMinima} onChange={e => cambiar('brechaMinima', e.target.value)}><option value="">Sin mínimo de brecha</option><option value="10000">Brecha ≥ 10 mil</option><option value="100000">Brecha ≥ 100 mil</option><option value="1000000">Brecha ≥ 1 millón</option><option value="10000000">Brecha ≥ 10 millones</option></select></Field>
          <Field><FieldLabel htmlFor="tributario-orden">Ordenar por</FieldLabel><select id="tributario-orden" name="orden" value={filtros.orden} onChange={e => cambiar('orden', e.target.value)}><option value="percentil">Percentil sectorial</option><option value="brecha">Brecha del año</option><option value="brecha_total">Brecha acumulada</option></select></Field>
        </FieldGroup>
      </div>
      </CardContent>
      </Card>

      {poblacionActual && <p className="ayuda"><strong>{poblacionActual.titulo}:</strong> {poblacionActual.ayuda}</p>}
      {error && <Alert variant="destructive" className="tributario-error"><AlertTitle>No se pudo cargar la información</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Card className="tributario-resultados-card">
      <CardHeader className="tributario-section-header">
        <div><CardTitle>Ranking de compañías</CardTitle><CardDescription aria-live="polite">{cargando ? 'Actualizando resultados…' : `${dinero(total)} compañías · mostrando ${total ? offset + 1 : 0}–${Math.min(offset + LIMIT, total)}`}</CardDescription></div>
        <Badge variant="outline" className="tributario-count">{dinero(total)} resultados</Badge>
      </CardHeader>
      <CardContent className="tributario-results-content">
      <div className="tributario-tabla-scroll" role="region" aria-label="Ranking tributario" tabIndex={0}>
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Compañía</th>
            <th scope="col">Rama</th>
            <th scope="col" className="num">Año</th>
            <th scope="col" className="num">Percentil</th>
            <th scope="col">Base principal</th>
            <th scope="col" className="num">Declarado</th>
            <th scope="col" className="num">Base presunta</th>
            <th scope="col" className="num">Brecha</th>
            <th scope="col" className="num" title="Ejercicios en el decil alto de su rama">
              Persist.
            </th>
            <th scope="col"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {datos.map(d => (
            <tr key={`${d.expediente}-${d.anio}`}>
              <td className="nombre">
                {d.nombre}
                <span className="ruc">{d.ruc}</span>
              </td>
              <td className="rama" title={d.actividad ?? ''}>
                {d.grupo_ciiu}
              </td>
              <td className="num">{d.anio}</td>
              <td className={`num percentil ${claseP(d.percentil)}`}>
                {pctil(d.percentil)}
                {d.percentil !== null && d.percentil !== undefined && (
                  <span className="pares">/{dinero(d.n_pares)}</span>
                )}
              </td>
              <td>{ETIQUETA_BASE[d.base_manda] ?? '—'}</td>
              <td className="num">{dinero(d.declarada)}</td>
              <td className="num">{dinero(d.base_presunta)}</td>
              <td className="num brecha">{dinero(d.brecha)}</td>
              <td className={`num persist p${d.anios_decil_alto}`}>{d.anios_decil_alto}</td>
              <td className="tributario-row-action"><Button type="button" variant="outline" size="sm" onClick={() => abrirFicha(d.expediente)}>Ficha <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Button></td>
            </tr>
          ))}
          {!cargando && datos.length === 0 && (
            <tr>
              <td colSpan={10} className="vacio">
                Ninguna compañía con esos filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      <div className="paginacion">
        <Button variant="outline" size="sm" disabled={offset === 0 || cargando} onClick={() => buscar(filtros, Math.max(0, offset - LIMIT))}>
          ← Anterior
        </Button>
        <Button variant="outline" size="sm"
          disabled={offset + LIMIT >= total}
          onClick={() => buscar(filtros, offset + LIMIT)}
        >
          Siguiente →
        </Button>
      </div>
      </CardContent>
      </Card>
      </div>

      {ficha && (
        <div className="modal" onClick={() => setFicha(null)}>
          <div className="ficha" onClick={e => e.stopPropagation()}>
            <button className="cerrar" onClick={() => setFicha(null)}>
              ×
            </button>
            <a
              className="informe-link"
              href={`/informe-tributario/${ficha.empresa.expediente}`}
              target="_blank"
              rel="noreferrer"
            >
              Informe en PDF
            </a>
            <h3>{ficha.empresa.nombre}</h3>
            <p className="sub">
              RUC {ficha.empresa.ruc} · {ficha.empresa.grupo_ciiu}
              {ficha.empresa.actividad ? ` · ${ficha.empresa.actividad}` : ''}
              {ficha.empresa.rimpe && <span className="rimpe">RIMPE — fuera del alcance</span>}
            </p>

            <table className="tabla ficha-tabla">
              <thead>
                <tr>
                  <th>Ejercicio</th>
                  {ficha.ejercicios.map(e => (
                    <th key={e.anio} className="num">
                      {e.anio}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ingresos</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num">{dinero(e.ingresos)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Costos y gastos</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num">{dinero(e.costos_gastos)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Activos</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num">{dinero(e.activo)}</td>
                  ))}
                </tr>
                <tr className="separador">
                  <td>Coeficientes (ing. / c+g / act.)</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num coefs">
                      {coef(e.coef_ingresos)} / {coef(e.coef_costos_gastos)} /{' '}
                      {coef(e.coef_activos)}
                      {!e.coef_especifico && <span className="general">general art. 3</span>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Base sobre ingresos</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className={`num ${e.base_manda === 'ingresos' ? 'manda' : ''}`}>
                      {dinero(e.base_ingresos)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Base sobre costos y gastos</td>
                  {ficha.ejercicios.map(e => (
                    <td
                      key={e.anio}
                      className={`num ${e.base_manda === 'costos_gastos' ? 'manda' : ''}`}
                    >
                      {dinero(e.base_costos_gastos)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Base sobre activos</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className={`num ${e.base_manda === 'activos' ? 'manda' : ''}`}>
                      {dinero(e.base_activos)}
                    </td>
                  ))}
                </tr>
                <tr className="separador">
                  <td>
                    <strong>Base presunta</strong>
                  </td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num fuerte">{dinero(e.base_presunta)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Declarado (utilidad antes de impuestos)</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num">{dinero(e.declarada)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Brecha</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num brecha">{dinero(e.brecha)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Intensidad (brecha / ingresos)</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className="num">{veces(e.intensidad)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Percentil en su rama</td>
                  {ficha.ejercicios.map(e => (
                    <td key={e.anio} className={`num percentil ${claseP(e.percentil)}`}>
                      {pctil(e.percentil)}
                      <span className="pares">
                        {e.nivel_pares} {e.clave_pares} · n={dinero(e.n_pares)}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            {ficha.credito?.length > 0 && (
              <>
                <h4 className="sub-titulo">
                  Crédito tributario · devolución potencial
                  <span>
                    Impuesto ya pagado que sigue en el activo. Va hasta el último balance, así que
                    cubre más ejercicios que la presuntiva.
                  </span>
                </h4>
                <table className="tabla ficha-tabla">
                  <thead>
                    <tr>
                      <th>Ejercicio</th>
                      {ficha.credito.map(c => (
                        <th key={c.anio} className="num">
                          {c.anio}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Crédito por IVA</td>
                      {ficha.credito.map(c => (
                        <td key={c.anio} className="num">{dinero(c.iva)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>Crédito por impuesto a la renta</td>
                      {ficha.credito.map(c => (
                        <td key={c.anio} className="num">{dinero(c.ir)}</td>
                      ))}
                    </tr>
                    <tr className="separador">
                      <td>
                        <strong>Devolución potencial</strong>
                      </td>
                      {ficha.credito.map(c => (
                        <td key={c.anio} className="num fuerte">{dinero(c.total)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            <p className="fuente">
              Respaldo normativo:{' '}
              {ficha.resoluciones
                .map(r => `${r.anio}: ${r.resolucion}`)
                .join(' · ')}
            </p>
          </div>
        </div>
      )}
        </>
      )}
    </main>
  )
}
