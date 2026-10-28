import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  agrupar,
  claveDeCorreo,
  claveDeEmpresa,
  claveDeNombre,
  claveDePar,
  claveDeRuc,
  claveDeTelefono,
  Par,
  rellenar,
  unir,
} from './duplicados.reglas';

export type Tipo = 'contacto' | 'empresa';
const TABLA: Record<Tipo, string> = { contacto: 'crm.contacto', empresa: 'crm.empresa' };

const JSONB = new Set(['email_jsonb', 'phone_jsonb', 'avatar', 'logo']);

/** La fecha más antigua o la más reciente, comparando instantes y no textos. */
function extremo(fechas: unknown[], cual: 'primero' | 'ultimo'): Date | null {
  const t = fechas.filter(Boolean).map((f) => new Date(f as string)).filter((d) => !isNaN(d.getTime()));
  if (!t.length) return null;
  return t.reduce((a, b) => ((cual === 'primero' ? b < a : b > a) ? b : a));
}

/** Cuántos pares se enseñan: más que eso no se revisa en una sentada. */
const MAX_PARES = 60;

interface Referencia {
  tabla: string;
  columna: string;
}

@Injectable()
export class DuplicadosService {
  private readonly log = new Logger('Duplicados');

  constructor(private readonly dataSource: DataSource) {}

  // ----------------------------------------------------------- encontrarlos

  async buscar() {
    const [contactos, empresas, excluidos] = await Promise.all([
      this.dataSource.query(
        `SELECT c.id::int AS id, c.first_name, c.last_name, c.title, c.email_jsonb, c.phone_jsonb,
                c.company_id::int AS company_id, e.name AS empresa
           FROM crm.contacto c LEFT JOIN crm.empresa e ON e.id = c.company_id`,
      ),
      this.dataSource.query(
        `SELECT id::int AS id, name, tax_identifier, city, sector, tipo_sujeto, clave FROM crm.empresa`,
      ),
      this.dataSource.query(`SELECT tipo, menor::int AS menor, mayor::int AS mayor FROM crm.no_duplicado`),
    ]);
    const fuera = (tipo: Tipo) =>
      new Set<string>(excluidos.filter((x: any) => x.tipo === tipo).map((x: any) => claveDePar(x.menor, x.mayor)));

    // El mismo nombre sólo cuenta dentro de la misma empresa o sin empresa:
    // dos «María López» de dos clientes distintos son dos personas.
    const paresContacto = agrupar(
      contactos,
      (c: any) => [
        ...(c.email_jsonb ?? []).map((x: any) => ({ motivo: 'correo' as const, clave: claveDeCorreo(x?.email) })),
        ...(c.phone_jsonb ?? []).map((x: any) => ({ motivo: 'telefono' as const, clave: claveDeTelefono(x?.number) })),
        {
          motivo: 'nombre' as const,
          clave: (() => {
            const n = claveDeNombre(c.first_name, c.last_name);
            return n ? `${c.company_id ?? '-'}|${n}` : null;
          })(),
        },
      ],
      fuera('contacto'),
    ).slice(0, MAX_PARES);

    const paresEmpresa = agrupar(
      empresas,
      (e: any) => [
        { motivo: 'ruc' as const, clave: claveDeRuc(e.tax_identifier) },
        { motivo: 'nombre' as const, clave: claveDeEmpresa(e.name) },
      ],
      fuera('empresa'),
    ).slice(0, MAX_PARES);

    const porId = (filas: any[]) => new Map<number, any>(filas.map((f) => [f.id, f]));
    return {
      contactos: await this.conDetalle('contacto', paresContacto, porId(contactos)),
      empresas: await this.conDetalle('empresa', paresEmpresa, porId(empresas)),
    };
  }

