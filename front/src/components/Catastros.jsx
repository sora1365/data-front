import './Catastros.css'

/**
 * Filtro y marcas de los catastros públicos, compartidos por el listado de
 * compañías y los del padrón.
 *
 * Están en un componente común porque el catastro reparte sus RUC entre las
 * tres poblaciones: el 82 % del catastro de turismo son personas naturales, no
 * compañías. Si cada pantalla lo pintara a su manera, "exportador de servicios
 * en 2026" acabaría significando cosas distintas según dónde se mire.
 */

export const NOMBRE_CATASTRO = {
  turismo: 'Catastro de Turismo',
  exportador_bienes_ir: 'Exportador de bienes · rebaja 3 puntos IR',
  exportador_bienes_iva: 'Exportador de bienes · retenciones IVA',
  exportador_servicios_iva: 'Exportador de servicios · retenciones IVA',
}

const ABREVIATURA = {
  turismo: 'Turismo',
  exportador_bienes_ir: 'Exp. bienes IR',
  exportador_bienes_iva: 'Exp. bienes IVA',
  exportador_servicios_iva: 'Exp. servicios IVA',
}

const OPCIONES = [
  { valor: '', etiqueta: 'Cualquier catastro' },
  { valor: 'turismo', etiqueta: 'En el catastro de turismo' },
  { valor: 'exportador', etiqueta: 'Exportador habitual (cualquiera)' },
  { valor: 'exportador_bienes_ir', etiqueta: 'Exportador bienes · rebaja IR' },
  { valor: 'exportador_bienes_iva', etiqueta: 'Exportador bienes · IVA' },
  { valor: 'exportador_servicios_iva', etiqueta: 'Exportador servicios · IVA' },
  { valor: 'ninguno', etiqueta: 'En ningún catastro' },
]

/** El año sólo tiene sentido para los catastros de exportadores. */
const ADMITE_ANIO = new Set([
  'exportador',
  'exportador_bienes_ir',
  'exportador_bienes_iva',
  'exportador_servicios_iva',
])

function aniosDisponibles(aniosCatastro, catastro) {
  if (!aniosCatastro) return []
  if (catastro === 'exportador') {
    return [...new Set(Object.values(aniosCatastro).flat())].sort((a, b) => b - a)
  }
  return aniosCatastro[catastro] ?? []
}

export function SelectorCatastro({ catastro, anio, aniosCatastro, onChange, id, yearId, labelledBy }) {
  const anios = aniosDisponibles(aniosCatastro, catastro)

  return (
    <>
      <select
        id={id}
        name="catastro"
        aria-label={labelledBy ? undefined : 'Filtrar por catastro público'}
        aria-labelledby={labelledBy}
        value={catastro}
        onChange={e => onChange({ catastro: e.target.value, anio: '' })}
        title="Filtra por pertenencia a un catastro público, enlazado por RUC"
      >
        {OPCIONES.map(o => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {ADMITE_ANIO.has(catastro) && anios.length > 0 && (
        <select id={yearId} name="catastroAnio" aria-label="Año del catastro" value={anio} onChange={e => onChange({ catastro, anio: e.target.value })}>
          <option value="">Cualquier año</option>
          {anios.map(a => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}
    </>
  )
}

/**
 * Marcas compactas para una celda de tabla.
 *
 * Los años se muestran siempre: estar en el catastro de 2021 y no en el de 2026
 * significa que dejó de exportar, y es lo que se quiere ver de un vistazo.
 */
export function MarcasCatastro({ fila }) {
  const marcas = []

  if (fila.turismoRegistros) {
    marcas.push({
      clave: 'turismo',
      texto: `Turismo ×${fila.turismoRegistros}`,
      titulo: (fila.turismoActividades ?? []).join(' · '),
      ratificado: fila.turismoRatificado === true,
    })
  }

  const exportadores = [
    ['exportador_bienes_ir', fila.exportadorBienesIrAnios],
    ['exportador_bienes_iva', fila.exportadorBienesIvaAnios],
    ['exportador_servicios_iva', fila.exportadorServiciosIvaAnios],
  ]
  for (const [clave, anios] of exportadores) {
    if (!anios?.length) continue
    marcas.push({
      clave,
      texto: ABREVIATURA[clave],
      anios: [...anios].sort((a, b) => b - a).join(', '),
      titulo: NOMBRE_CATASTRO[clave],
    })
  }

  if (marcas.length === 0) return <span className="tenue">—</span>

  return (
    <span className="marcas-catastro">
      {marcas.map(m => (
        <span
          key={m.clave}
          className={`marca ${m.clave === 'turismo' ? 'turismo' : 'exportador'}${
            m.ratificado ? ' ratificado' : ''
          }`}
          title={m.titulo}
        >
          {m.texto}
          {m.anios && <em>{m.anios}</em>}
        </span>
      ))}
    </span>
  )
}
