import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Building2, CalendarDays, Database, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import { listarBalances, obtenerResumen } from '../services/balances.service'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import './Balances.css'

const num = n => (n ?? 0).toLocaleString('es-EC')
const FILTROS_VACIOS = { anio: '', nombre: '', ruc: '', rama: '' }

/** Registro anual de balances presentados por las compañías. */
export default function Balances() {
  const [filtros, setFiltros] = useState(FILTROS_VACIOS)
  const [datos, setDatos] = useState([])
  const [resumen, setResumen] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { obtenerResumen().then(setResumen).catch(() => {}) }, [])

  const cargar = useCallback(async f => {
    setCargando(true)
    setError(null)
    try {
      const res = await listarBalances({ ...f, limit: 50 })
      setDatos(res.datos)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
      setDatos([])
    } finally { setCargando(false) }
  }, [])

  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => cargar(filtros), 250)
    return () => clearTimeout(timer.current)
  }, [filtros, cargar])

  const set = (campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))
  const totalBalances = resumen.reduce((a, r) => a + r.balances, 0)
  const totalCeldas = resumen.reduce((a, r) => a + r.celdas, 0)
  const filtrosActivos = Object.values(filtros).filter(Boolean).length
  const periodoSeleccionado = resumen.find(r => String(r.anio) === String(filtros.anio))

  return (
    <main className="balances">
      <header className="balances-hero">
        <div className="balances-title-row">
          <span className="balances-hero-icon" aria-hidden="true"><Database size={20} /></span>
          <div>
            <p className="balances-eyebrow">INFORMACIÓN FINANCIERA</p>
            <h1>Balances</h1>
            <p className="balances-intro">Consulta los balances presentados por las compañías y analiza su información financiera.</p>
          </div>
        </div>
        <Badge variant="secondary" className="balances-total" aria-live="polite">
          {cargando && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {filtros.anio ? `Ejercicio ${filtros.anio}` : `${num(totalBalances)} balances disponibles`}
        </Badge>
      </header>

      {resumen.length > 0 && <section className="balances-kpis" aria-label="Resumen de balances">
        <Stat icon={<Database size={17} />} label="Balances registrados" value={num(totalBalances)} detail="en todos los ejercicios" />
        <Stat icon={<CalendarDays size={17} />} label="Ejercicios disponibles" value={num(resumen.length)} detail="periodos con información" />
        <Stat icon={<Building2 size={17} />} label="Celdas con valor" value={num(totalCeldas)} detail="datos financieros reportados" />
      </section>}

      {resumen.length > 0 && <Card className="balances-periodos-card">
        <CardHeader className="balances-section-header">
          <div>
            <CardTitle>Explorar por ejercicio</CardTitle>
            <CardDescription>Selecciona un año para limitar los resultados.</CardDescription>
          </div>
          {filtros.anio && <CardAction><Button type="button" size="sm" variant="ghost" onClick={() => set('anio', '')}>Ver todos los años</Button></CardAction>}
        </CardHeader>
        <CardContent>
          <div className="balances-periodos" role="group" aria-label="Filtrar balances por año">
            {[...resumen].sort((a, b) => b.anio - a.anio).map(r => {
              const activo = String(filtros.anio) === String(r.anio)
              return <button
                key={r.anio}
                type="button"
                className={`balances-periodo${activo ? ' activo' : ''}`}
                aria-pressed={activo}
                onClick={() => set('anio', activo ? '' : String(r.anio))}
              >
                <span className="balances-periodo-anio">{r.anio}</span>
                <span className="balances-periodo-total">{num(r.balances)} balances</span>
              </button>
            })}
          </div>
          {periodoSeleccionado && <p className="balances-periodo-nota">Mostrando el ejercicio <strong>{periodoSeleccionado.anio}</strong> con {num(periodoSeleccionado.balances)} balances registrados.</p>}
        </CardContent>
      </Card>}

      <Card className="balances-filtros-card">
        <CardHeader className="balances-section-header">
          <div className="balances-card-title">
            <span className="balances-section-icon" aria-hidden="true"><Search size={16} /></span>
            <div>
              <CardTitle>Buscar balances</CardTitle>
              <CardDescription>Filtra por compañía, RUC o rama de actividad.</CardDescription>
            </div>
          </div>
          <CardAction><Button type="button" variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_VACIOS)} disabled={!filtrosActivos}><RotateCcw data-icon="inline-start" aria-hidden="true" /> Limpiar{filtrosActivos ? ` (${filtrosActivos})` : ''}</Button></CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup className="balances-filtros-grid">
            <Field>
              <FieldLabel htmlFor="balance-nombre">Razón social</FieldLabel>
              <Input id="balance-nombre" name="nombre" autoComplete="off" placeholder="Nombre de la compañía" value={filtros.nombre} onChange={e => set('nombre', e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="balance-ruc">RUC</FieldLabel>
              <Input id="balance-ruc" name="ruc" inputMode="numeric" placeholder="Número de RUC" value={filtros.ruc} onChange={e => set('ruc', e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="balance-rama">Rama de actividad</FieldLabel>
              <Input id="balance-rama" name="rama" maxLength={1} autoCapitalize="characters" placeholder="Ej. A" value={filtros.rama} onChange={e => set('rama', e.target.value.toUpperCase())} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive" className="balances-error"><AlertTitle>No se pudieron cargar los balances</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Card className="balances-resultados-card">
        <CardHeader className="balances-section-header balances-resultados-header">
          <div>
            <CardTitle>Resultados</CardTitle>
            <CardDescription aria-live="polite">{cargando ? 'Actualizando resultados…' : datos.length ? `Mostrando ${num(datos.length)} balances · máximo 50 por consulta` : 'Balances que coinciden con los criterios seleccionados'}</CardDescription>
          </div>
          <Badge variant="outline" className="balances-resultados-badge">{num(datos.length)} {datos.length === 1 ? 'registro' : 'registros'}</Badge>
        </CardHeader>
        <CardContent className="balances-resultados-content">
          <div className="balances-tabla-scroll" role="region" aria-label="Resultados de balances" tabIndex={0}>
            <table className="balances-tabla">
              <caption className="sr-only">Resultados de balances</caption>
              <thead><tr>
                <th scope="col">Año</th><th scope="col">Expediente</th><th scope="col">RUC</th><th scope="col">Razón social</th><th scope="col">Rama de actividad</th><th scope="col"><span className="sr-only">Acciones</span></th>
              </tr></thead>
              <tbody>
                {datos.map(b => <tr key={`${b.anio}-${b.expediente}`}>
                  <td><Badge variant="outline" className="balances-anio-badge">{b.anio}</Badge></td>
                  <td className="mono balances-expediente">{b.expediente}</td>
                  <td className="mono">{b.ruc ?? '—'}</td>
                  <td className="balances-nombre">{b.nombre}</td>
                  <td title={b.descripcionRama}><span className="balances-rama-codigo">{b.ramaActividad ?? '—'}</span>{b.descripcionRama && <span className="balances-rama-descripcion">{b.descripcionRama}</span>}</td>
                  <td className="balances-accion"><Button asChild variant="outline" size="sm"><Link to={`/analisis?expediente=${b.expediente}`}>Analizar <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Link></Button></td>
                </tr>)}
                {!cargando && datos.length === 0 && <tr><td colSpan={6} className="balances-vacio">
                  <span className="balances-vacio-icon" aria-hidden="true"><Search size={19} /></span>
                  <strong>{error ? 'No hay resultados para mostrar' : filtrosActivos ? 'No encontramos balances con esos filtros' : 'No hay balances para mostrar'}</strong>
                  <span>{error ? 'Verifica la conexión e inténtalo de nuevo.' : filtrosActivos ? 'Prueba con otros datos o limpia la búsqueda.' : 'Los balances disponibles aparecerán aquí.'}</span>
                  {filtrosActivos > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setFiltros(FILTROS_VACIOS)}>Limpiar filtros</Button>}
                </td></tr>}
                {cargando && datos.length === 0 && <tr><td colSpan={6} className="balances-cargando"><LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> Consultando balances…</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function Stat({ icon, label, value, detail }) {
  return <Card className="balances-stat-card">
    <CardContent className="balances-stat-content">
      <span className="balances-stat-icon" aria-hidden="true">{icon}</span>
      <div className="balances-stat-copy">
        <span className="balances-stat-label">{label}</span>
        <strong className="balances-stat-value">{value}</strong>
        <span className="balances-stat-detail">{detail}</span>
      </div>
    </CardContent>
  </Card>
}
