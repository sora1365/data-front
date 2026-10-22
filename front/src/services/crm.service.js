import api from './api'
import { usuarioActual } from './scraping.service'

/**
 * Llamadas del CRM.
 *
 * La firma del usuario se reutiliza de `scraping.service`: es el mismo nombre
 * guardado en el mismo sitio, y tener dos copias del helper acabaría con dos
 * claves distintas en `localStorage` y con la pantalla preguntando el nombre
 * dos veces.
 */
const firma = () => ({ headers: { 'X-Usuario': usuarioActual() } })

export { usuarioActual, fijarUsuario } from './scraping.service'

export const obtenerCatalogos = () => api.get('/crm/catalogos').then(r => r.data)

const limpiar = params =>
  Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== '' && v != null))

export const obtenerTablero = params =>
  api.get('/crm/tablero', { params: limpiar(params) }).then(r => r.data)

export const obtenerOportunidad = id => api.get(`/crm/oportunidades/${id}`).then(r => r.data)

export const abrirOportunidad = datos =>
  api.post('/crm/oportunidades', datos, firma()).then(r => r.data)

export const editarOportunidad = (id, campos) =>
  api.patch(`/crm/oportunidades/${id}`, campos, firma()).then(r => r.data)

export const moverEtapa = (id, etapa, indice) =>
  api.post(`/crm/oportunidades/${id}/etapa`, { etapa, indice }, firma()).then(r => r.data)

export const archivarOportunidad = id =>
  api.post(`/crm/oportunidades/${id}/archivar`, null, firma()).then(r => r.data)

/** Qué ofrecerle a este sujeto: lo responde el gestor comercial, vía el CRM. */
export const productosSugeridos = (tipo, clave) =>
  api.get(`/crm/sugerencias/${tipo}/${encodeURIComponent(clave)}`).then(r => r.data)

export const listarVentas = params =>
  api.get('/crm/ventas', { params: limpiar(params) }).then(r => r.data)

export const crmDeSujeto = (tipo, clave) =>
  api.get(`/crm/sujeto/${tipo}/${encodeURIComponent(clave)}`).then(r => r.data)
