import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cancelarVistaPrevia,
  crearVistaPrevia,
  ejecutarVistaPrevia,
  estadoVistaPrevia,
  obtenerJobImportacion,
  OPERACIONES,
  recalcularPercentiles,
} from '../services/operations.service';
import './Utilidades.css';

const LABEL_STATUS = {
  validating: 'Validando archivo',
  ready: 'Vista previa lista',
  failed: 'No se pudo validar',
  executing: 'Procesando',
  executed: 'Completado',
  pending: 'En cola',
  parsing: 'Leyendo archivo',
  merging: 'Consolidando',
  indexing: 'Indexando',
};
const NUM = n => (typeof n === 'number' ? n.toLocaleString('es-EC') : n);

export default function Utilidades() {
  const [seleccion, setSeleccion] = useState(OPERACIONES[0].id);
  const [file, setFile] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState(null);
  const [subida, setSubida] = useState(null);
  const [modo, setModo] = useState('snapshot_completo');
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [percentiles, setPercentiles] = useState(null);
  const [pctError, setPctError] = useState(null);
  const enVuelo = useRef(false);
  const operation = OPERACIONES.find(x => x.id === seleccion);

  useEffect(() => {
    if (!previewId) return undefined;
    let canceled = false;
    const poll = async () => {
      if (enVuelo.current) return;
      enVuelo.current = true;
      try {
        const result = await estadoVistaPrevia(previewId);
        if (!canceled) setPreview(result);
        if (['ready', 'failed', 'executed'].includes(result.status))
          clearInterval(id);
      } catch (e) {
        if (!canceled) setError(e?.response?.data?.message ?? e.message);
      } finally {
        enVuelo.current = false;
      }
    };
    poll();
    const id = setInterval(poll, 1200);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [previewId]);

  useEffect(() => {
    if (!preview?.importJobId) return undefined;
    let canceled = false;
    const poll = async () => {
      try {
        const result = await obtenerJobImportacion(preview.importJobId);
        if (!canceled) setJob(result);
        if (['completed', 'failed'].includes(result.status)) clearInterval(id);
      } catch (e) {
        if (!canceled) setError(e?.response?.data?.message ?? e.message);
      }
    };
    poll();
    const id = setInterval(poll, 1400);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [preview?.importJobId]);

  const reset = async () => {
    if (previewId && preview?.status !== 'executed')
      await cancelarVistaPrevia(previewId).catch(() => {});
    setPreviewId(null);
    setPreview(null);
    setJob(null);
    setFile(null);
    setSubida(null);
    setError(null);
  };

  const onUpload = async e => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setPreview(null);
    setJob(null);
    setSubida(0);
    setOcupado(true);
    try {
      const result = await crearVistaPrevia(seleccion, file, setSubida);
      setPreviewId(result.previewId);
    } catch (err) {
      setError(err?.response?.data?.message ?? err.message);
      setSubida(null);
    } finally {
      setOcupado(false);
    }
  };

  const onExecute = async () => {
    if (!previewId) return;
    setError(null);
    setOcupado(true);
    try {
      const result = await ejecutarVistaPrevia(previewId, modo);
      if (result.jobId) {
        const current = await estadoVistaPrevia(previewId);
        setPreview(current);
      } else {
        const current = await estadoVistaPrevia(previewId);
        setPreview(current);
        if (result.resultado)
          setPreview(p => ({
            ...p,
            report: { ...p.report, resultado: result.resultado },
          }));
      }
    } catch (err) {
      setError(err?.response?.data?.message ?? err.message);
    } finally {
      setOcupado(false);
    }
  };

  const onPercentiles = async () => {
    setPctError(null);
    setPercentiles(null);
    setOcupado(true);
    try {
      setPercentiles(await recalcularPercentiles());
    } catch (err) {
      setPctError(err?.response?.data?.message ?? err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className='utilidades'>
      <header className='utilidades-cabecera'>
        <div>
          <h2>Utilidades de datos</h2>
          <p>
            Valida archivos, revisa el diagnóstico y confirma las cargas desde
            la web.
          </p>
        </div>
        <Link to='/importaciones'>Ver historial de importaciones</Link>
      </header>

      <div className='utilidades-grid'>
        <aside className='utilidades-lista' aria-label='Herramientas'>
          {OPERACIONES.map(item => (
            <button
              key={item.id}
              className={seleccion === item.id ? 'seleccionada' : ''}
              onClick={() => {
                reset();
                setSeleccion(item.id);
              }}
            >
              {item.titulo}
            </button>
          ))}
          <button
            className={seleccion === 'percentiles' ? 'seleccionada' : ''}
            onClick={() => {
              reset();
              setSeleccion('percentiles');
            }}
          >
            Recalcular percentiles
          </button>
        </aside>

        <section className='utilidad-panel'>
          {seleccion === 'percentiles' ? (
            <>
              <h3>Recalcular percentiles sectoriales</h3>
              <p>
                Reconstruye las magnitudes y posiciones sectoriales con los
                balances cargados. El proceso puede tardar varios minutos.
              </p>
              <button onClick={onPercentiles} disabled={ocupado}>
                {ocupado ? 'Recalculando…' : 'Iniciar recálculo'}
              </button>
              {pctError && (
                <div className='utilidad-alerta error'>{pctError}</div>
              )}
              {percentiles && (
                <div className='utilidad-alerta ok'>
                  Recálculo completado: {NUM(percentiles.balances)} balances,{' '}
                  {NUM(percentiles.cortes)} cortes y {NUM(percentiles.empresas)}{' '}
                  empresas en {((percentiles.ms ?? 0) / 1000).toFixed(1)} s.
                </div>
              )}
            </>
          ) : (
            <>
              <h3>{operation.titulo}</h3>
              <p>{operation.ayuda}</p>
              <form onSubmit={onUpload} className='utilidad-form'>
                <input
                  type='file'
                  accept={operation.accept}
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  disabled={ocupado || Boolean(previewId)}
                />
                <button
                  type='submit'
                  disabled={!file || ocupado || Boolean(previewId)}
                >
                  Subir y validar
                </button>
              </form>
              {file && (
                <p className='utilidad-filename'>
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
              {subida !== null && (
                <p className='utilidad-status'>Subida del archivo: {subida}%</p>
              )}
              {error && <div className='utilidad-alerta error'>{error}</div>}
              {preview && (
                <>
                  <div className={`utilidad-status ${preview.status}`}>
                    {LABEL_STATUS[preview.status] ?? preview.status}
                    {preview.status === 'validating' && '…'}
                  </div>
                  {preview.errorMessage && (
                    <div className='utilidad-alerta error'>
                      {preview.errorMessage}
                    </div>
                  )}
                  {preview.report && <Report value={preview.report} />}
                  {preview.status === 'ready' && !operation.soloVista && (
                    <div className='utilidad-confirmar'>
                      {['balances', 'catalogo', 'ciiu'].includes(seleccion) && (
                        <label>
                          Modo de carga
                          <select
                            value={modo}
                            onChange={e => setModo(e.target.value)}
                            disabled={ocupado}
                          >
                            <option value='snapshot_completo'>
                              Completa (marca datos ausentes)
                            </option>
                            <option value='parcial'>
                              Parcial (conserva los demás datos)
                            </option>
                          </select>
                        </label>
                      )}
                      <button onClick={onExecute} disabled={ocupado}>
                        {ocupado
                          ? 'Procesando…'
                          : seleccion === 'coeficientes'
                            ? 'Confirmar carga y actualizar análisis'
                            : 'Confirmar carga'}
                      </button>
                    </div>
                  )}
                  {job && (
                    <div
                      className={`utilidad-alerta ${job.status === 'failed' ? 'error' : job.status === 'completed' ? 'ok' : ''}`}
                    >
                      {LABEL_STATUS[job.status] ?? job.status}
                      {!['completed', 'failed'].includes(job.status) &&
                        ` · ${job.progressPct}%`}
                      {job.status === 'failed' && `: ${job.errorMessage}`}
                      {job.status === 'completed' &&
                        ` · ${NUM(job.rowsInserted)} nuevas, ${NUM(job.rowsUpdated)} actualizadas, ${NUM(job.rowsRejected)} rechazadas.`}
                    </div>
                  )}
                  {preview.status === 'executed' && !preview.importJobId && (
                    <div className='utilidad-alerta ok'>
                      Operación completada.
                    </div>
                  )}
                  {['ready', 'failed', 'executed'].includes(preview.status) && (
                    <button className='utilidad-nueva' onClick={reset}>
                      Limpiar resultado y subir otro archivo
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Report({ value }) {
  return (
    <div className='utilidad-reporte'>
      <h4>Resultado de la vista previa</h4>
      <ReportValue value={value} />
    </div>
  );
}

function ReportValue({ value, depth = 0 }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span>Sin elementos</span>;
    if (typeof value[0] !== 'object' || value[0] === null)
      return <p>{value.map(NUM).join(', ')}</p>;
    return (
      <div className='utilidad-tabla-scroll'>
        <table>
          <thead>
            <tr>
              {Object.keys(value[0]).map(k => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.slice(0, 50).map((row, i) => (
              <tr key={i}>
                {Object.keys(value[0]).map(k => (
                  <td key={k}>
                    {typeof row[k] === 'object'
                      ? JSON.stringify(row[k])
                      : NUM(row[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {value.length > 50 && (
          <small>Se muestran 50 de {NUM(value.length)} filas.</small>
        )}
      </div>
    );
  }
  if (typeof value === 'object')
    return (
      <dl className='utilidad-datos' style={{ '--depth': depth }}>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <ReportValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{NUM(value)}</span>;
}
