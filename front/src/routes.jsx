/**
 * Definición única de las rutas de la aplicación.
 *
 * De aquí salen a la vez el `<Routes>` y las entradas del menú lateral, para
 * que no puedan desincronizarse: añadir una pantalla es añadir una entrada aquí
 * y nada más.
 */

// Iconos como SVG en línea: el proyecto no tiene librería de iconos y no merece
// añadir una dependencia entera por cinco entradas de menú.
const Icono = ({ d }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const ICONO_EMPRESA = 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 11h.01M15 11h.01'
const ICONO_LISTA = 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
const ICONO_ARBOL = 'M5 3v4h6M5 11h6M5 11v8h6M17 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 21a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'
const ICONO_SUBIR = 'M12 16V4M6 10l6-6 6 6M4 20h16'
const ICONO_BALANCE = 'M3 20h18M7 20V10M12 20V4M17 20v-7'
const ICONO_ANALISIS = 'M3 3v18h18M7 15l4-5 3 3 5-7'
const ICONO_SOCIEDAD = 'M3 21h18M6 21V8l6-4 6 4v13M10 12h4M10 16h4'
const ICONO_PADRON = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
const ICONO_HISTORIAL = 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8'
const ICONO_SEGMENTOS = 'M12 3v9l6.5 3.8M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z'
const ICONO_TRIBUTARIO = 'M3 6h18M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M9 6V4h6v2M9 11h6M9 15h4'
const ICONO_RASTREO = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v3l2 1.5'
const ICONO_HERRAMIENTAS = 'M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z'

export const NAVEGACION = [
  {
    titulo: 'Datos',
    items: [
      { ruta: '/companias', etiqueta: 'Compañías', icono: <Icono d={ICONO_EMPRESA} /> },
      { ruta: '/balances', etiqueta: 'Balances', icono: <Icono d={ICONO_BALANCE} /> },
      { ruta: '/analisis', etiqueta: 'Análisis financiero', icono: <Icono d={ICONO_ANALISIS} /> },
      { ruta: '/tributario', etiqueta: 'Análisis tributario', icono: <Icono d={ICONO_TRIBUTARIO} /> },
      // Las personas naturales se parten en tres: las dos poblaciones activas
      // —que son mundos comerciales distintos— y las inactivas, que no son
      // prospecto de nada. Una sola entrada con un desplegable haría demasiado
      // fácil mirar la cifra equivocada.
      {
        ruta: '/padron/personas/obligadas',
        etiqueta: 'PN obligadas a contabilidad',
        icono: <Icono d={ICONO_PADRON} />,
      },
      {
        ruta: '/padron/personas/no-obligadas',
        etiqueta: 'PN no obligadas',
        icono: <Icono d={ICONO_PADRON} />,
      },
      {
        ruta: '/padron/personas/inactivas',
        etiqueta: 'PN inactivas',
        icono: <Icono d={ICONO_PADRON} />,
      },
      { ruta: '/padron/sociedades', etiqueta: 'Sociedades no supervisadas', icono: <Icono d={ICONO_SOCIEDAD} /> },
      { ruta: '/catalogo', etiqueta: 'Catálogo de cuentas', icono: <Icono d={ICONO_LISTA} /> },
      { ruta: '/ciiu', etiqueta: 'Catálogo CIIU', icono: <Icono d={ICONO_ARBOL} /> },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { ruta: '/segmentos', etiqueta: 'Segmentos', icono: <Icono d={ICONO_SEGMENTOS} /> },
    ],
  },
  {
    titulo: 'Rastreo',
    items: [
      { ruta: '/scraping', etiqueta: 'Rastreo de compañías', icono: <Icono d={ICONO_RASTREO} /> },
    ],
  },
  {
    titulo: 'Importación',
    items: [
      { ruta: '/importar/companias', etiqueta: 'Importar compañías', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/balances', etiqueta: 'Importar balances', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/sri', etiqueta: 'Importar padrón SRI', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/catalogo', etiqueta: 'Importar catálogo', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/ciiu', etiqueta: 'Importar CIIU', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/turismo', etiqueta: 'Importar catastro turismo', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importar/catastros', etiqueta: 'Importar catastros SRI', icono: <Icono d={ICONO_SUBIR} /> },
      { ruta: '/importaciones', etiqueta: 'Historial', icono: <Icono d={ICONO_HISTORIAL} /> },
    ],
  },
  {
    titulo: 'Utilidades',
    items: [
      { ruta: '/utilidades', etiqueta: 'Validación y mantenimiento', icono: <Icono d={ICONO_HERRAMIENTAS} /> },
    ],
  },
]

/** Ruta a la que se redirige desde `/`. */
export const RUTA_INICIAL = '/companias'
