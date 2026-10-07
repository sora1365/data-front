import api from './api';

export const OPERACIONES = [
  {
    id: 'auditar-fuentes',
    titulo: 'Auditar Excel',
    ayuda:
      'Lista columnas y una muestra de hasta tres hojas. No modifica datos.',
    accept: '.xlsx',
    soloVista: true,
  },
  {
    id: 'balances',
    titulo: 'Validar balances',
    ayuda: 'Ensayo en seco del archivo de balances tabulado antes de cargarlo.',
    accept: '.txt',
  },
  {
    id: 'catalogo',
    titulo: 'Validar catálogo de cuentas',
    ayuda:
      'Revisa codificación, jerarquía, duplicados y rechazos del archivo de texto.',
    accept: '.txt,.csv',
  },
  {
    id: 'ciiu',
    titulo: 'Validar catálogo CIIU',
    ayuda: 'Revisa la estructura, jerarquía y niveles del Excel CIIU.',
    accept: '.xlsx',
  },
  {
    id: 'coeficientes',
    titulo: 'Cargar coeficientes SRI',
    ayuda:
      'Valida las hojas y ejercicios; al confirmar reemplaza esos años y actualiza el análisis tributario.',
    accept: '.xlsx',
  },
];

export const crearVistaPrevia = (tipo, file, onProgress) => {
  const data = new FormData();
  data.append('file', file);
  return api
    .post(`/operations/${tipo}/preview`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      onUploadProgress: e =>
        e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    .then(r => r.data);
};

export const estadoVistaPrevia = id =>
  api.get(`/operations/previews/${id}`).then(r => r.data);
export const ejecutarVistaPrevia = (id, modo) =>
  api
    .post(`/operations/previews/${id}/execute`, { modo }, { timeout: 0 })
    .then(r => r.data);
export const cancelarVistaPrevia = id =>
  api.delete(`/operations/previews/${id}`).then(r => r.data);
export const obtenerJobImportacion = id =>
  api.get(`/imports/${id}`).then(r => r.data);
export const recalcularPercentiles = () =>
  api
    .post('/balances/percentiles/recalcular', {}, { timeout: 0 })
    .then(r => r.data);
