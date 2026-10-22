import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  archivarOportunidad,
  editarOportunidad,
  moverEtapa,
  obtenerCatalogos,
  obtenerOportunidad,
} from '../services/crm.service'
import './Oportunidad.css'

const dinero = v =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('es-EC', { style: 'currency', currency: 'USD' })

const fecha = f => (f ? new Date(f).toLocaleDateString('es-EC') : '—')
const fechaHora = f => (f ? new Date(f).toLocaleString('es-EC') : '—')

/**
 * Ficha de una oportunidad.
 *
 * Los datos del cliente —nombre, RUC, actividad, ingresos— no se editan aquí:
 * vienen del perfil comercial y se muestran como lo que son, un reflejo de la
 * base. Lo editable es lo que pertenece a la venta: monto, etapa y cierre.
 * Permitir corregir el nombre aquí crearía una segunda verdad que ninguna
 * importación volvería a tocar.
 */
export default function Oportunidad() {
  const { id } = useParams()
  const [dato, setDato] = useState(null)
  const [etapas, setEtapas] = useState([])
  const [error, setError] = useState(null)
  const [monto, setMonto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const d = await obtenerOportunidad(id)
      setDato(d)
      setMonto(d.monto ?? '')
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    }
  }, [id])

  useEffect(() => {
    cargar()
    obtenerCatalogos()
      .then(c => setEtapas(c.etapas))
      .catch(() => {})
  }, [cargar])

  const cambiarEtapa = async etapa => {
    try {
      setGuardando(true)
      setDato(await moverEtapa(id, etapa, null))
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setGuardando(false)
    }
  }

  const guardarMonto = async () => {
    try {
      setGuardando(true)
      setDato(await editarOportunidad(id, { monto: monto === '' ? null : Number(monto) }))
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setGuardando(false)
    }
  }

  const archivar = async () => {
    try {
      setGuardando(true)
      setDato(await archivarOportunidad(id))
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setGuardando(false)
    }
  }

  if (error && !dato) return <p className="oportunidad-error">{error}</p>
  if (!dato) return <p className="oportunidad-cargando">Cargando…</p>

  return (
    <div className="oportunidad">
      <p className="oportunidad-volver">
        <Link to="/crm">← Oportunidades</Link>
      </p>

      <header className="oportunidad-cabecera">
        <div>
          <h2>{dato.nombre ?? dato.clave}</h2>
          <p className="oportunidad-sub">
            {dato.producto_nombre} · {dato.marca_nombre}
            {dato.segmento_nombre && <> · vino de «{dato.segmento_nombre}»</>}
          </p>
        </div>
        {dato.archivada_en && <span className="oportunidad-archivada">Archivada</span>}
      </header>

      {error && <p className="oportunidad-error">{error}</p>}

      <div className="oportunidad-rejilla">
        <section className="oportunidad-bloque">
          <h3>La venta</h3>

          <label className="oportunidad-campo">
            Etapa
            <select
              value={dato.etapa}
              disabled={guardando || !!dato.archivada_en}
              onChange={e => cambiarEtapa(e.target.value)}
            >
              {etapas.map(e => (
                <option key={e.codigo} value={e.codigo}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="oportunidad-campo">
            Monto
            <span className="oportunidad-monto">
              <input
                type="number"
                step="0.01"
                value={monto}
                disabled={guardando || !!dato.archivada_en}
                onChange={e => setMonto(e.target.value)}
              />
              <button type="button" onClick={guardarMonto} disabled={guardando}>
                Guardar
              </button>
            </span>
          </label>

          <dl className="oportunidad-datos">
            <dt>Comercial</dt>
            <dd>{dato.comercial ?? '—'}</dd>
            <dt>Cierre estimado</dt>
            <dd>{fecha(dato.cierre_estimado)}</dd>
            <dt>Abierta</dt>
            <dd>
              {fecha(dato.creada_en)} por {dato.creada_por}
            </dd>
          </dl>

          {!dato.archivada_en && (
            <button type="button" className="oportunidad-archivar" onClick={archivar} disabled={guardando}>
              Archivar
            </button>
          )}
        </section>

        {/* Lo que sabe la base. Se muestra, no se edita: sale del perfil. */}
        <section className="oportunidad-bloque">
          <h3>El cliente</h3>
          <dl className="oportunidad-datos">
            <dt>RUC</dt>
            <dd>{dato.ruc ?? '—'}</dd>
            <dt>Expediente</dt>
            <dd>{dato.expediente ?? '—'}</dd>
            <dt>Actividad</dt>
            <dd>{dato.actividad ?? '—'}</dd>
            <dt>Ubicación</dt>
            <dd>{[dato.canton, dato.provincia].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Situación</dt>
            <dd>{dato.situacion_legal ?? '—'}</dd>
            <dt>Teléfono</dt>
            <dd>{dato.telefono ?? '—'}</dd>
            <dt>Correo</dt>
            <dd>{dato.correo ?? '—'}</dd>
            <dt>Ingresos {dato.anio_ult ?? ''}</dt>
            <dd>{dinero(dato.ingresos_ult)}</dd>
          </dl>
          <p className="oportunidad-aviso">
            Estos datos vienen del perfil comercial y se actualizan con cada importación.
          </p>
        </section>

        <section className="oportunidad-bloque oportunidad-ancho">
          <h3>Contactos</h3>
          {dato.contactos.length === 0 ? (
            <p className="oportunidad-vacio">Todavía no hay contactos registrados.</p>
          ) : (
            <ul className="oportunidad-contactos">
              {dato.contactos.map(c => (
                <li key={c.id}>
                  <strong>{c.nombre}</strong>
                  {c.cargo && <span> · {c.cargo}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="oportunidad-bloque oportunidad-ancho">
          <h3>Historial</h3>
          {dato.interacciones.length === 0 ? (
            <p className="oportunidad-vacio">Sin movimientos todavía.</p>
          ) : (
            <ul className="oportunidad-historial">
              {dato.interacciones.map(i => (
                <li key={i.id}>
                  <span className="oportunidad-historial-fecha">{fechaHora(i.ocurrido_en)}</span>
                  <span className="oportunidad-historial-canal">{i.canal}</span>
                  <span>{i.texto}</span>
                  <span className="oportunidad-historial-autor">{i.autor}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
