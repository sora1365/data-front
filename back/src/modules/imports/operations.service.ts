import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { promises as fs } from 'node:fs';
import { LessThan, Repository } from 'typeorm';
import { abrirLectorDeLineas } from '../../common/text/lineas';
import { decodificarTexto } from '../../common/text/encoding';
import { codigosEcuacion } from '../../common/finanzas/conceptos';
import { FORMULARIO_POR_NUM_CUENTAS } from './formularios';
import { parsearCabecera, parsearFila } from './balances/balances-file.parser';
import { parsearCatalogo } from './catalogo/catalogo-file.parser';
import { construirJerarquia } from './catalogo/jerarquia';
import { SourceRow, readRows } from './xlsx/xlsx-row-source';
import { parsearCiiu } from './ciiu/ciiu-file.parser';
import { construirJerarquiaCiiu } from './ciiu/jerarquia-ciiu';
import { ImportJobsService } from './import-jobs.service';
import { ImportJob } from './entities/import-job.entity';
import { OperationPreview } from './entities/operation-preview.entity';
import { CatalogoImportService } from './catalogo/catalogo-import.service';
import { CiiuImportService } from './ciiu/ciiu-import.service';
import { BalancesImportService } from './balances/balances-import.service';
import {
  IMPORT_KIND_CATALOGO,
  IMPORT_KIND_CIIU,
  IMPORT_KIND_COEFICIENTES,
} from './imports.constants';
import { IMPORT_KIND_BALANCES } from './balances/balances.constants';

