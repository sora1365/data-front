import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ALIAS, FILTRO_FIJO, RECURSOS, Recurso } from './crm-recursos';
import { CrmService } from './crm.service';

export interface ConsultaLista {
  filter?: string;
  sort?: string;
  range?: string;
}

/** Columnas de `crm.oportunidad` que no se llaman como el campo que expone. */
const COLUMNA_REAL_DEALS: Record<string, string> = {
  category: 'producto',
  stage: 'etapa',
  amount: 'monto',
  sales_id: 'comercial',
  index: 'indice',
  created_at: 'creada_en',
  updated_at: 'actualizada_en',
  archived_at: 'archivada_en',
  expected_closing_date: 'cierre_estimado',
};

const COLUMNA_REAL_SALES: Record<string, string> = { id: 'usuario' };

/**
 * El padrón se lee del perfil comercial, cuyas columnas están en español. Sin
 * este mapa, ordenar por `name` falla: `name` es el alias del SELECT y el
 * ORDER BY se evalúa sobre la tabla, donde la columna se llama `nombre`.
 */
const COLUMNA_REAL_PADRON: Record<string, string> = {
  id: 'clave',
  name: 'nombre',
  tax_identifier: 'ruc',
  sector: 'actividad',
  address: 'direccion',
  city: 'canton',
  state_abbr: 'provincia',
};

/**
 * El API que consumen las pantallas del CRM.
 *
 * Habla el dialecto de react-admin —`filter`, `sort`, `range` y un total— y lo
 * traduce a SQL sobre las tablas de FRIDAY. Es genérico a propósito: ocho
 * recursos que sólo se diferencian en la tabla no merecen ocho controladores
 * que se desincronizan en cuanto se arregla un detalle en uno.
 *
 * **Nada de lo que llega del cliente entra en la consulta sin comprobarse.**
 * El recurso, el campo por el que ordena y cada campo por el que filtra se
 * buscan en la lista blanca de `crm-recursos.ts`; los valores sí van como
 * parámetros. Un nombre de columna no puede ir parametrizado, así que la lista
 * blanca es lo único que separa esto de una inyección.
 */
