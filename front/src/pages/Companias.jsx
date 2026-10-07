import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, LoaderCircle, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { listarCompanias, obtenerFacetas, obtenerFicha } from '../services/companias.service'
import BotonRastrear from '../components/BotonRastrear'
import FichaCompania from '../components/FichaCompania'
import SelectorCiiu from '../components/SelectorCiiu'
import { MarcasCatastro, SelectorCatastro } from '../components/Catastros'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import './Companias.css'

const FILTROS_VACIOS = {
  nombre: '', ruc: '', provincia: '', situacionLegal: '', tipo: '',
  ciiu: '', catastro: '', catastroAnio: '',
}

const num = n => (n ?? 0).toLocaleString('es-EC')

export default function Companias() {
  const [ficha, setFicha] = useState(null)
  const [searchParams] = useSearchParams()
  const [filtros, setFiltros] = useState({ ...FILTROS_VACIOS, ciiu: searchParams.get('ciiu') ?? '' })
  const [datos, setDatos] = useState([])
  const [total, setTotal] = useState(null)
  const [facetas, setFacetas] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [cursores, setCursores] = useState([null])
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)

  useEffect(() => { obtenerFacetas().then(setFacetas).catch(() => {}) }, [])

  const cargar = useCallback(async (cursor, filtrosActuales) => {
    setCargando(true)
    setError(null)
    try {
      const res = await listarCompanias({ ...filtrosActuales, cursor, limit: 50 })
      setDatos(res.datos)
      setHayMas(res.hayMas)
      setTotal(res.total)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
      setDatos([])
    } finally { setCargando(false) }
  }, [])

  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCursores([null])
      setPagina(0)
      cargar(null, filtros)
    }, 350)
    return () => clearTimeout(timer.current)
  }, [filtros, cargar])

  const siguiente = () => {
    const ultimo = datos[datos.length - 1]
    if (!ultimo) return
    setCursores([...cursores.slice(0, pagina + 1), ultimo.expediente])
    setPagina(pagina + 1)
    cargar(ultimo.expediente, filtros)
  }
  const anterior = () => {
    if (pagina === 0) return
    setPagina(pagina - 1)
    cargar(cursores[pagina - 1], filtros)
  }
  const set = (campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))
  const filtrosActivos = Object.values(filtros).filter(Boolean).length
  const textoResultados = total === null ? 'Consulta el registro empresarial' : total.exacto || total.valor === 0
    ? `${num(total.valor)} resultado${total.valor === 1 ? '' : 's'}`
    : `Más de ${num(total.valor)} resultados`

  return (
    <main className="companias">
      <header className="companias-hero">
        <div className="companias-titulo">
          <span className="companias-icono" aria-hidden="true"><Building2 size={20} /></span>
          <div>
            <p className="companias-eyebrow">DIRECTORIO EMPRESARIAL</p>
            <h1>Compañías</h1>
            <p className="companias-intro">Explora y filtra el registro societario de Ecuador.</p>
          </div>
        </div>
        <Badge variant="secondary" className="companias-total" aria-live="polite">
          {cargando && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {textoResultados}
        </Badge>
      </header>

      <Card className="companias-filtros-card">
        <CardHeader className="companias-card-header">
          <div className="companias-card-heading">
            <span className="companias-section-icon" aria-hidden="true"><SlidersHorizontal size={17} /></span>
            <div>
              <CardTitle>Filtros de búsqueda</CardTitle>
              <CardDescription>Combina criterios para encontrar una compañía.</CardDescription>
            </div>
          </div>
          <CardAction>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_VACIOS)} disabled={!filtrosActivos}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" /> Limpiar{filtrosActivos ? ` (${filtrosActivos})` : ''}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup className="companias-filtros-grid">
            <Field>
              <FieldLabel htmlFor="compania-nombre">Nombre o razón social</FieldLabel>
              <Input id="compania-nombre" name="nombre" placeholder="Ej. Andina…" autoComplete="off" value={filtros.nombre} onChange={e => set('nombre', e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="compania-ruc">RUC</FieldLabel>
              <Input id="compania-ruc" name="ruc" inputMode="numeric" placeholder="13 dígitos" value={filtros.ruc} onChange={e => set('ruc', e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="compania-provincia">Provincia</FieldLabel>
              <select id="compania-provincia" name="provincia" value={filtros.provincia} onChange={e => set('provincia', e.target.value)}>
                <option value="">Todas las provincias</option>
                {facetas?.provincias?.map(p => <option key={p.valor} value={p.valor}>{p.valor} ({num(p.n)})</option>)}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="compania-situacion">Situación legal</FieldLabel>
              <select id="compania-situacion" name="situacionLegal" value={filtros.situacionLegal} onChange={e => set('situacionLegal', e.target.value)}>
                <option value="">Todas las situaciones</option>
                {facetas?.situaciones?.map(s => <option key={s.valor} value={s.valor}>{s.valor} ({num(s.n)})</option>)}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="compania-tipo">Tipo de compañía</FieldLabel>
              <select id="compania-tipo" name="tipo" value={filtros.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">Todos los tipos</option>
                {facetas?.tipos?.map(t => <option key={t.valor} value={t.valor}>{t.valor} ({num(t.n)})</option>)}
              </select>
            </Field>
            <Field>
              <FieldTitle id="compania-ciiu-label">Actividad económica (CIIU)</FieldTitle>
              <SelectorCiiu value={filtros.ciiu} onChange={v => set('ciiu', v)} inputId="compania-ciiu" labelledBy="compania-ciiu-label" />
            </Field>
            <Field className="companias-catastro-field">
              <FieldTitle id="compania-catastro-label">Catastro público</FieldTitle>
              <div className="companias-catastro-controls">
                <SelectorCatastro
                  id="compania-catastro"
                  yearId="compania-catastro-anio"
                  labelledBy="compania-catastro-label"
                  catastro={filtros.catastro}
                  anio={filtros.catastroAnio}
                  aniosCatastro={facetas?.aniosCatastro}
                  onChange={({ catastro, anio }) => setFiltros(f => ({ ...f, catastro, catastroAnio: anio }))}
                />
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {(error || mensaje) && <div className="companias-feedback" aria-live="polite">
        {error && <Alert variant="destructive"><AlertTitle>No se pudo cargar el directorio</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {mensaje && <Alert className={mensaje.tipo === 'ok' ? 'companias-alerta-ok' : ''}><AlertTitle>{mensaje.tipo === 'ok' ? 'Solicitud enviada' : 'Resultado del rastreo'}</AlertTitle><AlertDescription>{mensaje.texto} <Link to="/scraping">Ver rastreos →</Link></AlertDescription></Alert>}
      </div>}

      <Card className="companias-resultados-card">
        <CardHeader className="companias-resultados-header">
          <div>
            <CardTitle>Directorio</CardTitle>
            <CardDescription>{cargando ? 'Actualizando resultados…' : `${datos.length ? `Mostrando ${num(datos.length)} compañías` : 'Empresas inscritas'} · hasta 50 por página`}</CardDescription>
          </div>
          <Badge variant="outline" className="companias-page-badge">Página {pagina + 1}</Badge>
        </CardHeader>
        <CardContent className="companias-tabla-content">
          <div className={`tabla-scroll${datos.length === 0 ? ' sin-datos' : ''}`} role="region" aria-label="Resultados de compañías" tabIndex={0}>
            {datos.length === 0 ? <div className="companias-empty-state">
              {cargando ? <><LoaderCircle className="animate-spin" size={19} aria-hidden="true" /><strong>Consultando el registro…</strong></> : <>
                <div className="companias-vacio-icon" aria-hidden="true"><Search size={20} /></div>
                <strong>{error ? 'No hay resultados para mostrar' : filtrosActivos ? 'No encontramos compañías con esos filtros' : 'Aún no hay resultados'}</strong>
                <span>{error ? 'Revisa tu conexión e inténtalo de nuevo.' : filtrosActivos ? 'Prueba con otros términos o limpia los filtros.' : 'Usa los filtros de arriba para consultar el registro.'}</span>
                {filtrosActivos > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setFiltros(FILTROS_VACIOS)}>Limpiar filtros</Button>}
              </>}
            </div> :
            <table>
              <caption className="sr-only">Resultados del directorio de compañías, página {pagina + 1}</caption>
              <thead><tr>
                <th scope="col">Expediente</th><th scope="col">RUC</th><th scope="col">Nombre</th><th scope="col">Situación</th><th scope="col">SRI</th><th scope="col">Representante legal</th><th scope="col">Cargo</th><th scope="col">Teléfono</th><th scope="col">Tipo</th><th scope="col">Provincia</th><th scope="col">Cantón</th><th scope="col">Parroquia</th><th scope="col" className="der">Capital</th><th scope="col">Constitución</th><th scope="col" className="der">Locales</th><th scope="col">Catastros</th><th scope="col">Actividad económica</th><th scope="col"><span className="sr-only">Acciones</span></th>
              </tr></thead>
              <tbody>
                {datos.map(c => <tr key={c.expediente}>
                  <td className="mono expediente">{c.expediente}</td><td className="mono">{c.ruc ?? '—'}</td><td className="nombre-compania">{c.nombre}</td><td>{c.situacionLegal ?? '—'}</td>
                  <td>{c.sriEstadoContribuyente ? <Badge variant="outline" className={`estado ${String(c.sriEstadoContribuyente).toLowerCase()}`}>{c.sriEstadoContribuyente}</Badge> : '—'}</td>
                  <td>{c.representante ?? '—'}</td><td>{c.cargo ?? '—'}</td><td className="mono">{c.telefono ?? '—'}</td><td>{c.tipo ?? '—'}</td><td>{c.provincia ?? '—'}</td><td>{c.canton ?? '—'}</td><td>{c.sriParroquia ?? '—'}</td>
                  <td className="der mono">{c.capitalSuscrito === null ? '—' : c.capitalSuscrito.toLocaleString('es-EC', { minimumFractionDigits: 2 })}</td><td>{c.fechaConstitucion ?? '—'}</td><td className="der mono">{c.sriNumEstablecimientos ?? '—'}</td>
                  <td className="catastros"><MarcasCatastro fila={c} /></td><td className="actividad" title={c.ciiuNivel6 ?? ''}>{c.actividad ?? (c.ciiuNivel6 ? <span className="tenue">{c.ciiuNivel6}</span> : '—')}</td>
                  <td className="acciones-fila"><Button type="button" variant="outline" size="sm" onClick={() => setFicha(c.expediente)}>Ficha</Button><BotonRastrear tipoSujeto="compania" clave={c.expediente} onResultado={setMensaje} /></td>
                </tr>)}
              </tbody>
            </table>
            }
          </div>
          <footer className="companias-paginacion">
            <span className="companias-pagina-resumen">{datos.length ? `Página ${pagina + 1} · ${num(datos.length)} registros` : 'Sin registros en esta página'}</span>
            <div className="companias-pagina-acciones">
              <Button type="button" variant="outline" size="sm" onClick={anterior} disabled={pagina === 0 || cargando}>← Anterior</Button>
              <Button type="button" variant="outline" size="sm" onClick={siguiente} disabled={!hayMas || cargando}>Siguiente →</Button>
            </div>
          </footer>
        </CardContent>
      </Card>

      {ficha && <FichaCompania expediente={ficha} onCerrar={() => setFicha(null)} cargar={obtenerFicha} />}
    </main>
  )
}