export const OPERATION_KINDS = [
  'auditar-fuentes',
  'balances',
  'catalogo',
  'ciiu',
  'coeficientes',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

const EXPIRACION_MS =
  Math.max(1, Number(process.env.OPERATION_PREVIEW_TTL_HOURS) || 24) *
  60 *
  60 *
  1000;
const MUESTRA_RECHAZOS = 50;

@Injectable()
export class OperationsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OperationsService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(OperationPreview)
    private readonly previews: Repository<OperationPreview>,
    private readonly jobs: ImportJobsService,
    private readonly catalogo: CatalogoImportService,
    private readonly ciiu: CiiuImportService,
    private readonly balances: BalancesImportService,
    @InjectRepository(ImportJob)
    private readonly importJobs: Repository<ImportJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.limpiarExpiradas();
    this.cleanupTimer = setInterval(
      () => void this.limpiarExpiradas(),
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async crearPreview(
    kind: OperationKind,
    file: Express.Multer.File,
  ): Promise<OperationPreview> {
    if (!file)
      throw new BadRequestException(
        'No se recibió ningún archivo en el campo "file".',
      );
    let preview: OperationPreview;
    try {
      preview = await this.previews.save(
        this.previews.create({
          kind,
          status: 'validating',
          originalFilename: file.originalname,
          storedPath: file.path,
          report: null,
          errorMessage: null,
          importJobId: null,
          expiresAt: new Date(Date.now() + EXPIRACION_MS),
        }),
      );
    } catch (err) {
      await fs.unlink(file.path).catch(() => undefined);
      throw err;
    }
    void this.validar(preview.id).catch((err) =>
      this.logger.error(
        `Vista previa ${preview.id}: ${(err as Error).message}`,
      ),
    );
    return preview;
  }

  async obtener(id: string): Promise<OperationPreview> {
    const preview = await this.previews.findOne({ where: { id } });
    if (!preview || preview.expiresAt.getTime() <= Date.now()) {
      if (preview) await this.eliminar(preview);
      throw new NotFoundException(
        'La vista previa no existe o venció. Vuelve a subir el archivo.',
      );
    }
    return preview;
  }

  async cancelar(id: string): Promise<{ eliminado: true }> {
    const preview = await this.obtener(id);
    if (preview.status === 'executing' || preview.status === 'executed') {
      throw new ConflictException(
        'La operación ya fue confirmada y no se puede cancelar.',
      );
    }
    await this.eliminar(preview);
    return { eliminado: true };
  }

  async ejecutar(id: string, modo?: string): Promise<Record<string, unknown>> {
    const preview = await this.obtener(id);
    if (preview.status !== 'ready') {
      throw new ConflictException(
        'La vista previa todavía no está lista o no se pudo validar.',
      );
    }
    if (preview.kind === 'auditar-fuentes') {
      throw new BadRequestException(
        'La auditoría sólo genera un diagnóstico; no carga datos.',
      );
    }
    const claim = await this.previews
      .createQueryBuilder()
      .update(OperationPreview)
      .set({ status: 'executing' })
      .where('id = :id AND status = :status', { id, status: 'ready' })
      .execute();
    if (!claim.affected) {
      throw new ConflictException(
        'Esta vista previa ya fue confirmada o está siendo procesada.',
      );
    }
    if (preview.kind === 'coeficientes') {
      const activo = await this.jobs.hayJobActivo(IMPORT_KIND_COEFICIENTES);
      if (activo) {
        await this.previews.update(id, { status: 'ready' });
        throw new ConflictException(
          `Ya hay una carga de coeficientes en curso (job ${activo.id}).`,
        );
      }
      let job: ImportJob;
      try {
        const stat = await fs.stat(preview.storedPath);
        job = await this.importJobs.save(
          this.importJobs.create({
            kind: IMPORT_KIND_COEFICIENTES,
            status: 'parsing',
            modo: 'parcial',
            originalFilename: preview.originalFilename,
            storedPath: preview.storedPath,
            fileSizeBytes: stat.size,
            startedAt: new Date(),
          }),
        );
        await this.previews.update(id, { importJobId: job.id });
      } catch (err) {
        await this.previews.update(id, { status: 'ready' });
        if ((err as any)?.code === '23505') {
          throw new ConflictException(
            'Ya hay una carga de coeficientes en curso.',
          );
        }
        throw err;
      }
      try {
        const result = await this.cargarCoeficientes(preview.storedPath);
        await fs.unlink(preview.storedPath).catch(() => undefined);
        const cantidad =
          Number(result.coeficientesEspecificos ?? 0) +
          Number(result.coeficientesGenerales ?? 0);
        await this.importJobs.update(job.id, {
          status: 'completed',
          progressPct: 100,
          rowsRead: cantidad,
          rowsInserted: cantidad,
          finishedAt: new Date(),
          storedPath: '',
        });
        await this.previews.update(id, {
          status: 'executed',
          storedPath: '',
          importJobId: job.id,
          report: { ...preview.report, resultado: result },
        });
        return { status: 'executed', jobId: job.id, resultado: result };
      } catch (err) {
        await this.importJobs.update(job.id, {
          status: 'failed',
          errorMessage: (err as Error).message,
          finishedAt: new Date(),
          storedPath: '',
        });
        await this.previews.update(id, {
          status: 'ready',
          errorMessage: (err as Error).message,
          importJobId: job.id,
        });
        throw err;
      }
    }

    const kind = this.importKind(preview.kind);
    const activo = await this.jobs.hayJobActivo(kind);
    if (activo) {
      await this.previews.update(id, { status: 'ready' });
      throw new ConflictException(
        `Ya hay una importación de este tipo en curso (job ${activo.id}).`,
      );
    }
    try {
      const stat = await fs.stat(preview.storedPath);
      const job = await this.importJobs.save(
        this.importJobs.create({
          kind,
          status: 'pending',
          modo: modo === 'parcial' ? 'parcial' : 'snapshot_completo',
          originalFilename: preview.originalFilename,
          storedPath: preview.storedPath,
          fileSizeBytes: stat.size,
        }),
      );
      await this.previews.update(id, {
        status: 'executed',
        storedPath: '',
        importJobId: job.id,
      });
      this.importador(preview.kind).enqueue(job.id);
      return {
        status: 'executed',
        jobId: job.id,
        statusUrl: `/imports/${job.id}`,
      };
    } catch (err: any) {
      await this.previews.update(id, { status: 'ready' });
      if (err?.code === '23505') {
        throw new ConflictException(
          `Ya hay una importación de este tipo en curso.`,
        );
      }
      throw err;
    }
  }

  private async validar(id: string): Promise<void> {
    const preview = await this.previews.findOne({ where: { id } });
    if (!preview) return;
    try {
      let report: Record<string, unknown>;
      switch (preview.kind) {
        case 'auditar-fuentes':
          report = await this.auditarExcel(preview.storedPath);
          break;
        case 'balances':
          report = await this.validarBalances(preview.storedPath);
          break;
        case 'catalogo':
          report = await this.validarCatalogo(preview.storedPath);
          break;
        case 'ciiu':
          report = await this.validarCiiu(preview.storedPath);
          break;
        case 'coeficientes':
          report = await this.validarCoeficientes(preview.storedPath);
          break;
        default:
          throw new BadRequestException('Tipo de operación desconocido.');
      }
      await this.previews.update(id, {
        status: 'ready',
        report,
        errorMessage: null,
      });
    } catch (err) {
      await this.previews.update(id, {
        status: 'failed',
        errorMessage: (err as Error).message,
      });
    }
  }

  private async auditarExcel(path: string): Promise<Record<string, unknown>> {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
      sharedStrings: 'cache',
      worksheets: 'emit',
    });
    const hojas: Record<string, unknown>[] = [];
    for await (const hoja of reader as any) {
      const filas: unknown[][] = [];
      for await (const fila of hoja) {
        filas.push((fila.values as unknown[]).slice(1));
        if (filas.length >= 2) break;
      }
      hojas.push({
        nombre: String(hoja.name ?? `Hoja${hojas.length + 1}`),
        columnas: (filas[0] ?? []).map((v) => this.excelText(v)),
        primeraFila: (filas[1] ?? [])
          .slice(0, 30)
          .map((v) => this.excelText(v)),
      });
      if (hojas.length >= 3) break;
    }
    if (!hojas.length) throw new Error('El Excel no contiene hojas con datos.');
    return { hojas };
  }

  private async validarCatalogo(
    path: string,
  ): Promise<Record<string, unknown>> {
    const buffer = await fs.readFile(path);
    const { texto, encoding } = decodificarTexto(buffer);
    const { cuentas, rechazos, duplicados } = parsearCatalogo(texto);
    if (!cuentas.length)
      throw new Error(
        'El archivo no contiene cuentas válidas. Se esperaba código y nombre separados por tabulador.',
      );
    const jerarquia = construirJerarquia(cuentas);
    const niveles: Record<string, number> = {};
    for (const cuenta of jerarquia)
      niveles[cuenta.nivel] = (niveles[cuenta.nivel] ?? 0) + 1;
    return {
      encoding,
      bytes: buffer.length,
      cuentas: cuentas.length,
      rechazadas: rechazos.length,
      rechazos: rechazos
        .slice(0, MUESTRA_RECHAZOS)
        .map((r) => ({ fila: r.linea, motivo: r.motivo, raw: r.raw })),
      duplicados,
      raices: jerarquia.filter((c) => c.codigoPadre === null).length,
      hojas: jerarquia.filter((c) => c.esHoja).length,
      porNivel: niveles,
      ejemplos: jerarquia
        .slice(0, 8)
        .map(({ codigo, nombre, nivel, codigoPadre }) => ({
          codigo,
          nombre,
          nivel,
          codigoPadre,
        })),
      nombresConCaracterReemplazo: jerarquia.filter((c) =>
        c.nombre.includes('�'),
      ).length,
    };
  }

  private async validarCiiu(path: string): Promise<Record<string, unknown>> {
    const filas: SourceRow[] = [];
    for await (const fila of readRows(path)) filas.push(fila);
    const { actividades, rechazos, duplicados } = parsearCiiu(filas);
    if (!actividades.length)
      throw new Error(
        'No se encontraron actividades CIIU válidas en la primera hoja.',
      );
    const { actividades: jerarquia, discrepancias } =
      construirJerarquiaCiiu(actividades);
    const porNivel: Record<string, number> = {};
    for (const a of jerarquia) porNivel[a.nivel] = (porNivel[a.nivel] ?? 0) + 1;
    const porCodigo = new Map(jerarquia.map((a) => [a.codigo, a]));
    const saltos = jerarquia.filter(
      (a) =>
        a.codigoPadre && porCodigo.get(a.codigoPadre)?.nivel !== a.nivel - 1,
    );
    return {
      filas: filas.length,
      actividades: actividades.length,
      rechazadas: rechazos.length,
      rechazos: rechazos
        .slice(0, MUESTRA_RECHAZOS)
        .map((r) => ({ fila: r.fila, motivo: r.motivo, raw: r.raw })),
      duplicados,
      raices: jerarquia.filter((a) => a.codigoPadre === null).length,
      hojas: jerarquia.filter((a) => a.esHoja).length,
      porNivel,
      saltosDeNivel: saltos.length,
      conCodigoSupercias: jerarquia.filter((a) => a.codigoSupercias).length,
      discrepancias: discrepancias.slice(0, MUESTRA_RECHAZOS),
    };
  }

  private async validarBalances(
    path: string,
  ): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    const { encoding, lineas } = await abrirLectorDeLineas(path);
    let cabecera: ReturnType<typeof parsearCabecera>['cabecera'] = null;
    let ecuacion: {
      activo: string;
      pasivo: string;
      patrimonio: string;
    } | null = null;
    let numeroLinea = 0,
      filas = 0,
      rechazadas = 0,
      celdas = 0,
      celdasMalas = 0,
      conAcento = 0,
      descuadres = 0,
      conEcuacion = 0;
    const anios = new Map<number, number>();
    const motivos = new Map<string, number>();
    const ejemplos: string[] = [];
    for await (const linea of lineas) {
      numeroLinea++;
      if (!cabecera) {
        const parsed = parsearCabecera(linea);
        for (const p of parsed.problemas)
          motivos.set(p.motivo, (motivos.get(p.motivo) ?? 0) + 1);
        if (!parsed.cabecera)
          throw new Error(
            `No se pudo interpretar la cabecera: ${parsed.problemas.map((p) => p.motivo).join(', ')}`,
          );
        cabecera = parsed.cabecera;
        ecuacion = codigosEcuacion(
          FORMULARIO_POR_NUM_CUENTAS[cabecera.cuentas.length],
        );
        continue;
      }
      if (!linea) continue;
      const {
        fila,
        cuentas,
        rechazos: incidencias,
      } = parsearFila(linea, cabecera);
      for (const r of incidencias) {
        const motivo = r.motivo.split(':')[0];
        motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
        celdasMalas++;
        if (ejemplos.length < 5)
          ejemplos.push(`línea ${numeroLinea}: ${r.columna} → ${r.motivo}`);
      }
      if (!fila) {
        rechazadas++;
        continue;
      }
      filas++;
      celdas += cuentas.length;
      anios.set(fila.anio, (anios.get(fila.anio) ?? 0) + 1);
      if (/[ÁÉÍÓÚÑáéíóúñ]/.test(fila.descripcion_rama ?? '')) conAcento++;
      if (!ecuacion) continue;
      const a = cuentas.find((c) => c.codigo === ecuacion!.activo);
      const p = cuentas.find((c) => c.codigo === ecuacion!.pasivo);
      const q = cuentas.find((c) => c.codigo === ecuacion!.patrimonio);
      if (a || p || q) {
        conEcuacion++;
        if (
          Math.abs(
            Number(a?.valor ?? 0) -
              (Number(p?.valor ?? 0) + Number(q?.valor ?? 0)),
          ) > 0.05
        )
          descuadres++;
      }
    }
    if (!cabecera) throw new Error('El archivo está vacío.');
    const total = filas * cabecera.cuentas.length;
    return {
      encoding,
      formulario: FORMULARIO_POR_NUM_CUENTAS[cabecera.cuentas.length] ?? null,
      cuentas: cabecera.cuentas.length,
      anios: [...anios].map(([anio, cantidad]) => ({
        anio,
        balances: cantidad,
      })),
      balances: filas,
      rechazados: rechazadas,
      celdasConValor: celdas,
      celdasTotales: total,
      densidadPct: total ? Number(((100 * celdas) / total).toFixed(2)) : 0,
      celdasMalas,
      conAcentos: conAcento,
      descuadres,
      balancesConEcuacion: conEcuacion,
      motivos: [...motivos]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MUESTRA_RECHAZOS)
        .map(([motivo, cantidad]) => ({ motivo, cantidad })),
      ejemplos,
      tiempoSegundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
  }

  private async validarCoeficientes(
    path: string,
  ): Promise<Record<string, unknown>> {
    const parsed = await this.leerCoeficientes(path);
    return {
      coeficientesEspecificos: parsed.especificos.length,
      coeficientesGenerales: parsed.generales.length,
      anios: parsed.anios,
      celdasVacias: parsed.vacias,
      detallePorAnio: parsed.anios.map((anio) => ({
        anio,
        especificos: parsed.especificos.filter((x) => x.anio === anio).length,
        generales: parsed.generales.filter((x) => x.anio === anio).length,
      })),
    };
  }

  private async cargarCoeficientes(
    path: string,
  ): Promise<Record<string, number | number[]>> {
    const { especificos, generales, anios, vacias } =
      await this.leerCoeficientes(path);
    const qr = this.importJobs.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `DELETE FROM coeficiente_presuntivo WHERE anio = ANY($1)`,
        [anios],
      );
      await qr.query(`DELETE FROM coeficiente_general WHERE anio = ANY($1)`, [
        anios,
      ]);
      for (const e of especificos)
        await qr.query(
          `INSERT INTO coeficiente_presuntivo (anio, grupo_ciiu, base, coeficiente) VALUES ($1,$2,$3::base_presuntiva,$4)`,
          [e.anio, e.grupo, e.base, e.coef],
        );
      for (const g of generales)
        await qr.query(
          `INSERT INTO coeficiente_general (anio, concepto, base, coeficiente) VALUES ($1,$2,$3::base_presuntiva,$4)`,
          [g.anio, g.concepto, g.base, g.coef],
        );
      const [{ huerfanos }] = await qr.query(
        `SELECT count(*)::int AS huerfanos FROM (SELECT DISTINCT anio FROM coeficiente_presuntivo WHERE anio = ANY($1)) a WHERE NOT EXISTS (SELECT 1 FROM coeficiente_general g WHERE g.anio = a.anio AND g.concepto = 'general' AND g.base = 'ingresos')`,
        [anios],
      );
      if (Number(huerfanos) > 0)
        throw new Error(
          `${huerfanos} ejercicio(s) sin coeficiente general de ingresos.`,
        );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
    await this.importJobs.manager.query(
      `REFRESH MATERIALIZED VIEW riesgo_tributario`,
    );
    await this.importJobs.manager.query(
      `REFRESH MATERIALIZED VIEW riesgo_tributario_anio`,
    );
    await this.importJobs.manager.query(
      `REFRESH MATERIALIZED VIEW perfil_riesgo_tributario`,
    );
    const [r] = await this.importJobs.manager.query(
      `SELECT count(*)::int AS filas, count(*) FILTER (WHERE NOT coef_especifico)::int AS por_general FROM riesgo_tributario`,
    );
    const [p] = await this.importJobs.manager.query(
      `SELECT count(*)::int AS empresas, count(*) FILTER (WHERE anios_decil_alto >= 3)::int AS persistentes FROM perfil_riesgo_tributario`,
    );
    return {
      ejercicios: anios,
      coeficientesEspecificos: especificos.length,
      coeficientesGenerales: generales.length,
      celdasVacias: vacias,
      balances: r.filas,
      balancesPorGeneral: r.por_general,
      empresas: p.empresas,
      persistentes: p.persistentes,
    };
  }

  private async leerCoeficientes(path: string) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const planes = [
      { hoja: 'Ingresos', base: 'ingresos' },
      { hoja: 'Costos y Gastos', base: 'costos_gastos' },
      { hoja: 'Activos', base: 'activos' },
    ] as const;
    const especificos: {
      anio: number;
      grupo: string;
      base: string;
      coef: number;
    }[] = [];
    const anios = new Set<number>();
    let vacias = 0;
    const texto = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') {
        const o = v as any;
        if (o.richText) return o.richText.map((t: any) => t.text).join('');
        if (o.result !== undefined) return String(o.result);
        if (o.text !== undefined) return String(o.text);
      }
      return String(v);
    };
    const coef = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : Number(texto(v).replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    for (const { hoja, base } of planes) {
      const ws = wb.getWorksheet(hoja);
      if (!ws) throw new Error(`El archivo no trae la hoja "${hoja}".`);
      const columnas: { col: number; anio: number }[] = [];
      for (let c = 4; c <= ws.columnCount; c++) {
        const anio = Number(texto(ws.getRow(4).getCell(c).value));
        if (Number.isInteger(anio) && anio >= 2000 && anio <= 2100)
          columnas.push({ col: c, anio });
      }
      if (!columnas.length)
        throw new Error(`No encontré columnas de año en "${hoja}".`);
      for (let f = 5; f <= ws.rowCount; f++) {
        const fila = ws.getRow(f);
        const grupo = texto(fila.getCell(2).value).trim().toUpperCase();
        if (!/^[A-Z]\d{3}$/.test(grupo)) continue;
        for (const { col, anio } of columnas) {
          anios.add(anio);
          const valor = coef(fila.getCell(col).value);
          if (valor === null) vacias++;
          else especificos.push({ anio, grupo, base, coef: valor });
        }
      }
    }
    const generales: {
      anio: number;
      concepto: string;
      base: string;
      coef: number;
    }[] = [];
    const wsGen = wb.getWorksheet('Coef. generales');
    if (!wsGen)
      throw new Error('El archivo no trae la hoja "Coef. generales".');
    const columnas: { col: number; anio: number }[] = [];
    for (let c = 3; c <= wsGen.columnCount; c++) {
      const anio = Number(texto(wsGen.getRow(3).getCell(c).value));
      if (Number.isInteger(anio) && anio >= 2000 && anio <= 2100)
        columnas.push({ col: c, anio });
    }
    for (let f = 4; f <= wsGen.rowCount; f++) {
      const fila = wsGen.getRow(f);
      const etiqueta = texto(fila.getCell(2).value).toLowerCase();
      if (!etiqueta) continue;
      const base = etiqueta.includes('ingreso')
        ? 'ingresos'
        : etiqueta.includes('costo')
          ? 'costos_gastos'
          : etiqueta.includes('activo')
            ? 'activos'
            : null;
      if (!base) continue;
      const concepto = /mineral/i.test(texto(fila.getCell(1).value))
        ? 'minerales'
        : 'general';
      for (const { col, anio } of columnas) {
        const valor = coef(fila.getCell(col).value);
        if (valor !== null)
          generales.push({ anio, concepto, base, coef: valor });
      }
    }
    const years = [...anios].sort((a, b) => a - b);
    const sinGeneral = years.filter(
      (anio) =>
        !generales.some(
          (g) =>
            g.anio === anio &&
            g.concepto === 'general' &&
            g.base === 'ingresos',
        ),
    );
    if (!years.length || sinGeneral.length)
      throw new Error(
        `Faltan coeficientes generales de ingresos para: ${sinGeneral.join(', ') || 'ningún ejercicio válido'}.`,
      );
    return { especificos, generales, anios: years, vacias };
  }

  private importKind(kind: string): string {
    if (kind === 'balances') return IMPORT_KIND_BALANCES;
    if (kind === 'catalogo') return IMPORT_KIND_CATALOGO;
    if (kind === 'ciiu') return IMPORT_KIND_CIIU;
    if (kind === 'coeficientes') return IMPORT_KIND_COEFICIENTES;
    throw new BadRequestException(
      'Esta operación no es una importación estándar.',
    );
  }

  private importador(kind: string): { enqueue(id: string): void } {
    if (kind === 'balances') return this.balances;
    if (kind === 'catalogo') return this.catalogo;
    if (kind === 'ciiu') return this.ciiu;
    throw new BadRequestException('Esta operación no tiene importador.');
  }

  private excelText(v: unknown): string {
    if (v === null || v === undefined) return '(vacío)';
    if (typeof v === 'object') {
      const o = v as any;
      if (Array.isArray(o.richText))
        return o.richText.map((x: any) => x.text ?? '').join('');
      if ('result' in o) return String(o.result);
      if ('text' in o) return String(o.text);
    }
    return String(v).slice(0, 90);
  }

  private async limpiarExpiradas(): Promise<void> {
    const porVencer: OperationPreview[] = await this.previews.find({
      where: { expiresAt: LessThan(new Date()) },
    });
    for (const preview of porVencer) await this.eliminar(preview);
  }

  private async eliminar(preview: OperationPreview): Promise<void> {
    if (preview.storedPath)
      await fs.unlink(preview.storedPath).catch(() => undefined);
    await this.previews.delete(preview.id);
  }
}
