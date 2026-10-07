import { NavLink, Outlet } from 'react-router-dom'
import { NAVEGACION } from '../routes'
import './Layout.css'

/**
 * Marco de la aplicación: sidebar fija a la izquierda y contenido a la derecha.
 * Las entradas salen de `routes.jsx`, que es también de donde salen las rutas.
 */
export default function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="skip-link" href="#contenido-principal">Saltar al contenido</a>
        <div className="marca">
          <span className="marca-logo">F</span>
          <span className="marca-texto">FRIDAY</span>
        </div>

        <nav>
          {NAVEGACION.map(grupo => (
            <div className="grupo" key={grupo.titulo}>
              <p className="grupo-titulo">{grupo.titulo}</p>
              {grupo.items.map(item => (
                <NavLink
                  key={item.ruta}
                  to={item.ruta}
                  className={({ isActive }) => `enlace${isActive ? ' activo' : ''}`}
                  title={item.etiqueta}
                >
                  <span className="enlace-icono">{item.icono}</span>
                  <span className="enlace-texto">{item.etiqueta}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="contenido" id="contenido-principal" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