  /**
   * Cada par con lo que cuelga de cada ficha. Es lo que ayuda a elegir cuál
   * se queda: normalmente la que tiene la historia.
   */
  private async conDetalle(tipo: Tipo, pares: Par[], fichas: Map<number, any>) {
    const ids = [...new Set(pares.flatMap((p) => [p.a, p.b]))];
    const cuentas = await this.contar(this.dataSource.manager, tipo, ids);
    const ficha = (id: number) => {
      const f = fichas.get(id);
      if (tipo === 'contacto') {
        return {
          id,
          nombre: [f.first_name, f.last_name].filter(Boolean).join(' '),
          cargo: f.title,
          empresa: f.empresa,
          correos: (f.email_jsonb ?? []).map((x: any) => x.email).filter(Boolean),
          telefonos: (f.phone_jsonb ?? []).map((x: any) => x.number).filter(Boolean),
          relacionados: cuentas.get(id) ?? {},
        };
      }
      return {
        id,
        nombre: f.name,
        ruc: f.tax_identifier,
        ciudad: f.city,
        sector: f.sector,
        enlazada_al_padron: !!(f.tipo_sujeto && f.clave),
        relacionados: cuentas.get(id) ?? {},
      };
    };
    return pares.map((p) => ({ motivos: p.motivos, a: ficha(p.a), b: ficha(p.b) }));
  }

  // ---------------------------------------------------------------- fusionar

