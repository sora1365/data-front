import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SegmentosService } from '../segmentos/segmentos.service';
import {
  accionSobreLaVenta,
  CANALES,
  EstadoVenta,
  estadoAlAbrir,
  estadoTrasEtapa,
  fechaDeInteraccionValida,
  puedeDesgalardonar,
  puedePasarA,
  repartirEnColumnas,
} from './crm.reglas';
import { SeguimientoService } from './seguimiento/seguimiento.service';

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
 * Un texto escrito por una persona, o `null` si no escribió nada.
 *
 * No usa `nullify` de `common/text`: ese está hecho para lo que llega en un
 * archivo de la Superintendencia, donde «N/A» significa vacío y los saltos de
 * línea son basura. Esto lo teclea alguien en un formulario, y colapsarle los
 * saltos de línea convertiría el resumen de una reunión en un párrafo.
 */
function textoONulo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === '' ? null : limpio;
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
  /** Opcional: si no llega, se usa el nombre del producto. */
  nombre?: string;
  /**
   * El cliente: o un sujeto del padrón, o una empresa que ya está en el CRM.
   * Un lead que convierte suele ser lo segundo —no tiene RUC en el padrón—, y
   * exigirle sujeto haría imposible venderle a quien llegó por la web.
   */
  tipoSujeto?: string;
  clave?: string;
  empresaId?: number;
  producto: string;
  marca: string;
  monto?: number | null;
  comercial?: string | null;
  origenSegmento?: string | null;
  origenLead?: number | null;
  cierreEstimado?: string | null;
  etapa?: string | null;
}

