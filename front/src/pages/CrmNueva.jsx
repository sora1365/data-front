import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  abrirOportunidad,
  fijarUsuario,
  obtenerCatalogos,
  productosSugeridos,
  usuarioActual,
} from '../services/crm.service'
import './CrmNueva.css'

/**
 * Alta de una oportunidad.
 *
 * Es la puerta de entrada del CRM. El gestor comercial manda aquí el prospecto
 * —a quién y de qué segmento salió— y a partir de este punto el flujo es del
 * CRM: qué producto se le ofrece, por cuánto y quién lo trabaja.
 *
 * Los productos no se eligen de un catálogo entero: se piden al gestor
 * comercial, que ya sabe en qué segmentos cae ese sujeto y qué se le ofrece por
 * eso. Elegir de la lista completa es cómo se acaba ofreciendo auditoría a
 * quien no la necesita.
 */
export default function CrmNueva() {
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const tipo = params.get('tipo')
  const clave = params.get('clave')
  const segmento = params.get('segmento')

  const [productos, setProductos] = useState(null)
  const [marcas, setMarcas] = useState([])
  const [form, setForm] = useState({ producto: '', marca: '', monto: '' })
  const [usuario, setUsuario] = useState(usuarioActual())
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!tipo || !clave) return
    productosSugeridos(tipo, clave)
      .then(lista => {
        setProductos(lista)
        setForm(f => ({ ...f, producto: lista[0]?.codigo ?? '' }))
      })
      .catch(e => setError(e?.response?.data?.message ?? e.message))
  }, [tipo, clave])

  useEffect(() => {
    obtenerCatalogos()
      .then(c => {
        setMarcas(c.marcas)
        setForm(f => ({ ...f, marca: f.marca || (c.marcas[0]?.codigo ?? '') }))
      })
      .catch(() => {})
  }, [])

  if (!tipo || !clave) {
    return (
      <div className="crm-nueva">
        <h2>Nueva oportunidad</h2>
        <p className="crm-nueva-vacio">
          Esta pantalla se abre desde la lista de trabajo de un segmento, en{' '}
          <Link to="/segmentos">Gestor comercial</Link>. Elige allí a quién enviar al CRM.
        </p>
      </div>
    )
  }

  const enviar = async e => {
    e.preventDefault()
    if (!usuario.trim()) {
      setError('Escribe tu usuario: toda acción queda firmada.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const creada = await abrirOportunidad({
        tipoSujeto: tipo,
        clave,
        producto: form.producto,
        marca: form.marca,
        monto: form.monto === '' ? null : Number(form.monto),
        origenSegmento: segmento || null,
      })
      navegar(`/crm/oportunidades/${creada.id}`)
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message)
      setEnviando(false)
    }
  }

  const sujeto = productos?.[0]

  return (
    <div className="crm-nueva">
      <p className="crm-nueva-volver">
        <Link to="/crm">← Oportunidades</Link>
      </p>

      <h2>Nueva oportunidad</h2>
      <p className="crm-nueva-sub">
        {sujeto?.segmento_nombre
          ? `Viene de «${sujeto.segmento_nombre}», del gestor comercial.`
          : 'Prospecto recibido del gestor comercial.'}
      </p>

      {error && <p className="crm-nueva-error">{error}</p>}

      <form className="crm-nueva-form" onSubmit={enviar}>
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
          <p className="crm-nueva-aviso">
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

        <div className="crm-nueva-acciones">
          <button type="button" onClick={() => navegar('/crm')}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando || !form.producto || !form.marca}>
            {enviando ? 'Abriendo…' : 'Abrir oportunidad'}
          </button>
        </div>
      </form>
    </div>
  )
}
