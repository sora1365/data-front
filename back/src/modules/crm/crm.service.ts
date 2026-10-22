import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SegmentosService } from '../segmentos/segmentos.service';
import {
  EstadoVenta,
  estadoAlAbrir,
  estadoTrasEtapa,
  puedeDesgalardonar,
  puedePasarA,
  repartirEnColumnas,
} from './crm.reglas';

/**
 * Filas de un resultado de TypeORM.
 *
 * En un SELECT, `query` devuelve el array de filas; en un INSERT o un UPDATE
 * —aunque lleven RETURNING— devuelve `[filas, afectadas]`. Sin normalizarlo,
 * `res[0]` es el array entero en un caso y la primera fila en el otro.
 */
function filasDe(res: unknown): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as any[]);
}

/**
 * Columnas del perfil que se devuelven junto a cada oportunidad.
 *
 * El CRM no guarda ni el nombre ni el RUC del cliente: los lee del perfil en
 * cada consulta. Es una vista materializada con índice único por
 * `(tipo_sujeto, clave)`, así que el cruce es una búsqueda por índice y no
 * compensa desnormalizar; a cambio, cuando una importación corrige un nombre,
 * el CRM lo muestra corregido sin que nadie sincronice nada.
 */
const CAMPOS_SUJETO = `
  p.nombre, p.ruc, p.expediente, p.actividad, p.provincia, p.canton,
  p.situacion_legal, p.telefono, p.correo, p.ingresos_ult, p.anio_ult
`;

export interface AbrirOportunidad {
  tipoSujeto: string;
  clave: string;
  producto: string;
  marca: string;
  monto?: number | null;
  comercial?: string | null;
  origenSegmento?: string | null;
  origenLead?: number | null;
  cierreEstimado?: string | null;
  etapa?: string | null;
}

