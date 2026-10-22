import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { moverEtapa, obtenerCatalogos, obtenerTablero } from '../services/crm.service'
import './Crm.css'

const dinero = v =>
  v === null || v === undefined || Number(v) === 0
    ? '—'
    : Number(v).toLocaleString('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/**
 * Tablero de oportunidades.
 *
 * Las columnas salen del servidor ya agrupadas, incluidas las vacías: una etapa
 * sin ninguna venta sigue siendo parte del embudo, y si la pantalla agrupara lo
 * que recibe, «propuesta enviada» desaparecería justo el día que no hay
 * ninguna, que es el día en que hay que mirarla.
 *
 * El arrastre va con la API nativa del navegador y no con una librería: el
 * proyecto ya decidió en `routes.jsx` no traerse una dependencia entera por un
 * detalle de interfaz, y aquí son dos manejadores.
 */
export default function Crm() {
  const navegar = useNavigate()
  const [columnas, setColumnas] = useState([])
  const [catalogos, setCatalogos] = useState({ marcas: [], comerciales: [], etapas: [] })
  const [filtros, setFiltros] = useState({ comercial: '', marca: '' })
  const [arrastrando, setArrastrando] = useState(null)
  const [encima, setEncima] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    try {
      setColumnas(await obtenerTablero(filtros))
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setCargando(false)
    }
  }, [filtros])

  useEffect(() => {
    obtenerCatalogos().then(setCatalogos).catch(() => {})
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const mover = async (id, etapa) => {
    try {
      await moverEtapa(id, etapa, null)
      await cargar()
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    }
  }

  const soltar = async etapa => {
    const id = arrastrando
    setArrastrando(null)
    setEncima(null)
    if (id) await mover(id, etapa)
  }

  const total = columnas.reduce((acc, c) => acc + c.oportunidades.length, 0)

  return (
    <div className="crm">
      <header className="crm-cabecera">
        <p className="crm-seccion">CRM</p>
        <h2>Oportunidades</h2>
        <p className="crm-subtitulo">
          Lo que está en juego ahora mismo, por etapa. Los prospectos llegan desde el gestor
          comercial y aquí empieza su flujo.
        </p>
      </header>

      <div className="crm-filtros">
        <label>
          Marca
          <select
            value={filtros.marca}
            onChange={e => setFiltros(f => ({ ...f, marca: e.target.value }))}
          >
            <option value="">Todas</option>
            {catalogos.marcas.map(m => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Comercial
          <select
            value={filtros.comercial}
            onChange={e => setFiltros(f => ({ ...f, comercial: e.target.value }))}
          >
            <option value="">Todos</option>
            {catalogos.comerciales.map(c => (
              <option key={c.usuario} value={c.usuario}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <span className="crm-conteo">{total === 1 ? '1 abierta' : `${total} abiertas`}</span>
      </div>

      {error && <p className="crm-error">{error}</p>}

      {!cargando && total === 0 && (
        <p className="crm-vacio">
          Todavía no hay ninguna oportunidad abierta. Entra en <strong>Segmentos</strong>, abre la
          lista de trabajo de un segmento y ábrele una oportunidad a quien corresponda.
        </p>
      )}

      <div className="crm-tablero">
        {columnas.map(col => (
          <section
            key={col.codigo}
            className={`crm-columna${encima === col.codigo ? ' crm-columna-destino' : ''}${
              col.es_ganada ? ' crm-columna-ganada' : ''
            }${col.es_perdida ? ' crm-columna-perdida' : ''}`}
            onDragOver={e => {
              e.preventDefault()
              setEncima(col.codigo)
            }}
            onDragLeave={() => setEncima(a => (a === col.codigo ? null : a))}
            onDrop={() => soltar(col.codigo)}
          >
            <header>
              <h3>{col.nombre}</h3>
              <span className="crm-columna-cifras">
                {col.oportunidades.length} · {dinero(col.monto)}
              </span>
            </header>

            <div className="crm-tarjetas">
              {col.oportunidades.map(o => (
                <article
                  key={o.id}
                  className="crm-tarjeta"
                  draggable
                  onDragStart={() => setArrastrando(o.id)}
                  onDragEnd={() => setArrastrando(null)}
                  onClick={() => navegar(`/crm/oportunidades/${o.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navegar(`/crm/oportunidades/${o.id}`)}
                >
                  <p className="crm-tarjeta-sujeto">{o.nombre ?? o.clave}</p>
                  <p className="crm-tarjeta-producto">{o.producto_nombre}</p>
                  <div className="crm-tarjeta-pie">
                    <span className="crm-tarjeta-monto">{dinero(o.monto)}</span>
                    {o.comercial && <span className="crm-tarjeta-comercial">{o.comercial}</span>}
                  </div>
                  {o.ruc && <p className="crm-tarjeta-ruc">{o.ruc}</p>}

                  {/* El arrastre es un atajo de escritorio: no existe en táctil
                      —y la aplicación ya se usa en móvil— ni con teclado. Este
                      selector es la forma que funciona siempre; sin él, en un
                      teléfono el tablero sería de sólo lectura. */}
                  <select
                    className="crm-tarjeta-etapa"
                    value={o.etapa}
                    aria-label={`Etapa de ${o.nombre ?? o.clave}`}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      e.stopPropagation()
                      mover(o.id, e.target.value)
                    }}
                  >
                    {columnas.map(c => (
                      <option key={c.codigo} value={c.codigo}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
