import { CopyWriter, PgCopySession } from '../pg/pg-copy.session';
import {
  copyIntoSriSql,
  createStagingSriSql,
  enriquecerCompaniasSql,
  estadisticasSql,
  indicesStagingSql,
  mergeEstablecimientosSql,
  mergePersonasSql,
  mergeSociedadesNoSupervisadasSql,
  rucAmbiguosSql,
  stagingSriTable,
} from './sql/sri.sql';

export interface Totales {
  insertadas: number;
  actualizadas: number;
}

const totales = (fila: Record<string, string> | undefined, k1: string, k2: string): Totales => ({
  insertadas: Number(fila?.[k1] ?? 0),
  actualizadas: Number(fila?.[k2] ?? 0),
});

/** Conexión dedicada al import del padrón del SRI. */
export class SriPgSession extends PgCopySession {
  readonly tabla: string;

  constructor(jobId: string) {
    super(jobId);
    this.tabla = stagingSriTable(jobId);
  }

  /**
   * El import SRI corre en el clúster de producción de 2 GB. Sobrescribe el
   * tuning genérico de cargas masivas para limitar el consumo de memoria de
   * consultas e impedir workers paralelos de mantenimiento.
   */
  async connect(): Promise<void> {
    await super.connect();
    await this.client.query("SET maintenance_work_mem = '128MB'");
    await this.client.query("SET work_mem = '16MB'");
    await this.client.query("SET temp_buffers = '8MB'");
    await this.client.query('SET max_parallel_maintenance_workers = 0');
  }

  async createStaging(): Promise<void> {
    await this.dropTable(this.tabla);
    await this.client.query(createStagingSriSql(this.tabla));
  }

  beginCopyStaging(): CopyWriter {
    return this.beginCopy(copyIntoSriSql(this.tabla));
  }

  /**
   * Índices y estadísticas del staging. Sin `ANALYZE`, el planner cree que la
   * tabla está vacía (reltuples = -1 en PG16) y elige nested loops para los
   * merges, convirtiendo minutos en horas.
   */
  async prepararStaging(): Promise<void> {
    for (const sql of indicesStagingSql(this.tabla)) {
      await this.client.query(sql);
    }
    await this.analyze(this.tabla);
  }

  async estadisticas() {
    const { rows } = await this.client.query(estadisticasSql(this.tabla));
    const r = rows[0] ?? {};
    return {
      filas: Number(r.filas ?? 0),
      rucs: Number(r.rucs ?? 0),
      personas: Number(r.personas ?? 0),
      sociedades: Number(r.sociedades ?? 0),
      sociedadesSupercias: Number(r.sociedades_supercias ?? 0),
    };
  }

  async rucAmbiguos(): Promise<string[]> {
    const { rows } = await this.client.query(rucAmbiguosSql(this.tabla));
    return rows.map((r: { ruc: string }) => r.ruc);
  }

  async mergePersonas(): Promise<Totales> {
    const { rows } = await this.client.query(mergePersonasSql(this.tabla), [this.jobId]);
    return totales(rows[0], 'insertadas', 'actualizadas');
  }

  async mergeSociedadesNoSupervisadas(): Promise<Totales> {
    const { rows } = await this.client.query(mergeSociedadesNoSupervisadasSql(this.tabla), [
      this.jobId,
    ]);
    return totales(rows[0], 'insertadas', 'actualizadas');
  }

  async enriquecerCompanias(): Promise<number> {
    const res = await this.client.query(enriquecerCompaniasSql(this.tabla), [this.jobId]);
    return res.rowCount ?? 0;
  }

  async mergeEstablecimientos(): Promise<Totales> {
    const { rows } = await this.client.query(mergeEstablecimientosSql(this.tabla), [this.jobId]);
    return totales(rows[0], 'insertados', 'actualizados');
  }

  async vacuumAnalyze(): Promise<void> {
    for (const t of ['persona_natural', 'sociedad_no_supervisada', 'establecimiento']) {
      this.logger.log(`VACUUM (ANALYZE) ${t}`);
      await this.client.query(`VACUUM (ANALYZE, PARALLEL 0) ${t}`);
    }
  }

  async dropStaging(): Promise<void> {
    await this.dropTable(this.tabla);
  }
}
