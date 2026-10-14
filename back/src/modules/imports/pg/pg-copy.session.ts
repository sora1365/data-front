import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import { once } from 'node:events';
// OJO: este proyecto NO tiene `esModuleInterop`. Un import por defecto
// (`import copyFrom from 'pg-copy-streams'`) compila pero en runtime emite
// `mod.default`, que es `undefined`. Debe ser un import de namespace.
import * as copyStreams from 'pg-copy-streams';
import { SESSION_TUNING } from './sql/import.sql';
import { databaseSslConfig } from '../../../database/database-ssl';

export interface CopyWriter {
  write(text: string): Promise<void>;
  finish(): Promise<number>;
}

/**
 * Base común de las conexiones dedicadas de import: conexión, lock consultivo
 * del job y `COPY FROM STDIN` con contrapresión.
 *
 * Está separada de `ImportPgSession` porque hay más de un importador masivo
 * (compañías y balances) y el `beginCopy` de abajo es el punto frágil nº 1 del
 * README: no puede existir copiado en dos sitios. Todo lo que sea SQL de un
 * dominio concreto vive en la subclase, no aquí.
 *
 * Es un `pg.Client` propio y no una conexión del pool de TypeORM por dos
 * motivos: el `COPY` mantiene la conexión ocupada en una sentencia durante
 * minutos, y los ajustes de sesión (`synchronous_commit = off`, etc.) no deben
 * filtrarse al resto de la aplicación.
 */
export abstract class PgCopySession {
  protected readonly logger = new Logger(this.constructor.name);
  protected client: Client;

  constructor(protected readonly jobId: string) {}

  async connect(): Promise<void> {
    this.client = await this.crearCliente();
  }

  /**
   * Abre una conexión con el tuning de carga masiva aplicado.
   *
   * Está separada de `connect()` porque un importador puede necesitar más de
   * una: Postgres admite un solo `COPY` activo por sesión, así que pivotar un
   * archivo hacia dos tablas a la vez exige dos conexiones.
   */
  protected async crearCliente(): Promise<Client> {
    const client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'app_db',
      ssl: databaseSslConfig(),
    });
    await client.connect();
    for (const stmt of SESSION_TUNING) {
      await client.query(stmt);
    }
    return client;
  }

  /**
   * Toma un lock consultivo a nivel de SESIÓN mientras dura el job.
   *
   * Postgres lo libera solo cuando la conexión se cierra —incluido el caso en
   * que el proceso muere—, que es justo la semántica que hace falta: al
   * arrancar, otra instancia puede distinguir "este job está vivo en otro
   * proceso" de "este job quedó colgado" simplemente intentando tomar el lock.
   */
  async acquireJobLock(): Promise<boolean> {
    const { rows } = await this.client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok',
      [`import_job:${this.jobId}`],
    );
    return rows[0]?.ok === true;
  }

  /**
   * Abre un `COPY ... FROM STDIN` y devuelve un escritor que respeta la
   * contrapresión.
   *
   * Este es EL punto donde este tipo de importadores se cae por falta de
   * memoria. `write()` devuelve `false` cuando el buffer del socket está lleno;
   * si se ignora, el parser sigue produciendo filas a más velocidad de la que
   * Postgres las consume y la diferencia se acumula, sin límite y sin síntoma
   * visible salvo que "el COPY tiene una fuga de memoria".
   *
   * Al esperar el evento `drain` desde dentro del `for await` que recorre las
   * filas, se suspende toda la cadena de arriba —incluidas la descompresión del
   * ZIP y el parseo del XML, o la lectura del .txt— porque el iterador no se
   * vuelve a consultar hasta volver del await.
   */
  beginCopy(copySql: string, cliente: Client = this.client): CopyWriter {
    const stream: any = cliente.query((copyStreams as any).from(copySql));

    // El error debe capturarse ANTES del bucle: si la conexión se corta a mitad,
    // un `await once(stream, 'drain')` se quedaría esperando para siempre.
    //
    // Se registra UNA sola promesa de rechazo en vez de un `once(stream,'error')`
    // dentro de cada espera: con cientos de miles de `drain`, esa segunda forma
    // añadiría un listener por iteración y acabaría en un aviso de fuga.
    let failure: Error | null = null;
    let rejectOnError: (err: Error) => void;
    const errorPromise = new Promise<never>((_, reject) => {
      rejectOnError = reject;
    });
    errorPromise.catch(() => undefined); // evita un unhandledRejection si nadie la espera
    stream.on('error', (err: Error) => {
      failure = err;
      rejectOnError(err);
    });

    return {
      async write(text: string): Promise<void> {
        if (failure) throw failure;
        if (!stream.write(text)) {
          await Promise.race([once(stream, 'drain'), errorPromise]);
        }
      },
      async finish(): Promise<number> {
        if (failure) throw failure;
        stream.end();
        await Promise.race([once(stream, 'finish'), errorPromise]);
        if (failure) throw failure;
        return Number(stream.rowCount ?? 0);
      },
    };
  }

  /**
   * Sin esto el planner no tiene estadísticas del staging (reltuples = -1 en
   * PG16) y elige un nested loop sobre la PK para el merge, convirtiendo un
   * hash join de un minuto en horas. Cuesta un par de segundos.
   */
  protected async analyze(table: string): Promise<void> {
    await this.client.query(`ANALYZE ${table}`);
  }

  protected async dropTable(table: string): Promise<void> {
    try {
      await this.client.query(`DROP TABLE IF EXISTS ${table}`);
    } catch (err) {
      this.logger.warn(`No se pudo borrar el staging ${table}: ${(err as Error).message}`);
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.end();
    } catch {
      /* la conexión ya estaba caída */
    }
  }
}
