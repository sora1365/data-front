import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CircleHelp,
  FileSpreadsheet,
  FileText,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  cancelarVistaPrevia,
  crearVistaPrevia,
  ejecutarVistaPrevia,
  estadoVistaPrevia,
  obtenerJobImportacion,
  OPERACIONES,
  recalcularPercentiles,
} from '../services/operations.service';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Spinner } from '@/components/ui/spinner';
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
  queued: 'En cola',
  running: 'Procesando',
  completed: 'Completado',
};
const NUM = n => (typeof n === 'number' ? n.toLocaleString('es-EC') : n);
const OP_ICON = {
  'auditar-fuentes': FileSpreadsheet,
  balances: BarChart3,
  catalogo: ListChecks,
  ciiu: FileText,
  coeficientes: BadgeCheck,
};

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
  const esPercentil = seleccion === 'percentiles';

  useEffect(() => {
    if (!previewId) return undefined;
    let canceled = false;
    const poll = async () => {
      if (enVuelo.current) return;
      enVuelo.current = true;
      try {
        const result = await estadoVistaPrevia(previewId);
        if (!canceled) setPreview(result);
        if (['ready', 'failed', 'executed'].includes(result.status)) clearInterval(id);
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
    setPercentiles(null);
    setPctError(null);
  };

  const cambiarOperacion = async value => {
    if (!value || value === seleccion) return;
    await reset();
    setSeleccion(value);
    setModo('snapshot_completo');
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
      const current = await estadoVistaPrevia(previewId);
      setPreview(result.resultado
        ? { ...current, report: { ...current.report, resultado: result.resultado } }
        : current);
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

  const state = esPercentil ? (percentiles ? 'completed' : ocupado ? 'running' : null) : preview?.status;
  const statusVariant = state === 'ready' || state === 'completed' || state === 'executed'
    ? 'success'
    : state === 'failed'
      ? 'destructive'
      : state
        ? 'progress'
        : 'neutral';

  return (
    <div className='utilidades'>
      <header className='utilidades-cabecera'>
        <div className='utilidades-titulo'>
          <div className='utilidades-eyebrow'><span /> Centro de operaciones</div>
          <h1>Herramientas de datos</h1>
          <p>Valida, revisa y procesa archivos operativos en un solo lugar.</p>
        </div>
        <Button variant='outline' asChild className='historial-link'>
          <Link to='/importaciones'>
            <ArrowDownToLine data-icon='inline-start' />
            Historial de importaciones
            <ArrowRight data-icon='inline-end' />
          </Link>
        </Button>
      </header>

      <div className='utilidades-proceso' aria-label='Pasos del proceso'>
        <span><i>1</i> Sube el archivo</span><ArrowRight aria-hidden='true' />
        <span><i>2</i> Revisa el diagnóstico</span><ArrowRight aria-hidden='true' />
        <span><i>3</i> Confirma el proceso</span>
      </div>

      <Tabs value={seleccion} onValueChange={cambiarOperacion} orientation='vertical' className='utilidades-layout'>
        <div className='utilidades-navegacion'>
          <div className='navegacion-titulo'>
            <span>Herramientas</span>
            <Badge variant='secondary'>{OPERACIONES.length + 1}</Badge>
          </div>
          <TabsList aria-label='Herramientas disponibles' className='utilidades-tabs'>
            {OPERACIONES.map(item => {
              const Icon = OP_ICON[item.id] ?? FileText;
              return (
                <TabsTrigger key={item.id} value={item.id} className='utilidad-trigger'>
                  <Icon aria-hidden='true' />
                  <span className='trigger-copy'><span>{item.titulo}</span><small>{formatos(item.accept)}</small></span>
                  <ArrowRight className='trigger-arrow' aria-hidden='true' />
                </TabsTrigger>
              );
            })}
            <TabsTrigger value='percentiles' className='utilidad-trigger'>
              <RefreshCw aria-hidden='true' />
              <span className='trigger-copy'><span>Recalcular percentiles</span><small>Balances sectoriales</small></span>
              <ArrowRight className='trigger-arrow' aria-hidden='true' />
            </TabsTrigger>
          </TabsList>
          <div className='navegacion-nota'><ShieldCheck aria-hidden='true' /><p>Las cargas solo se ejecutan después de revisar y confirmar.</p></div>
        </div>

        <section className='utilidades-trabajo' aria-label='Área de trabajo'>
          {OPERACIONES.map(item => (
            <TabsContent key={item.id} value={item.id} className='utilidad-contenido'>
              <Card className='utilidad-card'>
                <CardHeader>
                  <div className='card-icono'><FileSpreadsheet aria-hidden='true' /></div>
                  <div>
                    <CardTitle>{item.titulo}</CardTitle>
                    <CardDescription>{item.ayuda}</CardDescription>
                  </div>
                  <CardAction><StateBadge state={preview?.status} /></CardAction>
                </CardHeader>
                <Separator />
                <CardContent className='espacio-contenido'>
                  <form onSubmit={onUpload} className='utilidad-form'>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`file-${item.id}`}>Archivo de origen</FieldLabel>
                        <label className={`dropzone ${file ? 'tiene-archivo' : ''}`} htmlFor={`file-${item.id}`}>
                          <span className='dropzone-icon'><Upload aria-hidden='true' /></span>
                          <span className='dropzone-copy'>
                            <strong>{file ? file.name : 'Selecciona un archivo para comenzar'}</strong>
                            <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · listo para validar` : `Formatos admitidos: ${formatos(item.accept)} · Máximo según configuración del servidor`}</small>
                          </span>
                          <span className='dropzone-action'>{file ? 'Cambiar' : 'Explorar'}</span>
                          <Input
                            id={`file-${item.id}`}
                            name='file'
                            type='file'
                            accept={item.accept}
                            className='sr-only'
                            onChange={e => setFile(e.target.files?.[0] ?? null)}
                            disabled={ocupado || Boolean(previewId)}
                            aria-describedby={`file-help-${item.id}`}
                          />
                        </label>
                        <FieldDescription id={`file-help-${item.id}`}>El archivo queda temporalmente retenido para que confirmes la misma carga tras revisar el diagnóstico.</FieldDescription>
                      </Field>
                      {subida !== null && (
                        <Field>
                          <div className='progreso-cabecera'><span>Subiendo archivo</span><span>{subida}%</span></div>
                          <Progress value={subida} aria-label={`Subida del archivo: ${subida}%`} />
                        </Field>
                      )}
                    </FieldGroup>
                    <div className='form-acciones'>
                      <Button type='submit' size='lg' disabled={!file || ocupado || Boolean(previewId)}>
                        {ocupado && !previewId ? <Spinner data-icon='inline-start' /> : <ListChecks data-icon='inline-start' />}
                        Subir y validar
                      </Button>
                      {previewId && <Button type='button' variant='ghost' onClick={reset}>Cancelar vista previa</Button>}
                    </div>
                  </form>

                  {error && <Message variant='destructive' title='No se pudo completar la operación'>{error}</Message>}
                  {preview && <OperationResult preview={preview} job={job} />}

                  {preview?.status === 'ready' && !item.soloVista && (
                    <div className='confirmacion'>
                      {['balances', 'catalogo', 'ciiu'].includes(item.id) && (
                        <Field className='modo-carga'>
                          <FieldLabel>Modo de carga</FieldLabel>
                          <FieldDescription>Elige cómo aplicar los registros válidos.</FieldDescription>
                          <ToggleGroup type='single' variant='outline' value={modo} onValueChange={value => value && setModo(value)} aria-label='Modo de carga'>
                            <ToggleGroupItem value='snapshot_completo'>Completa</ToggleGroupItem>
                            <ToggleGroupItem value='parcial'>Parcial</ToggleGroupItem>
                          </ToggleGroup>
                          <span className='modo-ayuda'>{modo === 'snapshot_completo' ? 'Marca como ausentes los datos que no vengan en el archivo.' : 'Conserva los datos actuales que no estén en el archivo.'}</span>
                        </Field>
                      )}
                      <div className='confirmacion-cta'>
                        <div><strong>Revisión terminada</strong><span>La carga aún no modifica los datos.</span></div>
                        <Button onClick={onExecute} disabled={ocupado} size='lg'>
                          {ocupado ? <Spinner data-icon='inline-start' /> : <Check data-icon='inline-start' />}
                          {item.id === 'coeficientes' ? 'Confirmar y actualizar análisis' : 'Confirmar carga'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {['ready', 'failed', 'executed'].includes(preview?.status) && (
                    <div className='resultado-acciones'><Button variant='outline' onClick={reset}>Limpiar resultado y cargar otro archivo</Button></div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
          <TabsContent value='percentiles' className='utilidad-contenido'>
            <Card className='utilidad-card percentiles-card'>
              <CardHeader>
                <div className='card-icono'><BarChart3 aria-hidden='true' /></div>
                <div>
                  <CardTitle>Recalcular percentiles sectoriales</CardTitle>
                  <CardDescription>Reconstruye las magnitudes y posiciones sectoriales a partir de los balances cargados.</CardDescription>
                </div>
                <CardAction><StateBadge state={percentiles ? 'completed' : ocupado ? 'running' : null} /></CardAction>
              </CardHeader>
              <Separator />
              <CardContent className='espacio-contenido'>
                <Empty className='percentil-intro'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'><RefreshCw aria-hidden='true' /></EmptyMedia>
                    <EmptyTitle>Actualiza los indicadores del análisis</EmptyTitle>
                    <EmptyDescription>El cálculo puede tardar varios minutos. Mientras se ejecuta, puedes seguir esta página abierta para ver el resultado.</EmptyDescription>
                  </EmptyHeader>
                  <Button onClick={onPercentiles} disabled={ocupado} size='lg'>
                    {ocupado ? <Spinner data-icon='inline-start' /> : <RefreshCw data-icon='inline-start' />}
                    {ocupado ? 'Recalculando percentiles…' : 'Iniciar recálculo'}
                  </Button>
                </Empty>
                {pctError && <Message variant='destructive' title='No se pudo recalcular'>{pctError}</Message>}
                {percentiles && <Message title='Recálculo completado'>
                  <div className='percentil-metricas'>
                    <Metric label='Balances' value={percentiles.balances} />
                    <Metric label='Cortes' value={percentiles.cortes} />
                    <Metric label='Empresas' value={percentiles.empresas} />
                    <Metric label='Duración' value={`${((percentiles.ms ?? 0) / 1000).toFixed(1)} s`} />
                  </div>
                </Message>}
              </CardContent>
            </Card>
          </TabsContent>
        </section>
      </Tabs>
    </div>
  );
}

function formatos(accept = '') {
  return accept.split(',').map(ext => ext.trim().replace('.', '').toUpperCase()).join(' · ');
}

function StateBadge({ state }) {
  if (!state) return <Badge variant='outline' className='estado-badge'><CircleHelp /> Pendiente</Badge>;
  const completed = ['ready', 'completed', 'executed'].includes(state);
  const failed = state === 'failed';
  return <Badge variant='outline' className={`estado-badge ${completed ? 'estado-ok' : failed ? 'estado-error' : 'estado-proceso'}`}>
    {completed ? <Check /> : failed ? <CircleHelp /> : <Spinner />}
    {LABEL_STATUS[state] ?? state}
  </Badge>;
}

function Message({ variant, title, children }) {
  return (
    <Alert variant={variant} className={`mensaje-resultado ${variant === 'destructive' ? 'mensaje-error' : 'mensaje-ok'}`} aria-live='polite'>
      {variant === 'destructive' ? <CircleHelp aria-hidden='true' /> : <BadgeCheck aria-hidden='true' />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function OperationResult({ preview, job }) {
  const active = ['validating', 'executing'].includes(preview.status);
  return (
    <div className='diagnostico' aria-live='polite'>
      <div className='diagnostico-heading'>
        <div><span className='section-kicker'>Resultado</span><h2>Diagnóstico de validación</h2></div>
        <StateBadge state={preview.status} />
      </div>
      {preview.errorMessage && <Message variant='destructive' title='El archivo no pasó la validación'>{preview.errorMessage}</Message>}
      {active && <div className='validando'><Spinner /><span>Estamos leyendo el archivo. Este proceso puede tardar según el tamaño.</span></div>}
      {preview.report && <Report value={preview.report} />}
      {job && <Message variant={job.status === 'failed' ? 'destructive' : undefined} title={LABEL_STATUS[job.status] ?? job.status}>
        {job.status === 'failed' ? job.errorMessage : !['completed', 'failed'].includes(job.status) ? `Avance de carga: ${job.progressPct ?? 0}%.` : `${NUM(job.rowsInserted)} nuevas, ${NUM(job.rowsUpdated)} actualizadas y ${NUM(job.rowsRejected)} rechazadas.`}
      </Message>}
      {preview.status === 'executed' && !preview.importJobId && <Message title='Operación completada'>La carga se confirmó y finalizó correctamente.</Message>}
    </div>
  );
}

function Metric({ label, value }) {
  return <div className='percentil-metrica'><span>{label}</span><strong>{NUM(value)}</strong></div>;
}

function Report({ value }) {
  return (
    <section className='utilidad-reporte' aria-label='Detalle del diagnóstico'>
      <div className='reporte-titulo'><div><span className='section-kicker'>Vista previa</span><h3>Detalle del diagnóstico</h3></div><Badge variant='secondary'>Sin cambios en datos</Badge></div>
      <ReportValue value={value} />
    </section>
  );
}

function ReportValue({ value }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <p className='sin-elementos'>Sin elementos</p>;
    if (typeof value[0] !== 'object' || value[0] === null) return <p>{value.map(NUM).join(', ')}</p>;
    const keys = Object.keys(value[0]);
    return (
      <div className='utilidad-tabla-scroll'>
        <Table>
          <TableHeader><TableRow>{keys.map(key => <TableHead key={key}>{key}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{value.slice(0, 50).map((row, i) => <TableRow key={i}>{keys.map(key => <TableCell key={key}>{typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : NUM(row[key])}</TableCell>)}</TableRow>)}</TableBody>
        </Table>
        {value.length > 50 && <small>Se muestran 50 de {NUM(value.length)} filas.</small>}
      </div>
    );
  }
  if (typeof value === 'object') return (
    <dl className='utilidad-datos'>
      {Object.entries(value).map(([key, item]) => <div key={key}><dt>{humanize(key)}</dt><dd><ReportValue value={item} /></dd></div>)}
    </dl>
  );
  return <span className='dato-valor'>{NUM(value)}</span>;
}

function humanize(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, char => char.toUpperCase());
}