@Injectable()
export class CrmService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly segmentos: SegmentosService,
  ) {}

  // ------------------------------------------------------------------ catálogos

  /** Lo que necesita la pantalla para pintar los desplegables y las columnas. */
  async catalogos() {
    const [marcas, etapas, comerciales, etiquetas] = await Promise.all([
      this.dataSource.query(
        `SELECT codigo, nombre FROM crm.marca WHERE activo ORDER BY orden, nombre`,
      ),
      this.dataSource.query(
        `SELECT codigo, nombre, orden, es_ganada, es_perdida FROM crm.etapa ORDER BY orden`,
      ),
      this.dataSource.query(
        `SELECT usuario, first_name AS nombre FROM crm.comercial WHERE NOT disabled ORDER BY first_name`,
      ),
      this.dataSource.query(`SELECT id, name AS nombre, color FROM crm.etiqueta ORDER BY name`),
    ]);
    return { marcas, etapas, comerciales, etiquetas };
  }

  // -------------------------------------------------------------------- tablero

  /**
   * El tablero, ya agrupado por etapa.
   *
   * Se agrupa en el servidor y no en la pantalla porque las etapas vacías
   * también son columnas: si el front agrupara lo que recibe, un embudo sin
   * ninguna propuesta enviada se pintaría sin esa columna y parecería que la
   * etapa no existe.
   */
  async tablero(filtros: { comercial?: string; marca?: string; producto?: string } = {}) {
    const etapas = await this.dataSource.query(
      `SELECT codigo, nombre, orden, es_ganada, es_perdida FROM crm.etapa ORDER BY orden`,
    );

    const where: string[] = ['o.archivada_en IS NULL'];
    const params: any[] = [];
    if (filtros.comercial) {
      params.push(filtros.comercial);
      where.push(`o.comercial = $${params.length}`);
    }
    if (filtros.marca) {
      params.push(filtros.marca);
      where.push(`o.marca = $${params.length}`);
    }
    if (filtros.producto) {
      params.push(filtros.producto);
      where.push(`o.producto = $${params.length}`);
    }

    const oportunidades = await this.dataSource.query(
      `SELECT o.id, o.marca, o.tipo_sujeto, o.clave, o.producto, o.etapa, o.monto,
              o.comercial, o.origen_segmento, o.cierre_estimado, o.indice, o.creada_en,
              pr.nombre AS producto_nombre, m.nombre AS marca_nombre,
              ${CAMPOS_SUJETO}
         FROM crm.oportunidad o
         JOIN producto pr ON pr.codigo = o.producto
         JOIN crm.marca m ON m.codigo = o.marca
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = o.tipo_sujeto AND p.clave = o.clave
        WHERE ${where.join(' AND ')}
        ORDER BY o.indice, o.creada_en`,
      params,
    );

    const columnas = repartirEnColumnas(etapas, oportunidades);
    return etapas.map((e: any, i: number) => ({ ...e, ...columnas[i] }));
  }

  // -------------------------------------------------------------- oportunidades

  /** Ficha completa: la oportunidad, su sujeto y lo que se ha hecho con ella. */
  async oportunidad(id: number) {
    const filas = await this.dataSource.query(
      `SELECT o.*, pr.nombre AS producto_nombre, pr.unidad AS producto_unidad,
              m.nombre AS marca_nombre, e.nombre AS etapa_nombre,
              e.es_ganada, e.es_perdida, s.nombre AS segmento_nombre,
              ${CAMPOS_SUJETO}
         FROM crm.oportunidad o
         JOIN producto pr ON pr.codigo = o.producto
         JOIN crm.marca m ON m.codigo = o.marca
         JOIN crm.etapa e ON e.codigo = o.etapa
         LEFT JOIN segmento s ON s.codigo = o.origen_segmento
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = o.tipo_sujeto AND p.clave = o.clave
        WHERE o.id = $1`,
      [id],
    );
    if (filas.length === 0) throw new NotFoundException(`No existe la oportunidad ${id}`);
    const oportunidad = filas[0];

    const [contactos, interacciones, notas, tareas] = await Promise.all([
      this.dataSource.query(
        `SELECT id, first_name, last_name, title, email_jsonb, phone_jsonb,
                linkedin_url, principal
           FROM crm.contacto
          WHERE tipo_sujeto = $1 AND clave = $2
          ORDER BY principal DESC, first_name`,
        [oportunidad.tipo_sujeto, oportunidad.clave],
      ),
      this.dataSource.query(
        `SELECT id, canal, direccion, resultado, texto, ocurrido_en, autor
           FROM crm.interaccion WHERE oportunidad = $1 ORDER BY ocurrido_en DESC`,
        [id],
      ),
      this.dataSource.query(
        `SELECT id, text, status, date, sales_id
           FROM crm.nota WHERE deal_id = $1 ORDER BY date DESC`,
        [id],
      ),
      this.dataSource.query(
        `SELECT id, text, type, due_date, done_date, sales_id
           FROM crm.tarea WHERE deal_id = $1 ORDER BY done_date NULLS FIRST, due_date`,
        [id],
      ),
    ]);

    return { ...oportunidad, contactos, interacciones, notas, tareas };
  }

  /**
   * Abre una oportunidad sobre un sujeto.
   *
   * Aquí está el enganche con el gestor comercial, y es lo que evita que las
   * dos pantallas se contradigan:
   *
   * - **`no_contactar` manda.** Si alguien marcó que a ese sujeto no se le
   *   llama, no se abre la venta. Sin esto, la lista de trabajo lo esconde y el
   *   CRM lo trabaja igual.
   * - **Abrirla deja al sujeto `en_gestion`**, usando el mismo
   *   `marcarEstado` de segmentos y no una copia. Ese estado es el que saca al
   *   sujeto de la lista de trabajo de los demás; ponerlo a mano es lo que
   *   nadie hace, y por eso cinco unidades llaman al mismo prospecto.
   */
  async abrir(datos: AbrirOportunidad, usuario: string) {
    const estado = await this.estadoComercial(datos.tipoSujeto, datos.clave);
    if (estado?.estado === 'no_contactar') {
      throw new ConflictException(
        `Ese sujeto está marcado como «no contactar»${
          estado.nota ? `: ${estado.nota}` : ''
        }. Cambia su estado comercial antes de abrirle una oportunidad.`,
      );
    }

    const etapa =
      datos.etapa ??
      (
        await this.dataSource.query(
          `SELECT codigo FROM crm.etapa WHERE NOT es_ganada AND NOT es_perdida ORDER BY orden LIMIT 1`,
        )
      )[0]?.codigo;

    // Al final de su columna: una oportunidad nueva no se cuela por delante del
    // trabajo que ya estaba priorizado.
    const indice = await this.siguienteIndice(etapa);

    const comercial = datos.comercial ?? usuario;
    await this.asegurarComercial(comercial, comercial === usuario);

    let creada: any;
    try {
      const res = await this.dataSource.query(
        `INSERT INTO crm.oportunidad
           (marca, tipo_sujeto, clave, producto, etapa, monto, comercial,
            origen_segmento, origen_lead, cierre_estimado, indice, creada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          datos.marca,
          datos.tipoSujeto,
          datos.clave,
          datos.producto,
          etapa,
          datos.monto ?? null,
          comercial,
          datos.origenSegmento ?? null,
          datos.origenLead ?? null,
          datos.cierreEstimado ?? null,
          indice,
          usuario,
        ],
      );
      creada = filasDe(res)[0];
    } catch (e: any) {
      // El índice único parcial es la única forma fiable de evitar la carrera
      // entre dos comerciales abriendo lo mismo a la vez; aquí sólo se traduce
      // a un mensaje que diga qué pasó.
      if (e?.code === '23505' && String(e?.detail ?? '').includes('producto')) {
        throw new ConflictException(
          'Ese sujeto ya tiene una oportunidad abierta de ese producto. Trabájala o archívala antes de abrir otra.',
        );
      }
      throw e;
    }

    const nuevoEstado = estadoAlAbrir(estado?.estado ?? null);
    if (nuevoEstado) {
      await this.segmentos.marcarEstado(datos.tipoSujeto, datos.clave, nuevoEstado);
    }

    return this.oportunidad(creada.id);
  }

  /** Cambios sueltos de la ficha. La etapa va por su propio endpoint. */
  async editar(id: number, campos: Partial<AbrirOportunidad>) {
    const columnas: Record<string, any> = {
      monto: campos.monto,
      comercial: campos.comercial,
      cierre_estimado: campos.cierreEstimado,
      marca: campos.marca,
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [columna, valor] of Object.entries(columnas)) {
      if (valor === undefined) continue;
      params.push(valor);
      sets.push(`${columna} = $${params.length}`);
    }
    if (sets.length === 0) return this.oportunidad(id);

    params.push(id);
    await this.dataSource.query(
      `UPDATE crm.oportunidad SET ${sets.join(', ')}, actualizada_en = now()
        WHERE id = $${params.length}`,
      params,
    );
    return this.oportunidad(id);
  }

  /**
   * Mueve una oportunidad de etapa y, si toca, mueve el estado comercial.
   *
   * Ganarla deja al sujeto como `cliente`. Perderla **no** lo devuelve a nada:
   * se queda `en_gestion`, porque perder una venta no significa que el cliente
   * vuelva a estar libre —ahí sigue el historial de que se le habló— y porque
   * puede tener otras oportunidades abiertas.
   */
  async moverEtapa(id: number, etapa: string, indice: number | null, usuario: string) {
    const actual = (
      await this.dataSource.query(
        `SELECT tipo_sujeto, clave, etapa FROM crm.oportunidad WHERE id = $1`,
        [id],
      )
    )[0];
    if (!actual) throw new NotFoundException(`No existe la oportunidad ${id}`);

    const destino = (
      await this.dataSource.query(
        `SELECT codigo, es_ganada, es_perdida FROM crm.etapa WHERE codigo = $1`,
        [etapa],
      )
    )[0];
    if (!destino) throw new NotFoundException(`No existe la etapa «${etapa}»`);

    // Una venta ya facturada no se deshace arrastrando una tarjeta: existe un
    // documento con efectos tributarios y la corrección es una nota de crédito
    // en el contable.
    const venta = await this.ventaDe(id);
    if (venta && !destino.es_ganada && !puedeDesgalardonar(venta.estado)) {
      throw new ConflictException(
        `Esta venta ya está ${venta.estado === 'cobrada' ? 'cobrada' : 'facturada'}` +
          `${venta.documento ? ` con el documento ${venta.documento}` : ''}. ` +
          'Anúlala desde el módulo contable antes de sacarla de «ganada».',
      );
    }

    const posicion = indice ?? (await this.siguienteIndice(etapa));

    await this.dataSource.transaction(async (manager) => {
      // Hueco en el destino para la que llega. Sin esto, dos tarjetas comparten
      // índice y el orden del tablero depende del desempate de la consulta, que
      // cambia entre recargas.
      await manager.query(
        `UPDATE crm.oportunidad SET indice = indice + 1
          WHERE etapa = $1 AND indice >= $2 AND archivada_en IS NULL AND id <> $3`,
        [etapa, posicion, id],
      );
      await manager.query(
        `UPDATE crm.oportunidad SET etapa = $1, indice = $2, actualizada_en = now()
          WHERE id = $3`,
        [etapa, posicion, id],
      );
    });

    const estado = await this.estadoComercial(actual.tipo_sujeto, actual.clave);
    const nuevoEstado = estadoTrasEtapa(destino, estado?.estado ?? null);
    if (nuevoEstado) {
      await this.segmentos.marcarEstado(actual.tipo_sujeto, actual.clave, nuevoEstado);
    }

    // Ganar es lo que entrega la venta al módulo contable.
    if (destino.es_ganada) await this.registrarVenta(id, usuario);

    await this.registrarInteraccionDeEtapa(id, actual.etapa, etapa, usuario);
    return this.oportunidad(id);
  }

  // -------------------------------------------------- ventas: el paso al contable

  /**
   * Lo que el módulo contable tiene pendiente.
   *
   * Devuelve los datos congelados al ganar **y** los actuales del perfil. Si el
   * cliente cambió de dirección entre la venta y la emisión, quien factura
   * tiene que verlo antes de emitir, no descubrirlo cuando le devuelvan el
   * documento.
   */
  async ventas(filtros: { estado?: string; marca?: string } = {}) {
    const where: string[] = [];
    const params: any[] = [];
    if (filtros.estado) {
      params.push(filtros.estado);
      where.push(`v.estado = $${params.length}`);
    }
    if (filtros.marca) {
      params.push(filtros.marca);
      where.push(`v.marca = $${params.length}`);
    }

    return this.dataSource.query(
      `SELECT v.*, pr.nombre AS producto_nombre, m.nombre AS marca_nombre,
              p.nombre AS razon_social_actual, p.ruc AS ruc_actual,
              p.direccion AS direccion_actual, p.correo, p.telefono
         FROM crm.venta v
         JOIN producto pr ON pr.codigo = v.producto
         JOIN crm.marca m ON m.codigo = v.marca
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = v.tipo_sujeto AND p.clave = v.clave
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY v.ganada_en`,
      params,
    );
  }

  /** El contable marca lo que va haciendo con la venta. */
  async marcarVenta(
    id: number,
    destino: EstadoVenta,
    usuario: string,
    datos: { documento?: string; fecha?: string; nota?: string },
  ) {
    const venta = (await this.dataSource.query(`SELECT * FROM crm.venta WHERE id = $1`, [id]))[0];
    if (!venta) throw new NotFoundException(`No existe la venta ${id}`);

    if (!puedePasarA(venta.estado, destino)) {
      throw new ConflictException(
        `Una venta ${venta.estado} no puede pasar a ${destino}.`,
      );
    }

    const columnaFecha = {
      facturada: 'facturada_en',
      cobrada: 'cobrada_en',
      anulada: 'anulada_en',
      pendiente_facturacion: null,
    }[destino];

    await this.dataSource.query(
      `UPDATE crm.venta
          SET estado = $1,
              documento = coalesce($2, documento),
              nota = coalesce($3, nota),
              marcada_por = $4
              ${columnaFecha ? `, ${columnaFecha} = coalesce($5::timestamptz, now())` : ''}
        WHERE id = $6`,
      [destino, datos.documento ?? null, datos.nota ?? null, usuario, datos.fecha ?? null, id],
    );

    return (await this.dataSource.query(`SELECT * FROM crm.venta WHERE id = $1`, [id]))[0];
  }

  private async ventaDe(oportunidad: number) {
    const filas = await this.dataSource.query(
      `SELECT id, estado, documento FROM crm.venta WHERE oportunidad = $1`,
      [oportunidad],
    );
    return filas[0] ?? null;
  }

  /**
   * Crea la venta al ganar, congelando a quién se le vendió.
   *
   * Es idempotente: ganar una oportunidad que ya tenía venta no crea otra ni
   * reabre la que el contable ya facturó. Sin eso, mover la tarjeta a «ganada»
   * dos veces facturaría dos veces.
   */
  private async registrarVenta(oportunidad: number, usuario: string) {
    await this.dataSource.query(
      `INSERT INTO crm.venta
         (oportunidad, marca, tipo_sujeto, clave, producto, monto, comercial,
          ruc, razon_social, direccion, marcada_por)
       SELECT o.id, o.marca, o.tipo_sujeto, o.clave, o.producto, o.monto, o.comercial,
              p.ruc, p.nombre, p.direccion, $2
         FROM crm.oportunidad o
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = o.tipo_sujeto AND p.clave = o.clave
        WHERE o.id = $1
       ON CONFLICT (oportunidad) DO NOTHING`,
      [oportunidad, usuario],
    );
  }

  /** Sacarla del tablero sin borrar nada: el histórico es lo que se mide. */
  async archivar(id: number) {
    await this.dataSource.query(
      `UPDATE crm.oportunidad SET archivada_en = now(), actualizada_en = now() WHERE id = $1`,
      [id],
    );
    return this.oportunidad(id);
  }

  // -------------------------------------------------- frontera con el gestor

  /**
   * Qué ofrecerle a un sujeto, preguntándoselo al gestor comercial.
   *
   * Es la única pregunta que el CRM le hace al otro módulo, y pasa por aquí a
   * propósito: si la pantalla del CRM llamara directamente al API de segmentos,
   * la frontera entre los dos módulos estaría en dos sitios y cada uno se
   * enteraría de los cambios del otro por su cuenta.
   *
   * El gestor devuelve una fila por segmento **y** producto, así que el mismo
   * producto llega repetido cuando el sujeto cae en dos segmentos que lo
   * ofrecen, que es el caso normal. Se deduplica aquí, conservando el primero
   * —vienen ordenados por prioridad— y no en la pantalla, para que cualquiera
   * que consuma este endpoint reciba la lista ya limpia.
   */
  async sugerencias(tipoSujeto: string, clave: string) {
    const filas = await this.segmentos.productosPara(tipoSujeto, clave);
    const porCodigo = new Map<string, any>();
    for (const fila of filas ?? []) {
      if (!porCodigo.has(fila.codigo)) porCodigo.set(fila.codigo, fila);
    }
    return [...porCodigo.values()];
  }

  // -------------------------------------------------------------------- sujeto

  /** Todo lo que el CRM sabe de un sujeto, para la ficha de la compañía. */
  async porSujeto(tipoSujeto: string, clave: string) {
    const [oportunidades, contactos, estado] = await Promise.all([
      this.dataSource.query(
        `SELECT o.id, o.producto, o.etapa, o.monto, o.comercial, o.marca,
                o.archivada_en, o.creada_en,
                pr.nombre AS producto_nombre, e.nombre AS etapa_nombre,
                e.es_ganada, e.es_perdida
           FROM crm.oportunidad o
           JOIN producto pr ON pr.codigo = o.producto
           JOIN crm.etapa e ON e.codigo = o.etapa
          WHERE o.tipo_sujeto = $1 AND o.clave = $2
          ORDER BY o.archivada_en NULLS FIRST, o.creada_en DESC`,
        [tipoSujeto, clave],
      ),
      this.dataSource.query(
        `SELECT id, first_name, last_name, title, email_jsonb, phone_jsonb,
                linkedin_url, principal
           FROM crm.contacto WHERE tipo_sujeto = $1 AND clave = $2
          ORDER BY principal DESC, first_name`,
        [tipoSujeto, clave],
      ),
      this.estadoComercial(tipoSujeto, clave),
    ]);
    return { oportunidades, contactos, estado };
  }

  // ------------------------------------------------------------------- privado

  private async estadoComercial(tipoSujeto: string, clave: string) {
    const filas = await this.dataSource.query(
      `SELECT estado, nota FROM sujeto_estado_comercial WHERE tipo_sujeto = $1 AND clave = $2`,
      [tipoSujeto, clave],
    );
    return filas[0] ?? null;
  }

  /**
   * Da de alta al comercial la primera vez que firma algo.
   *
   * Mientras no haya autenticación no existe un alta previa de usuarios: la
   * lista de comerciales se forma con quien trabaja. Exigir que alguien los
   * registre antes convertiría la primera oportunidad de cada persona en un
   * error de clave foránea que no dice nada.
   *
   * Asignarle la venta a **otro** sí exige que exista: ahí el nombre lo escribe
   * quien reparte el trabajo, y un error de dedo crearía un comercial fantasma
   * con oportunidades que no vería nadie.
   */
  private async asegurarComercial(usuario: string, esQuienFirma: boolean) {
    if (esQuienFirma) {
      await this.dataSource.query(
        `INSERT INTO crm.comercial (usuario, first_name) VALUES ($1, $1)
         ON CONFLICT (usuario) DO NOTHING`,
        [usuario],
      );
      return;
    }
    const existe = await this.dataSource.query(
      `SELECT 1 FROM crm.comercial WHERE usuario = $1 AND NOT disabled`,
      [usuario],
    );
    if (existe.length === 0) {
      throw new NotFoundException(`No hay ningún comercial activo llamado «${usuario}».`);
    }
  }

  private async siguienteIndice(etapa: string): Promise<number> {
    const filas = await this.dataSource.query(
      `SELECT coalesce(max(indice), -1) + 1 AS siguiente
         FROM crm.oportunidad WHERE etapa = $1 AND archivada_en IS NULL`,
      [etapa],
    );
    return Number(filas[0]?.siguiente ?? 0);
  }

  /**
   * El cambio de etapa queda en el historial.
   *
   * Es la pregunta que se hace al mirar una venta parada —«¿desde cuándo lleva
   * aquí?»— y la única forma de responderla después es haberla escrito cuando
   * pasó. El canal es `sistema` para distinguirlo de lo que habló una persona.
   */
  private async registrarInteraccionDeEtapa(
    oportunidad: number,
    desde: string,
    hasta: string,
    usuario: string,
  ) {
    if (desde === hasta) return;
    await this.dataSource.query(
      `INSERT INTO crm.interaccion (canal, direccion, oportunidad, resultado, texto, autor)
       VALUES ('sistema', 'saliente', $1, 'cambio_etapa', $2, $3)`,
      [oportunidad, `De «${desde}» a «${hasta}»`, usuario],
    );
  }
}
