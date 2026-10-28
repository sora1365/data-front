import { BadRequestException, Injectable, Logger } from '@nestjs/common';
// `jszip` es CommonJS con `export =`, y este proyecto compila sin
// `esModuleInterop`: un `import JSZip from` compila pero llega `undefined`.
import JSZip = require('jszip');
import { DataSource } from 'typeorm';
import {
  archivoDe,
  csv,
  Manifiesto,
  motivoParaOmitir,
  sha256,
  TablaExportada,
  verificar,
  VERSION_FORMATO,
} from './exportacion.reglas';

interface Columna {
  nombre: string;
  tipo: string;
}

const LEEME = `Exportación completa del CRM de FRIDAY
======================================

tablas/       Un CSV por tabla (UTF-8, RFC 4180, saltos \\r\\n).
              Nulo = celda vacía. Texto vacío = "" (dos comillas).
              Las fechas van en UTC y con el formato de Postgres.
manifiesto.json  Qué tablas van, cuántas filas, qué columnas se omitieron
              y por qué, y la huella SHA-256 de cada CSV.

Para comprobar que nadie tocó un archivo:
    sha256sum tablas/crm.oportunidad.csv
y compararlo con el "sha256" de esa tabla en manifiesto.json. O subir el ZIP
entero en el CRM: Exportar datos → Verificar un archivo.

Para cargarlo en otra base con el mismo esquema (la migración que dice
"esquema" en el manifiesto):
    \\copy crm.oportunidad FROM 'tablas/crm.oportunidad.csv' CSV HEADER
`;

@Injectable()
export class ExportacionService {
  private readonly log = new Logger('Exportación');

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Las tablas que se exportan: todo el esquema `crm` y las tablas de fuera a
   * las que el CRM apunta (el catálogo de productos, los segmentos).
   *
   * Salen del catálogo de Postgres y no de una lista: una tabla nueva entra
   * sola en la siguiente exportación. Una lista escrita a mano se queda vieja
   * el día que alguien añade una, y la exportación seguiría diciendo
   * «completa» sin serlo.
   */
  private async tablas(q: (sql: string, p?: any[]) => Promise<any[]>): Promise<string[]> {
    const filas = await q(
      `SELECT c.oid::regclass::text AS tabla
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'crm' AND c.relkind IN ('r','p')
          AND NOT c.relispartition
       UNION
       SELECT DISTINCT k.confrelid::regclass::text
         FROM pg_constraint k
         JOIN pg_class r ON r.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE k.contype = 'f' AND n.nspname = 'crm'
       ORDER BY 1`,
    );
    // Lo de fuera va con su esquema delante para que no choque con nada.
    return filas.map((f) => (f.tabla.includes('.') ? f.tabla : `public.${f.tabla}`));
  }

  private async columnas(q: (sql: string, p?: any[]) => Promise<any[]>, tabla: string): Promise<Columna[]> {
    return q(
      `SELECT attname AS nombre, format_type(atttypid, atttypmod) AS tipo
         FROM pg_attribute
        WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`,
      [tabla],
    );
  }

  /** El orden de las filas: la clave primaria, para que el archivo sea estable. */
  private async orden(q: (sql: string, p?: any[]) => Promise<any[]>, tabla: string, columnas: Columna[]) {
    const pk = await q(
      `SELECT a.attname AS nombre
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)`,
      [tabla],
    );
    const lista = pk.length ? pk.map((c) => c.nombre) : columnas.map((c) => c.nombre);
    return lista.map((c) => `${ident(c)}::text`).join(', ');
  }

