import { useCallback, useEffect, useState } from 'react'
import {
  correrSegmento,
  correrTodos,
  listarMiembros,
  listarSegmentos,
  marcarEstado,
  productosPara,
  refrescarPerfil,
  urlCsv,
} from '../services/segmentos.service'
import {
  abrirOportunidad,
  fijarUsuario,
  obtenerCatalogos,
  usuarioActual,
} from '../services/crm.service'
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
  const [abriendo, setAbriendo] = useState(null)

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
                    {/* Abrir la oportunidad ya deja al sujeto en gestión, así que
                        aquí no hace falta marcarlo además a mano. */}
                    <button type="button" onClick={() => setAbriendo(d)}>
                      Abrir oportunidad
                    </button>
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

      {abriendo && (
        <DialogoOportunidad
          sujeto={abriendo}
          segmento={codigo}
          alCerrar={() => setAbriendo(null)}
          alAbrir={() => {
            setAbriendo(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

/**
 * Alta de una oportunidad desde la lista de trabajo.
 *
 * Los productos que se ofrecen no se eligen de un catálogo entero: se piden a
 * `GET /segmentos/sujeto/:tipo/:clave`, que ya sabe en qué segmentos cae este
 * sujeto y qué se le ofrece por eso. Elegir de la lista completa es cómo se
 * acaba ofreciendo auditoría a quien no la necesita.
 */
function DialogoOportunidad({ sujeto, segmento, alCerrar, alAbrir }) {
  const [productos, setProductos] = useState(null)
  const [marcas, setMarcas] = useState([])
  const [form, setForm] = useState({ producto: '', marca: '', monto: '' })
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  // El backend rechaza toda escritura sin firma. Se pide aquí y no sólo en la
  // pantalla de rastreo: quien entra directo al CRM no tiene por qué haber
  // pasado por allí, y el 400 de la cabecera que falta no dice qué hacer.
  const [usuario, setUsuario] = useState(usuarioActual())

  useEffect(() => {
    productosPara(sujeto.tipo_sujeto, sujeto.clave)
      .then(r => {
        // El endpoint devuelve una fila por segmento *y* producto, así que el
        // mismo producto llega repetido cuando el sujeto cae en dos segmentos
        // que lo ofrecen —el caso normal, no la excepción—. Se queda la
        // primera aparición, que viene ya ordenada por prioridad.
        const porCodigo = new Map()
        for (const p of r?.productos ?? r ?? []) {
          if (!porCodigo.has(p.codigo)) porCodigo.set(p.codigo, p)
        }
        const lista = [...porCodigo.values()]
        setProductos(lista)
        setForm(f => ({ ...f, producto: lista[0]?.codigo ?? '' }))
      })
      .catch(e => setError(e?.response?.data?.message ?? e.message))
    obtenerCatalogos()
      .then(c => {
        setMarcas(c.marcas)
        setForm(f => ({ ...f, marca: c.marcas[0]?.codigo ?? '' }))
      })
      .catch(() => {})
  }, [sujeto])

  const enviar = async e => {
    e.preventDefault()
    if (!usuario.trim()) {
      setError('Escribe tu usuario: toda acción queda firmada.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await abrirOportunidad({
        tipoSujeto: sujeto.tipo_sujeto,
        clave: sujeto.clave,
        producto: form.producto,
        marca: form.marca,
        monto: form.monto === '' ? null : Number(form.monto),
        origenSegmento: segmento,
      })
      alAbrir()
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="dialogo-fondo" role="presentation" onClick={alCerrar}>
      <form className="dialogo" onClick={e => e.stopPropagation()} onSubmit={enviar}>
        <h4>Abrir oportunidad</h4>
        <p className="dialogo-sujeto">{sujeto.nombre}</p>

        {error && <p className="error">{error}</p>}

        <label>
          Producto
          <select
            value={form.producto}
            onChange={e => setForm(f => ({ ...f, producto: e.target.value }))}
            required
          >
            {(productos ?? []).map(p => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        {productos && productos.length === 0 && (
          <p className="dialogo-aviso">
            Este sujeto no cae en ningún segmento con productos asociados.
          </p>
        )}

        <label>
          Marca
          <select
            value={form.marca}
            onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
            required
          >
            {marcas.map(m => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>

        <label>
          Monto estimado
          <input
            type="number"
            step="0.01"
            value={form.monto}
            placeholder="Opcional"
            onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
          />
        </label>

        <label>
          Tu usuario
          <input
            value={usuario}
            placeholder="tu nombre"
            onChange={e => {
              setUsuario(e.target.value)
              fijarUsuario(e.target.value)
            }}
          />
        </label>

        <div className="dialogo-acciones">
          <button type="button" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando || !form.producto || !form.marca}>
            {enviando ? 'Abriendo…' : 'Abrir'}
          </button>
        </div>
      </form>
    </div>
  )
}
