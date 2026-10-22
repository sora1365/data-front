import { useCallback, useEffect, useState } from 'react'
import {
  correrSegmento,
  correrTodos,
  listarMiembros,
  listarSegmentos,
  marcarEstado,
  refrescarPerfil,
  urlCsv,
} from '../services/segmentos.service'
import './Segmentos.css'

const num = n => (n ?? 0).toLocaleString('es-EC')
const fecha = f => (f ? new Date(f).toLocaleString('es-EC') : '—')
const dinero = v =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('es-EC', { maximumFractionDigits: 0 })

/**
 * Segmentos comerciales.
 *
 * La lista completa de un segmento se mira una vez; lo que se trabaja a diario
 * son las **novedades** — quién entró desde la última corrida. Por eso el filtro
 * de novedades está arriba del listado y no escondido.
 */
export default function Segmentos() {
  const [segmentos, setSegmentos] = useState([])
  const [abierto, setAbierto] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [error, setError] = useState(null)

  // Sólo se pintan los activos. Un segmento retirado no es trabajo pendiente ni
  // un aviso: es ruido en la única pantalla que se mira para saber a quién
  // llamar hoy. Sigue existiendo entero —definición, miembros e histórico— y el
  // API lo devuelve con su `activo` y su `bloqueo`; lo que desaparece es la
  // tarjeta. Reactivarlo lo devuelve a la lista sin tocar nada de aquí.
  const cargar = useCallback(async () => {
    try {
      setSegmentos((await listarSegmentos()).filter(s => s.activo))
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const accion = async (etiqueta, fn) => {
    setOcupado(etiqueta)
    setError(null)
    try {
      await fn()
      await cargar()
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="segmentos">
      <h2>Segmentos comerciales</h2>
      <p className="nota">
        Cada segmento es una definición guardada sobre el perfil de los 7,1 millones de sujetos de
        la base. Un mismo segmento alimenta a varios productos: por eso la definición vive aquí y
        no dentro de cada producto.
      </p>

      <div className="acciones">
        <button
          type="button"
          disabled={!!ocupado}
          onClick={() => accion('perfil', refrescarPerfil)}
          title="Reconstruye el perfil desde las tablas de origen. Hazlo después de cada importación."
        >
          {ocupado === 'perfil' ? 'Refrescando perfil…' : 'Refrescar perfil'}
        </button>
        <button type="button" disabled={!!ocupado} onClick={() => accion('todos', correrTodos)}>
          {ocupado === 'todos' ? 'Corriendo…' : 'Correr todos los segmentos'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="tarjetas">
        {segmentos.map(s => (
          <article className="tarjeta" key={s.codigo}>
            <header>
              <h3>{s.nombre}</h3>
              <span className="miembros">{num(s.miembros)}</span>
            </header>
            <p className="desc">{s.descripcion}</p>

            <p className="corrida">
              Última corrida: {fecha(s.ultima_corrida)}
              {s.ultima_corrida && (
                <>
                  {' '}· <b className="alta">+{num(s.ultimas_altas)}</b>{' '}
                  <b className="baja">−{num(s.ultimas_bajas)}</b>
                </>
              )}
            </p>

            <div className="productos">
              {s.productos.map(p => (
                <span className="producto" key={p.codigo} title={`Unidad: ${p.unidad}`}>
                  {p.nombre}
                </span>
              ))}
            </div>

            <footer>
              <button
                type="button"
                disabled={!!ocupado}
                onClick={() => accion(s.codigo, () => correrSegmento(s.codigo))}
              >
                {ocupado === s.codigo ? 'Corriendo…' : 'Correr'}
              </button>
              <button
                type="button"
                onClick={() => setAbierto(abierto === s.codigo ? null : s.codigo)}
              >
                {abierto === s.codigo ? 'Ocultar lista' : 'Ver lista'}
              </button>
              <a className="descarga" href={urlCsv(s.codigo)}>
                CSV
              </a>
            </footer>

            {abierto === s.codigo && <Miembros codigo={s.codigo} />}
          </article>
        ))}
      </div>
    </div>
  )
}

function Miembros({ codigo }) {
  const [filtros, setFiltros] = useState({ novedades: false, conContacto: false })
  const [datos, setDatos] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const r = await listarMiembros(codigo, {
        limit: 50,
        novedades: filtros.novedades ? 'true' : undefined,
        conContacto: filtros.conContacto ? 'true' : undefined,
      })
      setDatos(r.datos)
      setTotal(r.total)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    }
  }, [codigo, filtros])

  useEffect(() => {
    cargar()
  }, [cargar])

  const marcar = async (fila, estado) => {
    await marcarEstado(fila.tipo_sujeto, fila.clave, estado)
    cargar()
  }

  return (
    <div className="miembros">
      <div className="filtros-miembros">
        <label>
          <input
            type="checkbox"
            checked={filtros.novedades}
            onChange={e => setFiltros(f => ({ ...f, novedades: e.target.checked }))}
          />
          Sólo novedades (30 días)
        </label>
        <label>
          <input
            type="checkbox"
            checked={filtros.conContacto}
            onChange={e => setFiltros(f => ({ ...f, conContacto: e.target.checked }))}
          />
          Sólo con teléfono o correo
        </label>
        <span className="cuenta">{num(total)} sin gestionar</span>
      </div>

      {error && <p className="error">{error}</p>}
      {!datos && <p className="cargando">Cargando…</p>}

      {datos && (
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>RUC</th>
                <th>Nombre</th>
                <th>Provincia</th>
                <th>Constitución</th>
                <th>Teléfono</th>
                <th>Correo</th>
                <th className="der">Activos últ.</th>
                <th className="der">Activos ant.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.map(d => (
                <tr key={`${d.tipo_sujeto}-${d.clave}`}>
                  <td className="mono">{d.ruc ?? '—'}</td>
                  <td>{d.nombre}</td>
                  <td>{d.provincia ?? '—'}</td>
                  <td className="mono">
                    {d.fecha_constitucion ? String(d.fecha_constitucion).slice(0, 10) : '—'}
                  </td>
                  <td className="mono">{d.telefono ?? '—'}</td>
                  <td>{d.correo ?? '—'}</td>
                  <td className="der mono">{dinero(d.activos_ult)}</td>
                  <td className="der mono">{dinero(d.activos_prev)}</td>
                  <td className="acciones-fila">
                    <button type="button" onClick={() => marcar(d, 'en_gestion')}>
                      En gestión
                    </button>
                    <button type="button" onClick={() => marcar(d, 'no_contactar')}>
                      No contactar
                    </button>
                  </td>
                </tr>
              ))}
              {datos.length === 0 && (
                <tr>
                  <td colSpan={9} className="vacio">
                    Nada pendiente con estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
