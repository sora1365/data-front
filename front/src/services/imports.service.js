import api from './api'

/**
 * Sube un archivo a cualquiera de los importadores.
 *
 * El `Content-Type` se sobreescribe a propósito: la instancia compartida de
 * `api.js` fija `application/json` por defecto, y eso impide que el navegador
 * añada el `boundary` del multipart. Sin boundary, multer no encuentra el
 * archivo y la petición falla con "no se recibió ningún archivo".
 *
 * `timeout: 0` porque el Excel de compañías puede tardar minutos en subir.
 */
export const subirArchivo = (endpoint, file, onProgress, modo = 'snapshot_completo') => {
  const fd = new FormData()
  fd.append('file', file)
  return api
    .post(`${endpoint}?modo=${modo}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      onUploadProgress: e => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      },
    })
    .then(r => r.data)
}

export const obtenerJob = jobId => api.get(`/imports/${jobId}`).then(r => r.data)

export const listarJobs = kind =>
  api.get('/imports', { params: kind ? { kind } : {} }).then(r => r.data)

export const obtenerRechazos = jobId =>
  api.get(`/imports/${jobId}/rechazos`).then(r => r.data)

/** Tipos de import, tal como los identifica el backend. */
export const KIND_COMPANIAS = 'supercias_companias'
export const KIND_CATALOGO = 'catalogo_cuentas'
export const KIND_CIIU = 'catalogo_ciiu'
export const KIND_BALANCES = 'supercias_balances'
export const KIND_SRI = 'sri_padron'
export const KIND_TURISMO = 'catastro_turismo'
export const KIND_CATASTROS = 'catastros_sri'
export const KIND_COEFICIENTES = 'coeficientes_sri'

export const ETIQUETA_KIND = {
  [KIND_COMPANIAS]: 'Compañías',
  [KIND_CATALOGO]: 'Catálogo de cuentas',
  [KIND_CIIU]: 'Catálogo CIIU',
  [KIND_BALANCES]: 'Balances',
  [KIND_SRI]: 'Padrón del SRI',
  [KIND_TURISMO]: 'Catastro de turismo',
  [KIND_CATASTROS]: 'Catastros del SRI',
  [KIND_COEFICIENTES]: 'Coeficientes presuntivos SRI',
}
