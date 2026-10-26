import api from './api'

export const listarSegmentos = () => api.get('/segmentos').then(r => r.data)

export const obtenerCatalogo = () => api.get('/segmentos/catalogo').then(r => r.data)

// Estos POST no llevan datos, pero el cuerpo va como `{}` y no como `null`: la
// instancia fija `Content-Type: application/json`, axios serializa `null` como
// el texto "null" y el parser JSON del back lo rechaza con un 400 antes de
// llegar al controlador.

/** Reconstruye el perfil. Tarda ~30 s: es una recorrida de 7,1 M de sujetos. */
export const refrescarPerfil = () =>
  api.post('/segmentos/perfil/refrescar', {}, { timeout: 0 }).then(r => r.data)

export const correrSegmento = codigo =>
  api.post(`/segmentos/${codigo}/correr`, {}, { timeout: 0 }).then(r => r.data)

export const correrTodos = () =>
  api.post('/segmentos/correr', {}, { timeout: 0 }).then(r => r.data)

export const listarMiembros = (codigo, params) =>
  api.get(`/segmentos/${codigo}/miembros`, { params }).then(r => r.data)

export const productosPara = (tipo, clave) =>
  api.get(`/segmentos/sujeto/${tipo}/${encodeURIComponent(clave)}`).then(r => r.data)

export const marcarEstado = (tipo, clave, estado, nota) =>
  api
    .post(`/segmentos/sujeto/${tipo}/${encodeURIComponent(clave)}/estado`, { estado, nota })
    .then(r => r.data)

/** La descarga va por el navegador, no por axios: es un archivo, no una respuesta. */
export const urlCsv = codigo => `${api.defaults.baseURL}/segmentos/${codigo}/csv`