  /**
   * Juntar dos fichas en una.
   *
   * Todo en una transacción: o se mueve todo y desaparece el perdedor, o no
   * pasa nada. Atomic lo hacía desde el navegador con una petición por tarea,
   * por nota y por oportunidad; si una fallaba a medias, el cliente quedaba
   * repartido entre dos fichas de una forma que nadie sabría deshacer.
   *
   * El orden importa: primero se mueve lo que cuelga del perdedor —las notas y
   * las tareas se **borran** con el contacto si no se mueven antes—, luego se
   * borra, y al final se rellena el ganador (el perdedor puede tener el enlace
   * al padrón, que es único y no puede estar en las dos fichas a la vez).
   */
  async fusionar(tipo: Tipo, ganador: number, perdedor: number, autor: string) {
    this.validar(tipo);
    if (!ganador || !perdedor || ganador === perdedor) {
      throw new BadRequestException('Hacen falta dos fichas distintas.');
    }

    const resultado = await this.dataSource.transaction(async (m) => {
      const filas = await m.query(
        `SELECT * FROM ${TABLA[tipo]} WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
        [[ganador, perdedor]],
      );
      const g = filas.find((f: any) => Number(f.id) === ganador);
      const p = filas.find((f: any) => Number(f.id) === perdedor);
      if (!g || !p) throw new NotFoundException('Una de las dos fichas ya no existe. Recarga la lista.');

      if (tipo === 'empresa') await this.comprobarEmpresas(m, g, p);

      const movidos: Record<string, number> = {};
      for (const ref of await this.referencias(m, tipo)) {
        const res = await m.query(
          `UPDATE ${ref.tabla} SET ${ref.columna} = $1 WHERE ${ref.columna} = $2`,
          [ganador, perdedor],
        );
        const n = Number(Array.isArray(res) ? res[1] : 0);
        if (n) movidos[`${ref.tabla}.${ref.columna}`] = n;
      }
      if (tipo === 'contacto') {
        // `contact_ids` es un array, no una clave foránea: el catálogo no lo ve.
        const res = await m.query(
          `UPDATE crm.oportunidad
              SET contact_ids = (SELECT coalesce(array_agg(DISTINCT x), '{}') FROM unnest(array_replace(contact_ids, $2::bigint, $1::bigint)) x)
            WHERE $2::bigint = ANY(contact_ids)`,
          [ganador, perdedor],
        );
        const n = Number(Array.isArray(res) ? res[1] : 0);
        if (n) movidos['crm.oportunidad.contact_ids'] = n;
      }

      await m.query(`DELETE FROM ${TABLA[tipo]} WHERE id = $1`, [perdedor]);
      const cambios = tipo === 'contacto' ? this.juntarContactos(g, p) : this.juntarEmpresas(g, p);
      const columnas = Object.keys(cambios);
      if (columnas.length) {
        await m.query(
          `UPDATE ${TABLA[tipo]} SET ${columnas.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [ganador, ...columnas.map((c) => this.paraGuardar(c, (cambios as any)[c]))],
        );
      }

      await m.query(`DELETE FROM crm.no_duplicado WHERE tipo = $1 AND $2 IN (menor, mayor)`, [tipo, perdedor]);
      const [f] = await m.query(
        `INSERT INTO crm.fusion (tipo, ganador, perdedor, perdedor_datos, movidos, autor)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tipo, ganador, perdedor, JSON.stringify(p), JSON.stringify(movidos), autor],
      );
      return { fusion: Number(f.id), ganador, perdedor, movidos, completado: columnas };
    });

    this.log.log(`${tipo} ${perdedor} fusionado en ${ganador} por ${autor}: ${JSON.stringify(resultado.movidos)}`);
    return resultado;
  }

  /**
   * Lo que impide juntar dos empresas.
   *
   * - **Enlazadas a sujetos distintos del padrón**: son dos RUC, dos personas
   *   jurídicas. Se parecen en el nombre, pero no son la misma.
   * - **Las dos con una oportunidad abierta del mismo producto**: juntarlas
   *   dejaría dos ventas vivas de lo mismo al mismo cliente, que es justo lo
   *   que el índice de oportunidad única impide. Se dice cuáles son para que
   *   alguien cierre o archive una antes.
   */
  private async comprobarEmpresas(m: EntityManager, g: any, p: any) {
    if (g.tipo_sujeto && p.tipo_sujeto && (g.tipo_sujeto !== p.tipo_sujeto || g.clave !== p.clave)) {
      throw new ConflictException(
        'Están enlazadas a contribuyentes distintos del padrón: son dos empresas, no una.',
      );
    }
    const choques = await m.query(
      `SELECT a.producto, a.id AS de_ganador, b.id AS de_perdedor
         FROM crm.oportunidad a
         JOIN crm.oportunidad b ON b.producto = a.producto
        WHERE a.company_id = $1 AND b.company_id = $2
          AND a.archivada_en IS NULL AND b.archivada_en IS NULL
          AND a.etapa NOT IN ('ganada','perdida') AND b.etapa NOT IN ('ganada','perdida')`,
      [g.id, p.id],
    );
    if (choques.length) {
      const lista = choques.map((c: any) => `${c.producto} (#${c.de_ganador} y #${c.de_perdedor})`).join(', ');
      throw new ConflictException(
        `Las dos tienen abierta una oportunidad del mismo producto: ${lista}. Cierra o archiva una antes de fusionar.`,
      );
    }
  }

  private juntarContactos(g: any, p: any) {
    const correo = (x: any) => (x?.email ? String(x.email).trim().toLowerCase() : null);
    const tel = (x: any) => (x?.number ? String(x.number).replace(/\D/g, '').slice(-9) || null : null);
    return {
      ...rellenar(g, p, ['title', 'linkedin_url', 'gender', 'background', 'company_id', 'sales_id', 'avatar', 'nota', 'status']),
      email_jsonb: unir(g.email_jsonb, p.email_jsonb, correo),
      phone_jsonb: unir(g.phone_jsonb, p.phone_jsonb, tel),
      tags: unir<number>(g.tags, p.tags, (x) => String(x)),
      first_seen: extremo([g.first_seen, p.first_seen], 'primero'),
      last_seen: extremo([g.last_seen, p.last_seen], 'ultimo'),
      has_newsletter: !!(g.has_newsletter || p.has_newsletter),
      principal: !!(g.principal || p.principal),
    };
  }

  private juntarEmpresas(g: any, p: any) {
    const cambios: Record<string, unknown> = rellenar(g, p, [
      'tax_identifier', 'sector', 'size', 'revenue', 'description', 'address', 'city',
      'state_abbr', 'zipcode', 'country', 'phone_number', 'website', 'linkedin_url', 'logo', 'sales_id',
    ]);
    // El enlace al padrón va entero o no va: un tipo sin clave no apunta a nada.
    if (!g.tipo_sujeto && p.tipo_sujeto) {
      cambios.tipo_sujeto = p.tipo_sujeto;
      cambios.clave = p.clave;
    }
    return cambios;
  }

  /**
   * Los `jsonb` van serializados por su nombre, no por su forma: una lista de
   * correos vacía es `[]` igual que unas etiquetas vacías, pero una es `jsonb`
   * y la otra un array de Postgres, y el driver convierte un array de
   * JavaScript en lo segundo.
   */
  private paraGuardar(columna: string, v: unknown) {
    return JSONB.has(columna) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  }

  // ----------------------------------------------------------------- piezas

  async noSon(tipo: Tipo, a: number, b: number, autor: string) {
    this.validar(tipo);
    if (!a || !b || a === b) throw new BadRequestException('Hacen falta dos fichas distintas.');
    await this.dataSource.query(
      `INSERT INTO crm.no_duplicado (tipo, menor, mayor, autor) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tipo, Math.min(a, b), Math.max(a, b), autor],
    );
    return { ok: true };
  }

  async historial() {
    return this.dataSource.query(
      `SELECT id, tipo, ganador, perdedor, movidos, autor, en,
              coalesce(perdedor_datos->>'name',
                       trim(coalesce(perdedor_datos->>'first_name','') || ' ' || coalesce(perdedor_datos->>'last_name',''))) AS perdedor_nombre
         FROM crm.fusion ORDER BY en DESC LIMIT 100`,
    );
  }

  /**
   * Las columnas que apuntan a contactos o empresas, sacadas del catálogo de
   * Postgres y no de una lista escrita aquí.
   *
   * Una lista escrita a mano se queda vieja el día que otro módulo añade una
   * tabla que apunta a contactos, y la fusión dejaría esas filas colgando del
   * perdedor —o las borraría con él—, sin que nada fallara. El catálogo no se
   * olvida de ninguna.
   */
  private async referencias(m: EntityManager, tipo: Tipo): Promise<Referencia[]> {
    return m.query(
      `SELECT c.conrelid::regclass::text AS tabla, quote_ident(a.attname) AS columna
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1
        ORDER BY 1, 2`,
      [TABLA[tipo]],
    );
  }

  /** Cuántas filas cuelgan de cada ficha, por tabla. */
  private async contar(m: EntityManager, tipo: Tipo, ids: number[]) {
    const cuentas = new Map<number, Record<string, number>>();
    if (!ids.length) return cuentas;
    const refs = await this.referencias(m, tipo);
    const consultas = refs.map(
      (r) =>
        `SELECT ${r.columna}::int AS id, '${r.tabla.replace(/^crm\./, '').replace(/'/g, '')}' AS tabla, count(*)::int AS n
           FROM ${r.tabla} WHERE ${r.columna} = ANY($1::bigint[]) GROUP BY 1`,
    );
    if (tipo === 'contacto') {
      consultas.push(
        `SELECT x::int AS id, 'oportunidad' AS tabla, count(*)::int AS n
           FROM crm.oportunidad, unnest(contact_ids) x WHERE x = ANY($1::bigint[]) GROUP BY 1`,
      );
    }
    const filas = await m.query(consultas.join(' UNION ALL '), [ids]);
    for (const f of filas) {
      const c = cuentas.get(f.id) ?? {};
      c[f.tabla] = (c[f.tabla] ?? 0) + f.n;
      cuentas.set(f.id, c);
    }
    return cuentas;
  }

  private validar(tipo: string): asserts tipo is Tipo {
    if (tipo !== 'contacto' && tipo !== 'empresa') {
      throw new BadRequestException('El tipo es contacto o empresa.');
    }
  }
}
