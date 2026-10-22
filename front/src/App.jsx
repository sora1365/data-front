import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Companias from './pages/Companias'
import Catalogo from './pages/Catalogo'
import Ciiu from './pages/Ciiu'
import Balances from './pages/Balances'
import Analisis from './pages/Analisis'
import Tributario from './pages/Tributario'
import Informe from './pages/Informe'
import InformeTributario from './pages/InformeTributario'
import PadronLista from './pages/PadronLista'
import ImportarCompanias from './pages/ImportarCompanias'
import ImportarBalances from './pages/ImportarBalances'
import ImportarSri from './pages/ImportarSri'
import ImportarCatalogo from './pages/ImportarCatalogo'
import ImportarCiiu from './pages/ImportarCiiu'
import ImportarTurismo from './pages/ImportarTurismo'
import ImportarCatastros from './pages/ImportarCatastros'
import Importaciones from './pages/Importaciones'
import Segmentos from './pages/Segmentos'
import Scraping from './pages/Scraping'
import Utilidades from './pages/Utilidades'
import { RUTA_INICIAL } from './routes'
import './App.css'

function App() {
  return (
    <Router>
      <Routes>
        {/* El informe va FUERA del Layout: es un documento, no una pantalla de
            la aplicación. Así no hay menú lateral que ocultar al imprimir. */}
        <Route path="/informe/:expediente" element={<Informe />} />
        <Route path="/informe-tributario/:expediente" element={<InformeTributario />} />

        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to={RUTA_INICIAL} replace />} />
          <Route path="/companias" element={<Companias />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/ciiu" element={<Ciiu />} />
          <Route path="/balances" element={<Balances />} />
          <Route path="/analisis" element={<Analisis />} />
          <Route path="/tributario" element={<Tributario />} />
          {/* Las personas naturales van partidas en tres pantallas. La ruta
              general se conserva sin entrada de menú para no romper enlaces
              guardados. */}
          <Route path="/padron/personas" element={<PadronLista tipo="personas" />} />
          <Route
            path="/padron/personas/obligadas"
            element={<PadronLista tipo="personas-obligadas" />}
          />
          <Route
            path="/padron/personas/no-obligadas"
            element={<PadronLista tipo="personas-no-obligadas" />}
          />
          <Route
            path="/padron/personas/inactivas"
            element={<PadronLista tipo="personas-inactivas" />}
          />
          <Route path="/padron/sociedades" element={<PadronLista tipo="sociedades" />} />
          <Route path="/segmentos" element={<Segmentos />} />
          <Route path="/scraping" element={<Scraping />} />
          <Route path="/importar/companias" element={<ImportarCompanias />} />
          <Route path="/importar/balances" element={<ImportarBalances />} />
          <Route path="/importar/sri" element={<ImportarSri />} />
          <Route path="/importar/catalogo" element={<ImportarCatalogo />} />
          <Route path="/importar/ciiu" element={<ImportarCiiu />} />
          <Route path="/importar/turismo" element={<ImportarTurismo />} />
          <Route path="/importar/catastros" element={<ImportarCatastros />} />
          <Route path="/importaciones" element={<Importaciones />} />
          <Route path="/utilidades" element={<Utilidades />} />
          {/* Redirección de la ruta antigua, que estaba en el menú anterior. */}
          <Route path="/importar" element={<Navigate to="/importar/companias" replace />} />
          <Route path="*" element={<Navigate to={RUTA_INICIAL} replace />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
