import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { NAVEGACION } from '../routes'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import './Layout.css'

/**
 * Marco de la aplicación: sidebar fija a la izquierda y contenido a la derecha.
 * Las entradas salen de `routes.jsx`, que es también de donde salen las rutas.
 */
export default function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false)

  return (
    <div className="layout">
      <a className="skip-link" href="#contenido-principal">Saltar al contenido</a>

      <div className="mobile-nav-bar">
        <Brand />
        <Sheet open={menuAbierto} onOpenChange={setMenuAbierto}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir menú de navegación">
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="mobile-navigation-sheet">
            <SheetHeader>
              <Brand />
              <SheetTitle>Navegación</SheetTitle>
              <SheetDescription>Accede a las herramientas de Friday.</SheetDescription>
            </SheetHeader>
            <NavGroups onNavigate={() => setMenuAbierto(false)} />
          </SheetContent>
        </Sheet>
      </div>

      <aside className="sidebar" aria-label="Navegación principal">
        <Brand />
        <NavGroups />
      </aside>

      <main className="contenido" id="contenido-principal" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

function Brand() {
  return (
    <div className="marca">
      <span className="marca-logo">F</span>
      <span className="marca-texto">FRIDAY</span>
    </div>
  )
}

function NavGroups({ onNavigate }) {
  return (
    <nav className="nav-grupos" aria-label="Secciones de la aplicación">
      {NAVEGACION.map(grupo => (
        <div className="grupo" key={grupo.titulo}>
          <p className="grupo-titulo">{grupo.titulo}</p>
          {grupo.items.map(item => (
            <NavLink
              key={item.ruta}
              to={item.ruta}
              onClick={onNavigate}
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
  )
}
