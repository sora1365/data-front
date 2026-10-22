import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  archivarOportunidad,
  editarOportunidad,
  moverEtapa,
  obtenerCatalogos,
  obtenerOportunidad,
  registrarInteraccion,
} from '../services/crm.service'
import './Oportunidad.css'

const dinero = v =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('es-EC', { style: 'currency', currency: 'USD' })

const fecha = f => (f ? new Date(f).toLocaleDateString('es-EC') : '—')
const fechaHora = f => (f ? new Date(f).toLocaleString('es-EC') : '—')

/** El nombre de un contacto, que la tabla guarda en dos columnas. */
const nombreContacto = c => [c.first_name, c.last_name].filter(Boolean).join(' ')

/** El canal con el que firma el servidor lo que hace él, no una persona. */
const CANAL_SISTEMA = 'sistema'

const esDelSistema = i => i.canal === CANAL_SISTEMA

/**
 * Lo que dice una fila del historial.
 *
 * En lo que anota una persona el resultado va destacado y delante del relato:
 * muchas veces —«no contesta»— es lo único que escribió, y si sólo se pintara
 * el texto la fila saldría vacía.
 *
 * En lo que escribe el sistema, el resultado es su código interno
 * (`cambio_etapa`), que no se le enseña a nadie: ahí basta el texto.
 */
function Detalle({ interaccion: i }) {
  if (esDelSistema(i)) return <span>{i.texto}</span>
  return (
    <span>
      {i.resultado && <strong>{i.resultado}</strong>}
      {i.resultado && i.texto && ' · '}
      {i.texto}
    </span>
  )
}

/**
 * El formulario de anotar, en blanco.
 *
 * `llamada` y `saliente` de serie porque es el caso que se repite todo el día.
 * La fecha se queda vacía y el servidor pone la de ahora: lo normal es anotar
 * justo después de colgar, y obligar a rellenarla sería teclear la hora actual
 * veinte veces al día.
 */
const ANOTACION_VACIA = {
  canal: 'llamada',
  direccion: 'saliente',
  contacto: '',
  resultado: '',
  texto: '',
  ocurridoEn: '',
}

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
  const [canales, setCanales] = useState([])
  const [error, setError] = useState(null)
  const [monto, setMonto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [anotacion, setAnotacion] = useState(ANOTACION_VACIA)

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
      .then(c => {
        setEtapas(c.etapas)
        setCanales(c.canales ?? [])
      })
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

  /**
   * Anota la conversación y limpia el formulario.
   *
   * Los campos vacíos no se mandan: el servidor distingue «no se escribió
   * resultado» de «el resultado es cadena vacía», y mandar la fecha en blanco
   * le haría rechazar la anotación por fecha ilegible en vez de poner la de
   * ahora, que es lo que quiere decir dejarla vacía.
   */
  const anotar = async e => {
    e.preventDefault()
    try {
      setGuardando(true)
      const cuerpo = { canal: anotacion.canal, direccion: anotacion.direccion }
      if (anotacion.contacto) cuerpo.contacto = Number(anotacion.contacto)
      if (anotacion.resultado.trim()) cuerpo.resultado = anotacion.resultado
      if (anotacion.texto.trim()) cuerpo.texto = anotacion.texto
      // `datetime-local` da «2026-10-22T09:30», sin zona. Se manda tal cual y
      // el navegador ya lo interpretó en la del usuario al componerlo.
      if (anotacion.ocurridoEn) cuerpo.ocurridoEn = new Date(anotacion.ocurridoEn).toISOString()

      setDato(await registrarInteraccion(id, cuerpo))
      setAnotacion(ANOTACION_VACIA)
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
                  <strong>{nombreContacto(c)}</strong>
                  {c.title && <span> · {c.title}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="oportunidad-bloque oportunidad-ancho">
          <h3>Historial</h3>

          {/*
            Anotar está arriba del historial y no al final: en una venta
            trabajada la lista es larga, y el formulario al pie obligaría a
            bajar hasta el fondo justo después de colgar el teléfono.
          */}
          {!dato.archivada_en && (
            <form className="oportunidad-anotar" onSubmit={anotar}>
              <div className="oportunidad-anotar-fila">
                <label>
                  Canal
                  <select
                    value={anotacion.canal}
                    onChange={e => setAnotacion({ ...anotacion, canal: e.target.value })}
                  >
                    {canales.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Dirección
                  <select
                    value={anotacion.direccion}
                    onChange={e => setAnotacion({ ...anotacion, direccion: e.target.value })}
                  >
                    <option value="saliente">la llamamos</option>
                    <option value="entrante">nos llamó</option>
                  </select>
                </label>

                <label>
                  Con quién
                  <select
                    value={anotacion.contacto}
                    onChange={e => setAnotacion({ ...anotacion, contacto: e.target.value })}
                  >
                    <option value="">—</option>
                    {dato.contactos.map(c => (
                      <option key={c.id} value={c.id}>
                        {nombreContacto(c)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Cuándo
                  <input
                    type="datetime-local"
                    value={anotacion.ocurridoEn}
                    onChange={e => setAnotacion({ ...anotacion, ocurridoEn: e.target.value })}
                  />
                </label>
              </div>

              <label className="oportunidad-anotar-resultado">
                En qué quedó
                <input
                  type="text"
                  placeholder="no contesta · pidió propuesta · lo ve en enero"
                  value={anotacion.resultado}
                  onChange={e => setAnotacion({ ...anotacion, resultado: e.target.value })}
                />
              </label>

              <textarea
                rows="3"
                placeholder="Qué se habló"
                value={anotacion.texto}
                onChange={e => setAnotacion({ ...anotacion, texto: e.target.value })}
              />

              <button type="submit" disabled={guardando}>
                Anotar
              </button>
            </form>
          )}

          {dato.interacciones.length === 0 ? (
            <p className="oportunidad-vacio">Sin movimientos todavía.</p>
          ) : (
            <ul className="oportunidad-historial">
              {dato.interacciones.map(i => (
                <li key={i.id} className={esDelSistema(i) ? 'es-sistema' : undefined}>
                  <span className="oportunidad-historial-fecha">{fechaHora(i.ocurrido_en)}</span>
                  <span className="oportunidad-historial-canal">
                    {i.canal}
                    {!esDelSistema(i) && (i.direccion === 'entrante' ? ' ←' : ' →')}
                  </span>
                  <Detalle interaccion={i} />
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