@Injectable()
export class CrmRestService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crm: CrmService,
  ) {}

  private definicion(recurso: string): Recurso {
    const def = RECURSOS[recurso];
    if (!def) throw new NotFoundException(`El CRM no conoce el recurso «${recurso}»`);
    return def;
  }

  private columnaReal(recurso: string, campo: string): string {
    if (recurso === 'deals') return COLUMNA_REAL_DEALS[campo] ?? campo;
    if (recurso === 'sales') return COLUMNA_REAL_SALES[campo] ?? campo;
    if (recurso === 'padron') return COLUMNA_REAL_PADRON[campo] ?? campo;
    return campo;
  }

  private alias(recurso: string): string {
    return ALIAS[recurso] ?? 't';
  }

  async getList(recurso: string, consulta: ConsultaLista) {
    const def = this.definicion(recurso);
    const alias = this.alias(recurso);
    const params: any[] = [];
    const where: string[] = [];

    if (FILTRO_FIJO[recurso]) where.push(FILTRO_FIJO[recurso]);

    const filtro = this.parsear(consulta.filter, {});
    for (const [campo, valor] of Object.entries(filtro)) {
      if (valor === undefined || valor === null || valor === '') continue;

      // Búsqueda libre: la caja de buscar de cada lista.
      if (campo === 'q') {
        if (!def.busqueda?.length) continue;
        params.push(`%${String(valor)}%`);
        const i = params.length;
        where.push(
          `(${def.busqueda
            .map((c) => `${alias}.${this.columnaReal(recurso, c)} ILIKE $${i}`)
            .join(' OR ')})`,
        );
        continue;
      }

      // `campo@operador`, como lo manda react-admin con el adaptador de
      // Supabase que Atomic ya trae.
      const [nombre, operador] = campo.split('@');
      if (!def.columnas.includes(nombre)) {
        throw new BadRequestException(`«${nombre}» no es un campo de ${recurso}`);
      }
      const columna = `${alias}.${this.columnaReal(recurso, nombre)}`;

      /**
       * El id de un sujeto del padrón es `tipo:clave`, no una columna: es la
       * única clave compuesta que queda, porque el perfil comercial identifica
       * así a sus 7,1 millones de filas.
       */
      if (recurso === 'padron' && nombre === 'id') {
        const lista = Array.isArray(valor) ? valor : [valor];
        params.push(lista.map(String));
        where.push(`(${alias}.tipo_sujeto || ':' || ${alias}.clave) = ANY($${params.length})`);
        continue;
      }

      if (Array.isArray(valor)) {
        params.push(valor);
        where.push(`${columna} = ANY($${params.length})`);
        continue;
      }

      switch (operador) {
        case 'gte':
          params.push(valor);
          where.push(`${columna} >= $${params.length}`);
          break;
        case 'lte':
          params.push(valor);
          where.push(`${columna} <= $${params.length}`);
          break;
        case 'neq':
          params.push(valor);
          where.push(`${columna} <> $${params.length}`);
          break;
        case 'ilike':
          params.push(`%${valor}%`);
          where.push(`${columna} ILIKE $${params.length}`);
          break;
        case 'is':
          // `is: null` es cómo react-admin pregunta por lo que está vacío, y
          // `= NULL` nunca es cierto.
          where.push(valor === null ? `${columna} IS NULL` : `${columna} IS NOT NULL`);
          break;
        default:
          params.push(valor);
          where.push(`${columna} = $${params.length}`);
      }
    }

    const [campoOrden, sentido] = this.parsear(consulta.sort, [def.orden, 'ASC']) as [
      string,
      string,
    ];
    if (!def.columnas.includes(campoOrden)) {
      throw new BadRequestException(`No se puede ordenar ${recurso} por «${campoOrden}»`);
    }
    const direccion = String(sentido).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const [desde, hasta] = this.parsear(consulta.range, [0, 24]) as [number, number];
    const limite = Math.min(Math.max(Number(hasta) - Number(desde) + 1, 1), 1000);
    const salto = Math.max(Number(desde), 0);

    const sql = `
      SELECT ${def.select ?? `${alias}.*`}
        FROM ${def.tabla} ${alias}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${alias}.${this.columnaReal(recurso, campoOrden)} ${direccion} NULLS LAST
       LIMIT ${limite} OFFSET ${salto}
    `;
    const datos = await this.dataSource.query(sql, params);

    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM ${def.tabla} ${alias}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      params,
    );

    return { data: datos, total };
  }

  async getOne(recurso: string, id: string) {
    const def = this.definicion(recurso);
    const alias = this.alias(recurso);
    const clave = recurso === 'padron' ? null : this.columnaReal(recurso, 'id');

    // Los sujetos del padrón tienen clave compuesta: el id es `tipo:clave`.
    if (recurso === 'padron') {
      const [tipo, valor] = String(id).split(':');
      const filas = await this.dataSource.query(
        `SELECT ${def.select} FROM ${def.tabla} ${alias}
          WHERE ${alias}.tipo_sujeto = $1 AND ${alias}.clave = $2`,
        [tipo, valor],
      );
      if (!filas[0]) throw new NotFoundException(`No existe el sujeto ${id} en el padrón`);
      return filas[0];
    }

    const filas = await this.dataSource.query(
      `SELECT ${def.select ?? `${alias}.*`} FROM ${def.tabla} ${alias}
        WHERE ${alias}.${clave} = $1
        ${FILTRO_FIJO[recurso] ? `AND ${FILTRO_FIJO[recurso]}` : ''}`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe ${recurso} ${id}`);
    return filas[0];
  }

  async create(recurso: string, cuerpo: Record<string, any>, usuario: string) {
    const def = this.definicion(recurso);
    if (def.soloLectura) {
      throw new BadRequestException(
        `Las empresas vienen de la base de FRIDAY y no se crean desde el CRM.`,
      );
    }

    const columnas: string[] = [];
    const valores: any[] = [];
    for (const campo of def.escribibles) {
      if (cuerpo[campo] === undefined) continue;
      columnas.push(this.columnaReal(recurso, campo));
      valores.push(cuerpo[campo]);
    }

    // Quién lo creó. La columna se llama distinto según el género de la cosa
    // creada —una oportunidad es «creada», un contacto «creado»—, que es la
    // pega de tener el esquema en español y el API en inglés.
    const COLUMNA_AUTOR: Record<string, string> = {
      deals: 'creada_por',
      contacts: 'creado_por',
      companies: 'creado_por',
    };
    if (COLUMNA_AUTOR[recurso]) {
      columnas.push(COLUMNA_AUTOR[recurso]);
      valores.push(usuario);
    }

    if (columnas.length === 0) {
      throw new BadRequestException('No hay nada que guardar.');
    }

    const marcadores = valores.map((_, i) => `$${i + 1}`).join(', ');
    const res = await this.dataSource.query(
      `INSERT INTO ${def.tabla} (${columnas.join(', ')}) VALUES (${marcadores})
       RETURNING ${recurso === 'sales' ? 'usuario AS id' : 'id'}`,
      valores,
    );
    const creado = Array.isArray(res[0]) ? res[0][0] : res[0];
    return this.getOne(recurso, creado.id);
  }

  async update(recurso: string, id: string, cuerpo: Record<string, any>, usuario: string) {
    const def = this.definicion(recurso);
    if (def.soloLectura) {
      throw new BadRequestException(
        `Las empresas vienen de la base de FRIDAY y no se editan desde el CRM.`,
      );
    }

    const sets: string[] = [];
    const valores: any[] = [];
    for (const campo of def.escribibles) {
      if (cuerpo[campo] === undefined) continue;
      valores.push(cuerpo[campo]);
      sets.push(`${this.columnaReal(recurso, campo)} = $${valores.length}`);
    }
    if (sets.length === 0) return this.getOne(recurso, id);

    if (recurso === 'deals') {
      sets.push('actualizada_en = now()');

      /**
       * Mover una tarjeta de columna en el CRM es un `PUT` sobre `stage`, y
       * eso tiene consecuencias fuera del CRM: ganar una venta marca al
       * cliente como tal en el gestor comercial y crea la fila que el módulo
       * contable factura.
       *
       * Esa lógica vive en `CrmService.moverEtapa` y se delega ahí en vez de
       * repetirla: con dos copias, arrastrar una tarjeta y usar el endpoint
       * antiguo harían cosas distintas, y nadie se enteraría hasta que
       * faltara una factura.
       */
      if (cuerpo.stage !== undefined) {
        const actual = (
          await this.dataSource.query(`SELECT etapa FROM crm.oportunidad WHERE id = $1`, [id])
        )[0];
        if (actual && actual.etapa !== cuerpo.stage) {
          await this.crm.moverEtapa(
            Number(id),
            String(cuerpo.stage),
            cuerpo.index !== undefined ? Number(cuerpo.index) : null,
            usuario,
          );
          // `moverEtapa` ya guardó la etapa y el índice; aquí sólo queda el
          // resto de campos que viniera en el mismo cuerpo.
          const sinEtapa = sets.filter((s) => !/^(etapa|indice) =/.test(s));
          if (sinEtapa.length <= 1) return this.getOne(recurso, id);
        }
      }

      // Desarchivar devuelve la oportunidad al tablero, y tiene que entrar al
      // final de su columna: el índice que tenía cuando se archivó ya es de
      // otra, y dos tarjetas con el mismo índice se ordenan como quiera la
      // consulta, distinto en cada recarga.
      if (cuerpo.archived_at === null) {
        const etapa = (
          await this.dataSource.query(`SELECT etapa FROM crm.oportunidad WHERE id = $1`, [id])
        )[0]?.etapa;
        if (etapa) {
          const [{ siguiente }] = await this.dataSource.query(
            `SELECT coalesce(max(indice), -1) + 1 AS siguiente
               FROM crm.oportunidad WHERE etapa = $1 AND archivada_en IS NULL`,
            [etapa],
          );
          valores.push(siguiente);
          sets.push(`indice = $${valores.length}`);
        }
      }
    }

    valores.push(id);
    await this.dataSource.query(
      `UPDATE ${def.tabla} SET ${sets.join(', ')}
        WHERE ${this.columnaReal(recurso, 'id')} = $${valores.length}`,
      valores,
    );
    return this.getOne(recurso, id);
  }

  async remove(recurso: string, id: string) {
    const def = this.definicion(recurso);
    if (def.soloLectura) {
      throw new BadRequestException(`Las empresas no se borran desde el CRM.`);
    }
    const registro = await this.getOne(recurso, id);
    await this.dataSource.query(
      `DELETE FROM ${def.tabla} WHERE ${this.columnaReal(recurso, 'id')} = $1`,
      [id],
    );
    return registro;
  }

  /** `filter`, `sort` y `range` llegan como JSON en la cadena de consulta. */
  private parsear<T>(crudo: string | undefined, porDefecto: T): T {
    if (!crudo) return porDefecto;
    try {
      return JSON.parse(crudo) as T;
    } catch {
      throw new BadRequestException(`No se pudo leer el parámetro: ${crudo}`);
    }
  }
}
