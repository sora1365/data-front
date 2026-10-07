import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ChartNoAxesCombined, FileSearch, LoaderCircle, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  listarBalances,
  obtenerComparativo,
  obtenerEstados,
  obtenerIndicadores,
  obtenerSectorial,
} from '../services/balances.service'
import './Analisis.css'

const dinero = n =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ratio = n => (n === null || n === undefined ? '—' : n.toFixed(2))
const pct = n => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)} %`)

const formatear = (valor, formato) =>
  formato === 'pct' ? pct(valor) : formato === 'dinero' ? dinero(valor) : ratio(valor)

/**
 * Variación porcentual entre dos períodos.
 *
 * Devuelve null cuando la base es cero —no hay variación porcentual sobre cero—
 * y también cuando cambia de signo: pasar de -100 a +50 no es "un 150 % más",
 * es una recuperación, y expresarla como porcentaje engaña más que informa.
 */
function variacion(antes, ahora) {
  if (antes === null || antes === undefined || ahora === null || ahora === undefined) return null
  if (antes === 0) return null
  if (antes < 0 && ahora >= 0) return null
  if (antes > 0 && ahora < 0) return null
  return ((ahora - antes) / Math.abs(antes)) * 100
}

const claseVar = v => (v === null ? '' : v > 0.05 ? 'sube' : v < -0.05 ? 'baja' : '')
const textoVar = v => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`)

const PESTANAS = [
  { id: 'estados', titulo: 'Estados financieros' },
  { id: 'indicadores', titulo: 'Indicadores' },
  { id: 'sector', titulo: 'Comparación sectorial' },
  { id: 'resumen', titulo: 'Resumen comparable' },
]

