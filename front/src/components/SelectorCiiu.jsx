import { useCallback, useEffect, useRef, useState } from 'react'
import { listarActividades, obtenerActividad } from '../services/ciiu.service'
import './SelectorCiiu.css'

/** Cuántas sugerencias se piden al servidor por búsqueda. */
const MAX_SUGERENCIAS = 40

/**
 * Selector de actividad económica CIIU.
 *
 * Ofrece **sólo las 1.737 actividades de nivel 6** (Actividad Económica), que
 * son las únicas bajo las que se clasifica una compañía: los niveles superiores
 * (Sección, División, Grupo, Clase, Subclase) son agrupaciones y ninguna
 * compañía cuelga directamente de ellas.
 *
 * Se filtra por `nivel=6` y no por `soloHojas`: este último incluiría además las
 * tres categorías especiales del final del catálogo (CONSUMO, VIVIENDA y
 * EDUCATIVO - NO PRODUCTIVO), que son hojas de nivel 1 y que ninguna compañía
 * usa — son destinos de crédito, no clasificaciones de empresa. Ofrecerlas sería
 * ofrecer filtros que nunca devuelven nada.
 *
 * @param value    código CIIU seleccionado, o '' si no hay ninguno
 * @param onChange recibe el código elegido (o '' al limpiar)
 */
export default function SelectorCiiu({ value, onChange, inputId, labelledBy }) {
  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [seleccionada, setSeleccionada] = useState(null)
  const [resaltada, setResaltada] = useState(-1)
  const caja = useRef(null)
  const timer = useRef(null)

  // Al llegar con `?ciiu=CODIGO` desde el catálogo hay que resolver el nombre
  // para poder enseñarlo; el estado sólo trae el código.
  useEffect(() => {
    if (!value) {
      setSeleccionada(null)
      return
    }
    if (seleccionada?.codigo === value) return
    let cancelado = false
    obtenerActividad(value)
      .then(r => !cancelado && setSeleccionada(r.actividad))
      // Un código que no exista en el catálogo se muestra tal cual.
      .catch(() => !cancelado && setSeleccionada({ codigo: value, nombre: null }))
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const buscar = useCallback(async q => {
    setCargando(true)
    try {
      const res = await listarActividades({
        q,
        nivel: 6,
        limit: MAX_SUGERENCIAS,
      })
      setSugerencias(res.datos)
      setResaltada(-1)
    } catch {
      setSugerencias([])
    } finally {
      setCargando(false)
    }
  }, [])

  // Debounce: sin esto cada tecla dispara una consulta.
  useEffect(() => {
    if (!abierto) return undefined
    clearTimeout(timer.current)
    timer.current = setTimeout(() => buscar(texto), 250)
    return () => clearTimeout(timer.current)
  }, [texto, abierto, buscar])

  // Cerrar al pulsar fuera.
  useEffect(() => {
    const fuera = e => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const elegir = act => {
    setSeleccionada(act)
    onChange(act.codigo)
    setAbierto(false)
    setTexto('')
  }

  const limpiar = () => {
    setSeleccionada(null)
    onChange('')
    setTexto('')
  }

  const onKeyDown = e => {
    if (e.key === 'Escape') {
      setAbierto(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltada(i => Math.min(i + 1, sugerencias.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltada(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && resaltada >= 0) {
      e.preventDefault()
      elegir(sugerencias[resaltada])
    }
  }

  if (seleccionada) {
    return (
      <div className="selector-ciiu elegido" title={seleccionada.nombre ?? seleccionada.codigo} role="group" aria-labelledby={labelledBy}>
        <span className="codigo">{seleccionada.codigo}</span>
        <span className="nombre">{seleccionada.nombre ?? 'código no encontrado en el catálogo'}</span>
        <button type="button" onClick={limpiar} aria-label="Quitar filtro de actividad">
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="selector-ciiu" ref={caja}>
      <input
        id={inputId}
        name="ciiu"
        type="search"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-label={labelledBy ? undefined : 'Actividad económica (CIIU)'}
        aria-labelledby={labelledBy}
        aria-autocomplete="list"
        aria-expanded={abierto}
        aria-controls="selector-ciiu-opciones"
        aria-activedescendant={abierto && resaltada >= 0 ? `selector-ciiu-opcion-${resaltada}` : undefined}
        placeholder="Actividad económica (CIIU)…"
        value={texto}
        onChange={e => {
          setTexto(e.target.value)
          setAbierto(true)
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={onKeyDown}
      />

      {abierto && (
        <ul className="sugerencias" id="selector-ciiu-opciones" role="listbox" aria-label="Actividades económicas sugeridas">
          {cargando && <li className="info" role="status" aria-live="polite">Buscando actividades…</li>}
          {!cargando && sugerencias.length === 0 && (
            <li className="info" role="status" aria-live="polite">
              {texto ? 'Ninguna actividad coincide' : 'Escribe un código o parte del nombre'}
            </li>
          )}
          {sugerencias.map((a, i) => (
            <li
              key={a.codigo}
              id={`selector-ciiu-opcion-${i}`}
              role="option"
              aria-selected={i === resaltada}
              className={i === resaltada ? 'activa' : undefined}
              onMouseEnter={() => setResaltada(i)}
              onMouseDown={e => e.preventDefault()} // evita perder el foco antes del click
              onClick={() => elegir(a)}
            >
              <span className="codigo">{a.codigo}</span>
              <span className="nombre">{a.nombre}</span>
            </li>
          ))}
          {sugerencias.length === MAX_SUGERENCIAS && (
            <li className="info" role="status">Sólo se muestran las primeras {MAX_SUGERENCIAS}. Afina la búsqueda.</li>
          )}
        </ul>
      )}
    </div>
  )
}