/** Una conversación que ya ocurrió, para anotarla en el historial. */
export interface RegistrarInteraccion {
  canal: string;
  direccion: string;
  /** Qué salió de ahí: «no contesta», «pidió propuesta», «lo ve en enero». */
  resultado?: string | null;
  texto?: string | null;
  /** Con quién se habló, cuando se sabe. Tiene que ser de este cliente. */
  contacto?: number | null;
  /** Cuándo fue. Si no llega, ahora: lo normal es anotar justo después. */
  ocurridoEn?: string | null;
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly segmentos: SegmentosService,
    private readonly seguimiento: SeguimientoService,
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
    // Los canales no son una tabla: son la lista blanca con la que el
    // controlador valida lo que llega. Viajan aquí para que el desplegable de
    // la ficha salga de la misma lista que decide si se acepta, y no de una
    // copia en el JavaScript que se olvidaría de actualizar el día que entre
    // un canal nuevo.
    return { marcas, etapas, comerciales, etiquetas, canales: CANALES };
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
      `SELECT o.id, o.marca, o.company_id, emp.tipo_sujeto, emp.clave, emp.name AS empresa,
              o.producto, o.etapa, o.monto,
              o.comercial, o.origen_segmento, o.cierre_estimado, o.indice, o.creada_en,
              pr.nombre AS producto_nombre, m.nombre AS marca_nombre,
              ${CAMPOS_SUJETO}
         FROM crm.oportunidad o
         JOIN crm.empresa emp ON emp.id = o.company_id
         JOIN producto pr ON pr.codigo = o.producto
         JOIN crm.marca m ON m.codigo = o.marca
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = emp.tipo_sujeto AND p.clave = emp.clave
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
      `SELECT o.*, emp.tipo_sujeto, emp.clave, emp.name AS empresa,
              pr.nombre AS producto_nombre, pr.unidad AS producto_unidad,
              m.nombre AS marca_nombre, e.nombre AS etapa_nombre,
              e.es_ganada, e.es_perdida, s.nombre AS segmento_nombre,
              ${CAMPOS_SUJETO}
         FROM crm.oportunidad o
         JOIN crm.empresa emp ON emp.id = o.company_id
         JOIN producto pr ON pr.codigo = o.producto
         JOIN crm.marca m ON m.codigo = o.marca
         JOIN crm.etapa e ON e.codigo = o.etapa
         LEFT JOIN segmento s ON s.codigo = o.origen_segmento
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = emp.tipo_sujeto AND p.clave = emp.clave
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
          WHERE company_id = $1
          ORDER BY principal DESC, first_name`,
        [oportunidad.company_id],
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
    // La empresa se busca —o se crea desde el padrón— antes de nada: el sujeto
    // ya no vive en la oportunidad, y es la empresa la que sabe si hay uno.
    const empresa = await this.empresaParaAbrir(datos, usuario);

    // Las reglas del gestor comercial sólo aplican a quien está en el padrón:
    // una empresa sin sujeto no tiene estado comercial que respetar ni mover.
    const estado = empresa.tipo_sujeto
      ? await this.estadoComercial(empresa.tipo_sujeto, empresa.clave)
      : null;
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
           (marca, company_id, name, producto, etapa, monto, comercial,
            origen_segmento, origen_lead, cierre_estimado, indice, creada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          datos.marca,
          empresa.id,
          // Atomic muestra el nombre de la oportunidad en cada tarjeta, y una
          // abierta desde el gestor no lo trae: el producto es lo que se está
          // vendiendo, así que sirve de nombre hasta que alguien lo cambie.
          datos.nombre ?? (await this.nombreDeProducto(datos.producto)),
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

    // El primer asiento del recorrido: en qué etapa nació. Sin él, una
    // oportunidad que nunca se movió no aparecería en el embudo, y el primer
    // tramo de las que sí se movieron mediría desde la nada.
    await this.dataSource.query(
      `INSERT INTO crm.oportunidad_etapa (oportunidad, desde, hasta, autor, ocurrido_en)
       VALUES ($1, NULL, $2, $3, now())`,
      [creada.id, etapa, usuario],
    );

    const nuevoEstado = empresa.tipo_sujeto ? estadoAlAbrir(estado?.estado ?? null) : null;
    if (nuevoEstado) {
      await this.segmentos.marcarEstado(empresa.tipo_sujeto, empresa.clave, nuevoEstado);
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
        `SELECT emp.tipo_sujeto, emp.clave, o.etapa, o.company_id
           FROM crm.oportunidad o JOIN crm.empresa emp ON emp.id = o.company_id
          WHERE o.id = $1`,
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

    // Ganar es lo que entrega la venta al módulo contable, y deshacerlo la
    // retira: una venta viva colgando de un trato que ya no está ganado es
    // dinero que el contable tiene pendiente de facturar y que el cuadro de
    // comisiones sigue contando como comisión en camino.
    const accion = accionSobreLaVenta(venta?.estado ?? null, destino.es_ganada);
    if (accion === 'registrar') await this.registrarVenta(id, usuario);
    if (accion === 'anular') await this.anularVenta(id, usuario, actual.etapa);

    await this.registrarInteraccionDeEtapa(id, actual.etapa, etapa, usuario);

    // El seguimiento va detrás de todo lo demás y no puede tumbar el
    // movimiento: que una secuencia no arranque —o que ya estuviera en
    // marcha— no es razón para que la venta se quede en la etapa anterior.
    //
    // Sólo si cambió de etapa: reordenar la tarjeta dentro de su columna no es
    // «entrar» en ella, y volvería a arrancar un plan que ya terminó.
    if (actual.etapa !== etapa) {
      try {
        await this.seguimiento.cortarPorEtapa(id, destino);
        await this.seguimiento.dispararPorEtapa(id, etapa, usuario);
      } catch (e) {
        this.logger.error(`Seguimiento de la oportunidad ${id} al pasar a «${etapa}»`, e as Error);
      }
    }
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
      /**
       * Con las líneas de la proforma aceptada, cuando la hubo.
       *
       * Es lo que convierte la entrega en algo facturable sin volver a
       * teclear nada: cantidades, descuentos y el IVA de cada producto, tal
       * como el cliente los aceptó. Sin esto, el contable recibe un importe
       * suelto y la factura se arma a mano, que es donde deja de cuadrar con
       * la oferta.
       */
      `SELECT v.*, pr.nombre AS producto_nombre, m.nombre AS marca_nombre,
              p.nombre AS razon_social_actual, p.ruc AS ruc_actual,
              p.direccion AS direccion_actual, p.correo, p.telefono,
              pf.numero AS proforma_numero,
              pf.aceptada_por AS proforma_aceptada_por,
              pf.cerrada_en AS proforma_aceptada_en,
              pf.total::float8 AS proforma_total,
              coalesce(
                (SELECT json_agg(json_build_object(
                          'orden', l.orden, 'producto', l.producto,
                          'descripcion', l.descripcion,
                          'cantidad', l.cantidad::float8,
                          'precio_unitario', l.precio_unitario::float8,
                          'descuento_pct', l.descuento_pct::float8,
                          'iva_pct', l.iva_pct::float8)
                        ORDER BY l.orden)
                   FROM crm.proforma_linea l WHERE l.proforma = pf.id),
                '[]'::json
              ) AS lineas
         FROM crm.venta v
         LEFT JOIN crm.proforma pf ON pf.id = v.proforma
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
      // Los datos de facturación salen de la ficha de la empresa, no del
      // perfil: es la empresa la que el comercial corrigió si hacía falta, y
      // puede no estar en el padrón en absoluto.
      /**
       * Si hay una proforma aceptada, manda ella: su base imponible es lo que
       * el cliente aceptó por escrito, y sus datos son los que figuran en el
       * documento que recibió. El importe de la tarjeta es una estimación
       * interna que casi nunca se corrige después de cotizar.
       *
       * `monto` es la base sin IVA —subtotal menos descuentos—, que es sobre
       * lo que se calcula la comisión y lo que el contable usa de base para
       * facturar; el IVA lo recompone él desde las líneas.
       */
      `INSERT INTO crm.venta
         (oportunidad, marca, company_id, tipo_sujeto, clave, producto, monto, comercial,
          ruc, razon_social, direccion, marcada_por, proforma)
       SELECT o.id, o.marca, emp.id, emp.tipo_sujeto, emp.clave, o.producto,
              coalesce(p.subtotal - p.descuento, o.monto),
              o.comercial,
              coalesce(p.ruc, emp.tax_identifier),
              coalesce(p.razon_social, emp.name),
              coalesce(p.direccion, emp.address),
              $2,
              p.id
         FROM crm.oportunidad o
         JOIN crm.empresa emp ON emp.id = o.company_id
         LEFT JOIN LATERAL (
           SELECT * FROM crm.proforma pf
            WHERE pf.oportunidad = o.id AND pf.estado = 'aceptada'
            ORDER BY pf.cerrada_en DESC NULLS LAST
            LIMIT 1
         ) p ON true
        WHERE o.id = $1
       ON CONFLICT (oportunidad) DO UPDATE SET
         estado = 'pendiente_facturacion',
         anulada_en = NULL,
         ganada_en = now(),
         monto = EXCLUDED.monto,
         comercial = EXCLUDED.comercial,
         ruc = EXCLUDED.ruc,
         razon_social = EXCLUDED.razon_social,
         direccion = EXCLUDED.direccion,
         marcada_por = EXCLUDED.marcada_por,
         proforma = EXCLUDED.proforma
       WHERE crm.venta.anulada_en IS NOT NULL`,
      [oportunidad, usuario],
    );
  }

  /**
   * Retira del contable una venta que se deshizo.
   *
   * Se anula, no se borra: la entrega ocurrió, y borrar la fila haría
   * desaparecer de los dos lados algo que alguien pudo empezar a tramitar.
   * Anulada se ve, y se ve que se deshizo y desde qué etapa.
   *
   * Sólo toca lo pendiente de facturar; una facturada o cobrada ni siquiera
   * llega hasta aquí, porque el movimiento se rechaza antes.
   */
  private async anularVenta(oportunidad: number, usuario: string, etapaAnterior: string) {
    await this.dataSource.query(
      `UPDATE crm.venta
          SET estado = 'anulada', anulada_en = now(), marcada_por = $2,
              nota = coalesce(nota || ' · ', '') ||
                     'Anulada al sacar la oportunidad de «' || $3 || '»'
        WHERE oportunidad = $1 AND estado = 'pendiente_facturacion'`,
      [oportunidad, usuario, etapaAnterior],
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

  // --------------------------------------------------------------- historial

  /**
   * Anota a mano lo que pasó con el cliente.
   *
   * Hasta aquí el historial sólo se llenaba solo, con los cambios de etapa, y
   * eso contesta «desde cuándo está parada» pero no «qué dijo cuando se le
   * llamó». Esto es lo segundo: una llamada, un WhatsApp, una visita.
   *
   * Va a `crm.interaccion` y no a `crm.nota` aunque las dos guarden texto. Una
   * nota es lo que alguien escribe sobre la venta; una interacción es un
   * contacto que ocurrió, con canal, dirección y hora. Es la distinción que
   * permite preguntar por dónde entran las ventas y cuánto se tarda en
   * responder, y es la tabla en la que después caen WhatsApp y correo solos:
   * si las llamadas nacieran como notas habría que migrarlas el primer día de
   * la integración.
   */
  async registrarInteraccion(
    oportunidad: number,
    entrada: RegistrarInteraccion,
    usuario: string,
  ) {
    const ocurridoEn = entrada.ocurridoEn ? new Date(entrada.ocurridoEn) : new Date();
    if (Number.isNaN(ocurridoEn.getTime())) {
      throw new BadRequestException('La fecha de la interacción no se entiende.');
    }
    if (!fechaDeInteraccionValida(ocurridoEn, new Date())) {
      throw new BadRequestException(
        'Esa interacción está en el futuro. Lo que todavía no ha pasado es una tarea, no historial.',
      );
    }

    // La oportunidad se comprueba antes de insertar porque la alternativa es
    // que el 23503 de la clave foránea salga como un 500: el cliente recibiría
    // «error interno» cuando lo que pasó es que esa venta no existe.
    const suya = await this.dataSource.query(
      `SELECT company_id FROM crm.oportunidad WHERE id = $1`,
      [oportunidad],
    );
    if (suya.length === 0) {
      throw new NotFoundException(`No existe la oportunidad ${oportunidad}`);
    }

    // Un contacto de otra empresa en el historial de esta no da ningún error
    // —la columna sólo exige que el contacto exista— y deja la conversación
    // colgada del cliente equivocado, donde nadie la va a buscar.
    if (entrada.contacto != null) {
      const esDeEsteCliente = await this.dataSource.query(
        `SELECT 1 FROM crm.contacto WHERE id = $1 AND company_id = $2`,
        [entrada.contacto, suya[0].company_id],
      );
      if (esDeEsteCliente.length === 0) {
        throw new BadRequestException(
          'Ese contacto no es de este cliente: una conversación colgada de otra empresa no la encuentra nadie.',
        );
      }
    }

    // Quien anota firma, y si es su primera firma se da de alta solo: es la
    // misma regla que al abrir una oportunidad. Mientras no haya
    // autenticación, exigir un alta previa convertiría la primera llamada de
    // cada persona en un error de clave foránea.
    await this.asegurarComercial(usuario, true);

    await this.dataSource.query(
      `INSERT INTO crm.interaccion
         (canal, direccion, oportunidad, contacto, resultado, texto, ocurrido_en, autor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entrada.canal,
        entrada.direccion,
        oportunidad,
        entrada.contacto ?? null,
        textoONulo(entrada.resultado),
        textoONulo(entrada.texto),
        ocurridoEn,
        usuario,
      ],
    );

    return this.oportunidad(oportunidad);
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
           JOIN crm.empresa emp ON emp.id = o.company_id
           JOIN producto pr ON pr.codigo = o.producto
           JOIN crm.etapa e ON e.codigo = o.etapa
          WHERE emp.tipo_sujeto = $1 AND emp.clave = $2
          ORDER BY o.archivada_en NULLS FIRST, o.creada_en DESC`,
        [tipoSujeto, clave],
      ),
      this.dataSource.query(
        `SELECT c.id, c.first_name, c.last_name, c.title, c.email_jsonb, c.phone_jsonb,
                c.linkedin_url, c.principal
           FROM crm.contacto c
           JOIN crm.empresa emp ON emp.id = c.company_id
          WHERE emp.tipo_sujeto = $1 AND emp.clave = $2
          ORDER BY c.principal DESC, c.first_name`,
        [tipoSujeto, clave],
      ),
      this.estadoComercial(tipoSujeto, clave),
    ]);
    return { oportunidades, contactos, estado };
  }

  // ------------------------------------------------------------------- privado

  /**
   * La ficha de empresa de un sujeto del padrón, creándola si aún no existe.
   *
   * Es lo que hace que abrir una oportunidad desde el gestor comercial no
   * obligue a teclear nada: el sujeto ya tiene nombre, RUC, actividad y
   * dirección en el perfil, y de ahí sale la ficha. El índice único parcial
   * sobre `(tipo_sujeto, clave)` es lo que garantiza que dos comerciales
   * trabajando la misma lista no creen dos fichas del mismo cliente.
   */
  private async empresaDeSujeto(tipoSujeto: string, clave: string, usuario: string) {
    const existentes = await this.dataSource.query(
      `SELECT id, name FROM crm.empresa WHERE tipo_sujeto = $1 AND clave = $2`,
      [tipoSujeto, clave],
    );
    if (existentes[0]) return existentes[0];

    const res = await this.dataSource.query(
      `INSERT INTO crm.empresa (name, tax_identifier, sector, address, city, state_abbr,
                                country, phone_number, website, tipo_sujeto, clave, creado_por)
       SELECT coalesce(p.nombre, $2), p.ruc, p.actividad, p.direccion, p.canton,
              p.provincia, 'Ecuador', p.telefono, p.sitio_web, $1, $2, $3
         FROM (SELECT 1) uno
         LEFT JOIN perfil_comercial p
                ON p.tipo_sujeto = $1 AND p.clave = $2
       RETURNING id, name`,
      [tipoSujeto, clave, usuario],
    );
    return filasDe(res)[0];
  }

  /** La empresa sobre la que se abre: la indicada, o la del sujeto. */
  private async empresaParaAbrir(
    datos: AbrirOportunidad,
    usuario: string,
  ): Promise<{ id: number; tipo_sujeto: string | null; clave: string | null }> {
    if (datos.empresaId != null) {
      const filas = await this.dataSource.query(
        `SELECT id, tipo_sujeto, clave FROM crm.empresa WHERE id = $1`,
        [datos.empresaId],
      );
      if (!filas[0]) throw new NotFoundException(`No existe la empresa ${datos.empresaId}`);
      return filas[0];
    }
    if (!datos.tipoSujeto || !datos.clave) {
      throw new BadRequestException('Falta el cliente: una empresa del CRM o un sujeto del padrón.');
    }
    const empresa = await this.empresaDeSujeto(datos.tipoSujeto, datos.clave, usuario);
    return { id: empresa.id, tipo_sujeto: datos.tipoSujeto, clave: datos.clave };
  }

  private async nombreDeProducto(codigo: string): Promise<string> {
    const filas = await this.dataSource.query(
      `SELECT nombre FROM producto WHERE codigo = $1`,
      [codigo],
    );
    return filas[0]?.nombre ?? codigo;
  }

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

    // Y el mismo movimiento como datos, que es de donde sale el embudo. La
    // frase de arriba es para leerla en la ficha; contar sobre ella obligaría
    // a descomponer texto, y cambiar esas comillas rompería la medición sin
    // que nada fallara.
    await this.dataSource.query(
      `INSERT INTO crm.oportunidad_etapa (oportunidad, desde, hasta, autor)
       VALUES ($1, $2, $3, $4)`,
      [oportunidad, desde, hasta, usuario],
    );
  }
}