export default function Analisis() {
  const [params] = useSearchParams()
  const [busqueda, setBusqueda] = useState('')
  const [candidatas, setCandidatas] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [pestana, setPestana] = useState('estados')
  const [error, setError] = useState(null)

  const [estados, setEstados] = useState(null)
  const [indicadores, setIndicadores] = useState(null)
  const [sectorial, setSectorial] = useState(null)
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(false)

  // Buscador con debounce; una consulta por letra sería una por cada 578.000 filas.
  const timer = useRef(null)
  useEffect(() => {
    if (busqueda.trim().length < 3) {
      setCandidatas([])
      return
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const esRuc = /^\d+$/.test(busqueda.trim())
        const res = await listarBalances({
          [esRuc ? 'ruc' : 'nombre']: busqueda.trim(),
          anio: 2025,
          limit: 15,
        })
        setCandidatas(res.datos)
      } catch (e) {
        setError(e?.response?.data?.message ?? e.message)
      }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [busqueda])

  const seleccionar = useCallback(async exp => {
    setCargando(true)
    setError(null)
    setCandidatas([])
    try {
      const [e, i, r, s] = await Promise.all([
        obtenerEstados(exp),
        obtenerIndicadores(exp),
        obtenerComparativo(exp),
        // Una compañía sin percentiles calculados no es un error de la ficha:
        // el resto del análisis se muestra igual y la pestaña sectorial avisa.
        obtenerSectorial(exp).catch(() => null),
      ])
      setEstados(e)
      setIndicadores(i)
      setResumen(r)
      setSectorial(s)
      setEmpresa({ expediente: exp, nombre: i.nombre, ruc: i.ruc, rama: i.descripcionRama })
    } catch (err) {
      setError(err?.response?.data?.message ?? err.message)
    } finally {
      setCargando(false)
    }
  }, [])

  // Permite llegar desde la pantalla de Balances con la compañía ya elegida.
  const expedienteUrl = params.get('expediente')
  useEffect(() => {
    if (expedienteUrl) void seleccionar(expedienteUrl)
  }, [expedienteUrl, seleccionar])

  return (
    <main className="analisis">
      <header className="analisis-hero">
        <div className="analisis-title-row">
          <span className="analisis-hero-icon" aria-hidden="true"><ChartNoAxesCombined size={20} /></span>
          <div>
            <p className="analisis-eyebrow">LECTURA FINANCIERA</p>
            <h1>Análisis financiero</h1>
            <p className="analisis-intro">Compara la evolución, los indicadores y el desempeño sectorial de una compañía.</p>
          </div>
        </div>
      </header>

      <Card className="analisis-busqueda-card">
        <CardHeader className="analisis-card-header">
          <div className="analisis-card-heading">
            <span className="analisis-section-icon" aria-hidden="true"><Search size={16} /></span>
            <div>
              <CardTitle>Selecciona una compañía</CardTitle>
              <CardDescription>Busca por razón social o RUC para cargar su análisis financiero.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="buscador">
            <Field>
              <FieldLabel htmlFor="analisis-compania">Compañía o RUC</FieldLabel>
              <Input id="analisis-compania" name="compania" type="search" autoComplete="off" placeholder="Escribe al menos 3 caracteres…" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-controls="analisis-sugerencias" aria-expanded={candidatas.length > 0} />
            </Field>
        {candidatas.length > 0 && (
          <ul className="sugerencias" id="analisis-sugerencias">
            {candidatas.map(c => (
              <li key={c.expediente}>
                <button type="button" onClick={() => seleccionar(c.expediente)}>
                  <strong>{c.nombre}</strong>
                  <span>
                    {c.ruc} · exp. {c.expediente}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
          </div>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive" className="analisis-feedback"><AlertTitle>No se pudo cargar el análisis</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {cargando && <Alert className="analisis-loading" aria-live="polite"><LoaderCircle className="animate-spin" aria-hidden="true" /><AlertTitle>Cargando análisis financiero…</AlertTitle><AlertDescription>Estamos reuniendo los estados, indicadores y referencias sectoriales.</AlertDescription></Alert>}

      {empresa && !cargando && (
        <>
          <Card className="analisis-empresa-card">
          <CardContent className="ficha">
            <div>
              <div className="analisis-empresa-heading"><span className="analisis-company-icon" aria-hidden="true"><FileSearch size={18} /></span><div><p className="analisis-eyebrow">COMPAÑÍA SELECCIONADA</p><h2>{empresa.nombre}</h2></div></div>
              <p className="sub">
                <Badge variant="outline">RUC {empresa.ruc}</Badge>
                <Badge variant="outline">Expediente {empresa.expediente}</Badge>
                {empresa.rama && <Badge variant="secondary">{empresa.rama}</Badge>}
              </p>
            </div>
            {/* El informe se abre en una pestaña propia: quien lo genera suele
                querer seguir consultando el análisis mientras tanto. */}
            <Button asChild variant="outline" className="boton-informe"><a href={`/informe/${empresa.expediente}`} target="_blank" rel="noreferrer">Informe PDF <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></a></Button>
          </CardContent>
          </Card>

          <Card className="analisis-workspace-card">
          <div className="pestanas" role="tablist" aria-label="Secciones del análisis financiero">
            {PESTANAS.map(p => (
              <button
                key={p.id}
                type="button"
                role="tab"
                id={`analisis-tab-${p.id}`}
                aria-controls="analisis-panel"
                aria-selected={pestana === p.id}
                tabIndex={pestana === p.id ? 0 : -1}
                className={pestana === p.id ? 'activa' : ''}
                onClick={() => setPestana(p.id)}
              >
                {p.titulo}
              </button>
            ))}
          </div>

          <CardContent className="analisis-panel-content" role="tabpanel" id="analisis-panel" aria-labelledby={`analisis-tab-${pestana}`}>
            {pestana === 'estados' && <Estados datos={estados} />}
            {pestana === 'indicadores' && <Indicadores datos={indicadores} />}
            {pestana === 'sector' && <Sectorial datos={sectorial} />}
            {pestana === 'resumen' && <Resumen datos={resumen} />}
          </CardContent>
          </Card>
        </>
      )}

      {!empresa && !cargando && (
        <Card className="analisis-empty-card"><CardContent className="analisis-empty-content"><span className="analisis-empty-icon" aria-hidden="true"><Search size={20} /></span><strong>Empieza buscando una compañía</strong><span>Escribe al menos tres caracteres. Puedes usar una razón social o un RUC.</span></CardContent></Card>
      )}
    </main>
  )
}

/**
 * Cabecera de una tabla comparativa: un año, y entre cada par de años su
 * variación. No sólo la del último período — el objetivo es ver la evolución
 * completa de un vistazo.
 */
function CabeceraAnios({ anios, formularios }) {
  const celdas = []
  anios.forEach((a, i) => {
    celdas.push(
      <th key={`a${a}`} className="derecha">
        {a}
        {formularios && formularios[i] !== 1 && <sup title="Formulario fiscal">F</sup>}
      </th>
    )
    if (i < anios.length - 1) {
      celdas.push(
        <th key={`v${a}`} className="derecha var">
          {String(anios[i + 1]).slice(2)}/{String(a).slice(2)}
        </th>
      )
    }
  })
  return <tr>{[<th key="c">Concepto</th>, ...celdas]}</tr>
}

/** Fila con un valor por año y la variación intercalada entre cada par. */
function FilaComparativa({ etiqueta, valores, formato, sangria = 0, destacada = false }) {
  const celdas = []
  valores.forEach((v, i) => {
    celdas.push(
      <td key={`v${i}`} className="derecha mono">
        {formatear(v, formato)}
      </td>
    )
    if (i < valores.length - 1) {
      const d = variacion(v, valores[i + 1])
      celdas.push(
        <td key={`d${i}`} className={`derecha mono var ${claseVar(d)}`}>
          {textoVar(d)}
        </td>
      )
    }
  })
  return (
    <tr className={destacada ? 'destacada' : ''}>
      <td style={{ paddingLeft: `${0.7 + sangria * 0.9}rem` }}>{etiqueta}</td>
      {celdas}
    </tr>
  )
}

/** Estados financieros completos: TODAS las cuentas del plan, no sólo las madre. */
function Estados({ datos }) {
  const [soloConValor, setSoloConValor] = useState(true)
  const [nivelMax, setNivelMax] = useState(9)
  if (!datos) return null

  const visibles = datos.cuentas.filter(
    c => c.nivel <= nivelMax && (!soloConValor || c.valores.some(v => v !== 0))
  )

  return (
    <div className="bloque">
      <div className="controles">
        <label className="check">
          <input
            type="checkbox"
            checked={soloConValor}
            onChange={e => setSoloConValor(e.target.checked)}
          />
          Ocultar cuentas en cero en todos los años
        </label>
        <label className="check">
          Nivel máximo
          <select value={nivelMax} onChange={e => setNivelMax(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 9].map(n => (
              <option key={n} value={n}>
                {n === 9 ? 'Todos' : n}
              </option>
            ))}
          </select>
        </label>
        <span className="conteo">
          {visibles.length} de {datos.cuentas.length} cuentas
        </span>
      </div>

      {datos.formulariosDisponibles.length > 1 && (
        <p className="aviso">
          Esta compañía declaró en más de un formulario. Aquí se muestran sólo los años
          del formulario {datos.formulario}: los planes de cuentas no tienen equivalencia
          cuenta a cuenta. Para comparar todos los años, usa «Resumen comparable».
        </p>
      )}

      <div className="scroll">
        <table className="tabla">
          <thead>
            <CabeceraAnios anios={datos.anios} />
          </thead>
          <tbody>
            {visibles.map(c => (
              <FilaComparativa
                key={c.codigo}
                etiqueta={
                  <>
                    <span className="codigo">{c.codigo}</span> {c.nombre}
                  </>
                }
                valores={c.valores}
                formato="dinero"
                sangria={Math.min(c.nivel - 1, 5)}
                destacada={c.nivel === 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Indicadores financieros, agrupados y comparados año a año. */
function Indicadores({ datos }) {
  if (!datos) return null
  return (
    <div className="bloque">
      {datos.grupos.map(g => {
        const filas = datos.indicadores.filter(i => i.grupo === g.id)
        if (filas.length === 0) return null
        return (
          <div key={g.id}>
            <h4>{g.titulo}</h4>
            <div className="scroll">
              <table className="tabla">
                <thead>
                  <CabeceraAnios anios={datos.anios} formularios={datos.formularios} />
                </thead>
                <tbody>
                  {filas.map(i => (
                    <FilaComparativa
                      key={i.clave}
                      etiqueta={i.etiqueta}
                      valores={i.valores}
                      formato={i.formato}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <p className="aviso">
        Un guion significa que el indicador no se puede calcular ese año: o el
        denominador es cero, o el formulario de ese ejercicio no desglosa la cuenta que
        hace falta. No se aproxima.
      </p>
    </div>
  )
}

/**
 * Color del percentil según hacia dónde es mejor estar.
 *
 * El percentil por sí solo no dice si algo va bien: estar en el 90 de
 * «endeudamiento del activo» es lo contrario de estar en el 90 de ROE. La
 * dirección la trae el indicador desde el back, y los que no tienen dirección
 * clara —el apalancamiento— se quedan sin color a propósito.
 */
function claseP(p, mejor) {
  if (p === null || p === undefined || mejor === 'neutro') return ''
  const bueno = mejor === 'alto' ? p >= 75 : p <= 25
  const malo = mejor === 'alto' ? p <= 25 : p >= 75
  return bueno ? 'bien' : malo ? 'mal' : ''
}

/** Barra de posición dentro del sector: 0 a la izquierda, 100 a la derecha. */
function BarraPercentil({ p, mejor }) {
  if (p === null || p === undefined) return null
  return (
    <div className="barra" title={`Percentil ${p} del sector`}>
      <span className={`relleno ${claseP(p, mejor)}`} style={{ width: `${p}%` }} />
      <span className="mediana" />
    </div>
  )
}

/**
 * Comparación sectorial: dónde está la empresa respecto de sus pares.
 *
 * Cada celda lleva tres cosas y las tres hacen falta: el valor de la empresa, el
 * percentil que ocupa y la mediana del sector. Sin la mediana el percentil es un
 * número sin escala —el percentil 60 puede significar 1,1 o 11—, y sin el
 * percentil la mediana no dice si estar por encima es raro o es lo normal.
 */
function Sectorial({ datos }) {
  if (!datos) {
    return (
      <div className="bloque">
        <p className="aviso">
          Esta compañía todavía no tiene percentiles calculados. Se calculan por lote
          después de importar balances, no en cada consulta.
        </p>
      </div>
    )
  }
  if (datos.anios.length === 0) {
    return (
      <div className="bloque">
        <p className="aviso">
          No hay comparación sectorial para esta compañía: o no tiene actividad
          registrada, o ninguno de sus indicadores se pudo calcular.
        </p>
      </div>
    )
  }

  return (
    <div className="bloque sectorial">
      <div className="pares">
        {datos.sectores.map(s => (
          <div key={s.anio} className="par">
            <strong>{s.anio}</strong>
            <span className="codigo">{s.codigo}</span>
            <span className="nombre">{s.nombre ?? '—'}</span>
            <span className={`nivel ${s.nivel}`}>
              {s.nivel === 'division' ? 'división CIIU' : 'sección CIIU'}
            </span>
          </div>
        ))}
      </div>

      {datos.grupos.map(g => {
        const filas = datos.indicadores.filter(i => i.grupo === g.id)
        if (filas.length === 0) return null
        return (
          <div key={g.id}>
            <h4>{g.titulo}</h4>
            <div className="scroll">
              <table className="tabla comparacion">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    {datos.anios.map(a => (
                      <th key={a} className="derecha">
                        {a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map(i => (
                    <tr key={i.clave}>
                      <td>{i.etiqueta}</td>
                      {datos.anios.map((a, k) => {
                        const p = i.percentiles[k]
                        const c = i.cortes[k]
                        return (
                          <td key={a} className="celda">
                            <div className="linea">
                              <span className="mono valor">
                                {formatear(i.valores[k], i.formato)}
                              </span>
                              <span className={`pct ${claseP(p, i.mejor)}`}>
                                {p === null || p === undefined ? '—' : `p${p}`}
                              </span>
                            </div>
                            <BarraPercentil p={p} mejor={i.mejor} />
                            <div className="sector">
                              {c
                                ? `mediana ${formatear(c.p50, i.formato)} · n ${c.n.toLocaleString('es-EC')}`
                                : 'sin sector'}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <p className="aviso">
        El percentil es el porcentaje de empresas del sector que quedan por debajo,
        repartiendo los empates por la mitad. Sólo cuentan las que tienen ese indicador
        calculado: una empresa sin ingresos no tiene margen neto y no entra en la
        mediana del margen. El grupo de pares es la
        división CIIU del año; cuando la división tiene menos de 30 empresas se compara
        contra la sección, y la cabecera dice cuál se usó.
      </p>
    </div>
  )
}

/** Magnitudes grandes: las únicas comparables entre formularios distintos. */
function Resumen({ datos }) {
  if (!datos) return null
  const bloques = [
    { id: 'situacion', titulo: 'Situación financiera' },
    { id: 'resultados', titulo: 'Resultados' },
  ]
  return (
    <div className="bloque">
      {bloques.map(b => (
        <div key={b.id}>
          <h4>{b.titulo}</h4>
          <div className="scroll">
            <table className="tabla">
              <thead>
                <CabeceraAnios anios={datos.anios} formularios={datos.formularios} />
              </thead>
              <tbody>
                {datos.conceptos
                  .filter(c => c.bloque === b.id)
                  .map(c => (
                    <FilaComparativa
                      key={c.clave}
                      etiqueta={c.etiqueta}
                      valores={c.valores}
                      formato="dinero"
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {datos.formularios.some(f => f !== 1) && (
        <p className="aviso">
          Los años marcados con <sup>F</sup> se declararon en el formulario fiscal, con
          otro plan de cuentas. Las magnitudes están mapeadas a su equivalente, por eso
          esta vista sí cubre todos los ejercicios.
        </p>
      )}
    </div>
  )
}