  /**
   * La exportación completa, como ZIP.
   *
   * **Todo se lee en una sola foto** (`REPEATABLE READ`, de sólo lectura). Si
   * cada tabla se leyera por su cuenta, alguien que crea una oportunidad a
   * mitad de la exportación dejaría el archivo con una tarea que apunta a una
   * oportunidad que no está en él. La foto también garantiza que las filas
   * del manifiesto son las de ese instante.
   */
  async exportar(por: string) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    const q = (sql: string, p?: any[]) => qr.query(sql, p);
    const zip = new JSZip();
    const tablas: TablaExportada[] = [];
    let esquema: string | null = null;
    try {
      await qr.startTransaction('REPEATABLE READ');
      await q('SET TRANSACTION READ ONLY');
      // Fechas en UTC y en el formato de Postgres: el mismo dato da el mismo
      // texto, venga de donde venga la conexión.
      await q(`SET LOCAL TimeZone = 'UTC'`);
      await q(`SET LOCAL DateStyle = 'ISO, YMD'`);
      await q(`SET LOCAL extra_float_digits = 3`);

      for (const tabla of await this.tablas(q)) {
        const todas = await this.columnas(q, tabla);
        const omitidas = todas
          .map((c) => ({ columna: c.nombre, motivo: motivoParaOmitir(c.nombre, c.tipo) }))
          .filter((o): o is { columna: string; motivo: string } => o.motivo !== null);
        const columnas = todas.filter((c) => !omitidas.some((o) => o.columna === c.nombre));
        const filas: { v: (string | null)[] }[] = columnas.length
          ? await q(
              `SELECT ARRAY[${columnas.map((c) => `${ident(c.nombre)}::text`).join(', ')}] AS v
                 FROM ${tabla} ORDER BY ${await this.orden(q, tabla, columnas)}`,
            )
          : [];
        const contenido = Buffer.from(csv(columnas.map((c) => c.nombre), filas.map((f) => f.v)), 'utf8');
        const archivo = archivoDe(tabla);
        zip.file(archivo, contenido);
        tablas.push({
          tabla,
          archivo,
          filas: filas.length,
          columnas: columnas.map((c) => c.nombre),
          omitidas,
          sha256: sha256(contenido),
        });
      }
      const [m] = await q(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`).catch(() => []);
      esquema = m?.name ?? null;
      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction().catch(() => undefined);
      throw e;
    } finally {
      await qr.release();
    }

    const manifiesto: Manifiesto = {
      formato: VERSION_FORMATO,
      generado_en: new Date().toISOString(),
      por,
      esquema,
      tablas,
      total_filas: tablas.reduce((s, t) => s + t.filas, 0),
    };
    zip.file('manifiesto.json', JSON.stringify(manifiesto, null, 2));
    zip.file('LEEME.txt', LEEME);
    const archivo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const huella = sha256(archivo);

    const [fila] = await this.dataSource.query(
      `INSERT INTO crm.exportacion (por, tablas, filas, bytes, sha256, manifiesto)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [por, tablas.length, manifiesto.total_filas, archivo.length, huella, JSON.stringify(manifiesto)],
    );
    this.log.log(
      `Exportación ${fila.id} por ${por}: ${tablas.length} tablas, ${manifiesto.total_filas} filas, ${archivo.length} bytes`,
    );
    const fecha = manifiesto.generado_en.slice(0, 10);
    return { archivo, nombre: `friday-crm-${fecha}-${fila.id}.zip`, sha256: huella };
  }

  /**
   * Comprobar un ZIP: que esté entero según su manifiesto y si salió de aquí.
   *
   * Las dos cosas son distintas. Un ZIP puede estar intacto y no haber salido
   * de este CRM (otro entorno, otra copia), y puede haber salido de aquí y
   * haber sido tocado después. Se dicen por separado.
   */
  async verificarZip(contenido: Buffer) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(contenido);
    } catch {
      throw new BadRequestException('Eso no es un ZIP.');
    }
    const texto = await zip.file('manifiesto.json')?.async('string');
    if (!texto) throw new BadRequestException('El ZIP no trae manifiesto.json: no es una exportación del CRM.');
    let manifiesto: Manifiesto;
    try {
      manifiesto = JSON.parse(texto);
    } catch {
      throw new BadRequestException('El manifiesto.json está dañado.');
    }

    const archivos = new Map<string, Buffer>();
    for (const [nombre, f] of Object.entries(zip.files)) {
      if (!f.dir && nombre.startsWith('tablas/')) archivos.set(nombre, await f.async('nodebuffer'));
    }
    const resultado = verificar(manifiesto, archivos);

    /**
     * El manifiesto del ZIP lo puede reescribir cualquiera que tenga el
     * archivo: cambiar una fila y poner la huella nueva deja el ZIP
     * «coherente». Lo que no puede reescribir es la copia que se guardó aquí al
     * exportar. Se busca por fecha y autor —no por la huella del ZIP, que
     * cambia con sólo volver a comprimirlo— y se comparan las huellas tabla a
     * tabla.
     */
    const [registrada] = await this.dataSource.query(
      `SELECT id, por, en, manifiesto FROM crm.exportacion
        WHERE manifiesto->>'generado_en' = $1 AND por = $2
        ORDER BY id LIMIT 1`,
      [manifiesto.generado_en ?? '', manifiesto.por ?? ''],
    );
    if (registrada) {
      const huellas = (m: Manifiesto) =>
        JSON.stringify((m.tablas ?? []).map((t) => [t.archivo, t.sha256, t.filas]));
      if (huellas(registrada.manifiesto) !== huellas(manifiesto)) {
        resultado.valido = false;
        resultado.problemas.unshift(
          `El manifiesto no es el que se registró en la exportación #${registrada.id}: alguien lo cambió.`,
        );
      }
    }
    return {
      ...resultado,
      generado_en: manifiesto.generado_en,
      por: manifiesto.por,
      esquema: manifiesto.esquema,
      // `null`: no consta que haya salido de este CRM (otro entorno, u otra base).
      registrada: registrada ? { id: registrada.id, por: registrada.por, en: registrada.en } : null,
    };
  }

  historial() {
    return this.dataSource.query(
      `SELECT id, por, en, tablas, filas, bytes, sha256 FROM crm.exportacion ORDER BY en DESC LIMIT 50`,
    );
  }
}

/** Un identificador de Postgres entre comillas, por si una columna se llama `user`. */
function ident(nombre: string): string {
  return `"${nombre.replace(/"/g, '""')}"`;
}
