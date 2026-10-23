import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CampaniasService } from '../campanias/campanias.service';
import { CrmService } from '../crm.service';
import { esCanalDeMano, esDireccion } from '../crm.reglas';
import {
  CampoFormulario,
  EnvioLimpio,
  EstadoLead,
  Origen,
  duplicadoDe,
  elegirComercial,
  esCanalLead,
  esEstadoLead,
  esPrimeraRespuesta,
  normalizarRuc,
  origenDe,
  pareceRobot,
  problemasDeFormulario,
  puedePasarLead,
  puntajeDe,
  tasasDelEmbudo,
  validarEnvio,
} from './leads.reglas';
import { correoPlausible, normalizarCorreo } from '../campanias/campanias.reglas';
import { normalizarTelefono } from '../whatsapp/whatsapp.reglas';

/** Ver `crm.service.ts`: un INSERT con RETURNING devuelve `[filas, n]`. */
function filasDe(res: unknown): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as any[]);
}

function textoONulo(valor: unknown, max = 500): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === '' ? null : limpio.slice(0, max);
}

/**
 * La clave del cerrojo con el que se serializa la entrada de leads.
 *
 * La deduplicación mira dos columnas —correo o teléfono—, y un índice único no
 * puede expresar «o». Sin cerrojo, dos envíos casi simultáneos de la misma
 * persona (el doble clic, el reintento del navegador) no se ven entre sí y
 * entran como dos leads. El volumen de un formulario es de decenas al día, así
 * que serializar la entrada no cuesta nada.
 */
const CERROJO_LEADS = 74_001;

export const TEXTO_CONSENTIMIENTO =
  'Autorizo el tratamiento de mis datos personales para que me contacten con información comercial, ' +
  'conforme a la Ley Orgánica de Protección de Datos Personales. Puedo revocar esta autorización en cualquier momento.';

const CAMPOS_POR_DEFECTO: CampoFormulario[] = [
  { clave: 'nombre', etiqueta: 'Nombre y apellido', tipo: 'texto', obligatorio: true },
  { clave: 'correo', etiqueta: 'Correo', tipo: 'correo', obligatorio: true },
  { clave: 'telefono', etiqueta: 'Celular', tipo: 'telefono' },
  { clave: 'empresa', etiqueta: 'Empresa', tipo: 'texto' },
  { clave: 'ruc', etiqueta: 'RUC o cédula', tipo: 'texto' },
  { clave: 'mensaje', etiqueta: '¿En qué te podemos ayudar?', tipo: 'area' },
];

/** Lo que llega para registrar un lead, venga de un formulario o de una persona. */
interface Entrada {
  envio: EnvioLimpio;
  origen: Origen;
  canal: string;
  marca: string;
  formulario: { id: number; slug: string; reparto: string[] } | null;
  /** Quien lo registra a mano. Nulo cuando llega por un formulario público. */
  usuario: string | null;
  asignarA?: string | null;
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crm: CrmService,
    private readonly campanias: CampaniasService,
  ) {}

  /** La base de las URL públicas: la de los formularios y su código para incrustar. */
  get urlPublica(): string {
    return (process.env.CRM_URL_PUBLICA ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  // ======================================================== lado público

  /** El formulario tal como lo ve quien lo rellena. Sólo si está activo. */
  async formularioPublico(slug: string) {
    const filas = await this.dataSource.query(
      `SELECT id, slug, nombre, titulo, descripcion, campos, texto_consentimiento,
              mensaje_gracias, redirigir_a
         FROM crm.formulario WHERE slug = $1 AND activo`,
      [slug],
    );
    if (!filas[0]) throw new NotFoundException('Este formulario no existe o ya no está activo.');
    return filas[0];
  }

  /**
   * Cuenta una visita al formulario.
   *
   * Sólo un número por día: lo que se quiere saber es cuántos lo abrieron y no
   * lo enviaron, y para eso no hace falta guardar nada de quien no dejó sus
   * datos. Falla en silencio: una visita sin contar no puede impedir que
   * alguien vea el formulario.
   */
  async contarVista(formularioId: number) {
    try {
      await this.dataSource.query(
        `INSERT INTO crm.formulario_vista (formulario, dia, vistas) VALUES ($1, current_date, 1)
         ON CONFLICT (formulario, dia) DO UPDATE SET vistas = crm.formulario_vista.vistas + 1`,
        [formularioId],
      );
    } catch {
      /* se sigue sin contar */
    }
  }

  /**
   * Un envío del formulario público.
   *
   * Devuelve los errores de validación para volver a pintar el formulario, o
   * `{ ok: true }`. A un robot también se le dice que sí: si se le rechazara,
   * aprendería qué señal lo delató.
   */
  async recibirEnvio(slug: string, respuestas: Record<string, unknown>) {
    const formulario = await this.formularioPublico(slug);
    const completo = (
      await this.dataSource.query(`SELECT marca, reparto FROM crm.formulario WHERE id = $1`, [
        formulario.id,
      ])
    )[0];

    if (pareceRobot(respuestas)) return { ok: true, formulario };

    const { errores, envio } = validarEnvio(formulario.campos ?? [], respuestas);
    if (!envio) return { ok: false, errores, formulario };

    await this.registrar({
      envio,
      origen: origenDe(respuestas),
      canal: 'formulario',
      marca: completo.marca,
      formulario: { id: Number(formulario.id), slug, reparto: completo.reparto ?? [] },
      usuario: null,
    });

    return { ok: true, formulario };
  }

  // ======================================================== la bandeja

  async listar(
    filtros: {
      estado?: string;
      asignado?: string;
      formulario?: number;
      canal?: string;
      q?: string;
    } = {},
  ) {
    const where: string[] = [];
    const params: any[] = [];
    const agregar = (cond: string, valor: unknown) => {
      params.push(valor);
      where.push(cond.replace('?', `$${params.length}`));
    };

    if (filtros.estado === 'vivos') {
      where.push(`l.estado NOT IN ('convertido','descartado')`);
    } else if (filtros.estado) {
      agregar('l.estado = ?', filtros.estado);
    }
    if (filtros.asignado === 'sin_asignar') where.push('l.asignado_a IS NULL');
    else if (filtros.asignado) agregar('l.asignado_a = ?', filtros.asignado);
    if (filtros.formulario) agregar('l.formulario_id = ?', filtros.formulario);
    if (filtros.canal) agregar('l.origen_canal = ?', filtros.canal);
    if (filtros.q?.trim()) {
      agregar(
        `(l.nombre ILIKE ? OR l.correo ILIKE $${params.length} OR l.telefono ILIKE $${params.length}
          OR l.empresa_nombre ILIKE $${params.length})`,
        `%${filtros.q.trim()}%`,
      );
    }

    // Lo nuevo primero, y dentro de lo nuevo lo que más promete: es el orden en
    // que conviene atender. Lo ya convertido o descartado baja al final.
    const leads = await this.dataSource.query(
      `SELECT l.id, l.nombre, l.correo, l.telefono, l.empresa_nombre, l.estado,
              l.origen_canal, l.origen_fuente, l.origen_campania, l.asignado_a,
              l.puntaje, l.envios, l.recibido_en, l.ultimo_envio_en, l.primera_respuesta_en,
              l.marca, l.contacto_id, l.empresa_id, l.oportunidad_id,
              f.nombre AS formulario_nombre
         FROM crm.lead l
         LEFT JOIN crm.formulario f ON f.id = l.formulario_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY (l.estado = 'nuevo') DESC,
                 (l.estado IN ('convertido','descartado')) ASC,
                 l.puntaje DESC, l.ultimo_envio_en DESC
        LIMIT 300`,
      params,
    );

    const resumen = await this.dataSource.query(
      `SELECT estado, count(*)::int AS n FROM crm.lead GROUP BY estado`,
    );

    return {
      leads,
      resumen: Object.fromEntries(resumen.map((r: any) => [r.estado, r.n])),
    };
  }

  async obtener(id: number) {
    const filas = await this.dataSource.query(
      `SELECT l.*, f.nombre AS formulario_nombre, f.producto AS formulario_producto,
              e.name AS empresa_crm, c.first_name AS contacto_nombre, c.last_name AS contacto_apellido,
              o.name AS oportunidad_nombre,
              p.nombre AS padron_nombre, p.actividad AS padron_actividad,
              p.provincia AS padron_provincia
         FROM crm.lead l
         LEFT JOIN crm.formulario f ON f.id = l.formulario_id
         LEFT JOIN crm.empresa e ON e.id = l.empresa_id
         LEFT JOIN crm.contacto c ON c.id = l.contacto_id
         LEFT JOIN crm.oportunidad o ON o.id = l.oportunidad_id
         LEFT JOIN perfil_comercial p ON p.tipo_sujeto = l.tipo_sujeto AND p.clave = l.clave
        WHERE l.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe el lead ${id}`);

    const historial = await this.dataSource.query(
      `SELECT id, canal, direccion, resultado, texto, ocurrido_en, autor
         FROM crm.interaccion WHERE lead = $1 ORDER BY ocurrido_en DESC`,
      [id],
    );
    return { ...filas[0], historial };
  }

  /**
   * Un lead que registra una persona: el de una feria, un referido, una
   * llamada que entró a la centralita.
   *
   * Pasa por la misma deduplicación que los del formulario. Es justo el caso
   * en que más se duplica: la tarjeta de la feria es de alguien que ya había
   * escrito por la web.
   */
  async crearManual(datos: Record<string, any>, usuario: string) {
    const canal = datos.canal ?? 'otro';
    if (!esCanalLead(canal)) {
      throw new BadRequestException(`El canal «${canal}» no está en la lista.`);
    }
    const marca = textoONulo(datos.marca);
    if (!marca) throw new BadRequestException('Falta la marca.');

    const correo = textoONulo(datos.correo);
    if (correo && !correoPlausible(correo)) {
      throw new BadRequestException('Ese correo no parece válido.');
    }
    const telefono = textoONulo(datos.telefono);
    if (!correo && !telefono) {
      throw new BadRequestException('Hace falta un correo o un teléfono: sin ellos nadie puede contactarlo.');
    }

    const envio: EnvioLimpio = {
      nombre: textoONulo(datos.nombre),
      correo,
      telefono,
      empresa: textoONulo(datos.empresa),
      ruc: normalizarRuc(datos.ruc),
      mensaje: textoONulo(datos.mensaje, 4000),
      datos: {},
      correoNorm: correo ? normalizarCorreo(correo) : null,
      telefonoNorm: telefono ? normalizarTelefono(telefono) || null : null,
      consentimiento: datos.consentimiento === true,
    };

    const id = await this.registrar({
      envio,
      origen: {
        fuente: textoONulo(datos.fuente, 100),
        medio: textoONulo(datos.medio, 100),
        // En un evento, la «campaña» es el nombre del evento: es lo que luego
        // se quiere poder comparar —qué feria trajo clientes y cuál no.
        campania: textoONulo(datos.campania, 200),
        contenido: null,
        termino: null,
        pagina: null,
      },
      canal,
      marca,
      formulario: null,
      usuario,
      asignarA: textoONulo(datos.asignado_a),
    });
    return this.obtener(id);
  }

  /**
   * Cambia el estado de un lead.
   *
   * Descartar exige motivo: un lead descartado sin decir por qué no se puede
   * auditar, y «no contesta» y «no es cliente nuestro» piden cosas distintas
   * a marketing.
   */
  async cambiarEstado(id: number, estado: string, motivo: string | null, usuario: string) {
    if (!esEstadoLead(estado)) throw new BadRequestException(`El estado «${estado}» no existe.`);
    if (estado === 'convertido') {
      throw new BadRequestException(
        'Un lead se convierte creando su oportunidad, no cambiándole el estado.',
      );
    }

    const lead = await this.leadParaEscribir(id);
    if (!puedePasarLead(lead.estado, estado)) {
      throw new ConflictException(`Un lead «${lead.estado}» no puede pasar a «${estado}».`);
    }
    const motivoLimpio = textoONulo(motivo);
    if (estado === 'descartado' && !motivoLimpio) {
      throw new BadRequestException('Di por qué se descarta: sin motivo no se puede revisar después.');
    }

    await this.dataSource.query(
      `UPDATE crm.lead
          SET estado = $2,
              motivo_descarte = CASE WHEN $2 = 'descartado' THEN $3 ELSE NULL END,
              primera_respuesta_en = CASE WHEN $4 THEN now() ELSE primera_respuesta_en END,
              actualizado_en = now()
        WHERE id = $1`,
      [id, estado, motivoLimpio, esPrimeraRespuesta(lead.estado, lead.primera_respuesta_en)],
    );
    await this.anotarSistema(
      id,
      `De «${lead.estado}» a «${estado}»${motivoLimpio ? `: ${motivoLimpio}` : ''}`,
      usuario,
    );
    return this.obtener(id);
  }

  /**
   * Reasigna un lead, o lo devuelve a la bandeja común con `null`.
   *
   * El comercial tiene que existir y estar activo: aquí el nombre lo escribe
   * quien reparte, y un error de dedo dejaría el lead en manos de nadie.
   */
  async asignar(id: number, comercial: string | null, usuario: string) {
    const lead = await this.leadParaEscribir(id);
    const destino = textoONulo(comercial);
    if (destino) await this.exigirComercialActivo(destino);

    await this.dataSource.query(
      `UPDATE crm.lead SET asignado_a = $2::text,
              asignado_en = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
              actualizado_en = now()
        WHERE id = $1`,
      [id, destino],
    );
    await this.anotarSistema(
      id,
      destino
        ? `Asignado a ${destino}${lead.asignado_a ? ` (antes ${lead.asignado_a})` : ''}`
        : 'Devuelto a la bandeja sin asignar',
      usuario,
    );
    return this.obtener(id);
  }

  /**
   * Anota un contacto con el lead: la llamada, el WhatsApp, el correo.
   *
   * Contactar a un lead nuevo es atenderlo, así que una interacción saliente
   * lo pasa a `contactado` y marca la primera respuesta. Hacerlo en dos pasos
   * —anotar y luego cambiar el estado— es lo que nadie hace, y el tiempo de
   * respuesta saldría peor de lo que fue.
   */
  async anotar(id: number, datos: Record<string, any>, usuario: string) {
    if (!esCanalDeMano(datos.canal)) {
      throw new BadRequestException(`El canal «${datos.canal}» no está en la lista.`);
    }
    if (!esDireccion(datos.direccion)) {
      throw new BadRequestException('La dirección tiene que ser «entrante» o «saliente».');
    }
    const lead = await this.leadParaEscribir(id);

    await this.dataSource.query(
      `INSERT INTO crm.interaccion (canal, direccion, lead, resultado, texto, autor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [datos.canal, datos.direccion, id, textoONulo(datos.resultado), textoONulo(datos.texto, 4000), usuario],
    );

    if (datos.direccion === 'saliente' && lead.estado === 'nuevo') {
      await this.dataSource.query(
        `UPDATE crm.lead SET estado = 'contactado',
                primera_respuesta_en = coalesce(primera_respuesta_en, now()),
                actualizado_en = now()
          WHERE id = $1`,
        [id],
      );
    }
    return this.obtener(id);
  }

  /**
   * Convierte el lead en una oportunidad.
   *
   * El cliente sale, por orden: de la empresa que se indique, de la que ya
   * estaba enlazada al lead, del sujeto del padrón que coincide con su RUC, o
   * de una empresa nueva con el nombre que dejó. El contacto se crea con sus
   * datos si no existía.
   *
   * La oportunidad se abre con `CrmService.abrir` y no con un INSERT propio:
   * ahí viven la regla de una oportunidad abierta por cliente y producto y el
   * enganche con el estado comercial del gestor, y duplicarlas aquí sería
   * tener dos versiones que acaban difiriendo. Lleva `origen_lead`, que es lo
   * que permite atribuir la venta a la campaña que trajo al lead.
   */
  async convertir(id: number, datos: Record<string, any>, usuario: string) {
    const lead = await this.leadParaEscribir(id);
    if (lead.estado === 'descartado') {
      throw new ConflictException('Ese lead está descartado. Recupéralo antes de convertirlo.');
    }

    const producto = textoONulo(datos.producto) ?? lead.formulario_producto;
    if (!producto) throw new BadRequestException('Elige qué se le va a ofrecer.');
    const existeProducto = await this.dataSource.query(`SELECT 1 FROM producto WHERE codigo = $1`, [
      producto,
    ]);
    if (!existeProducto.length) throw new BadRequestException(`El producto «${producto}» no existe.`);

    // La empresa. Se crea antes de abrir porque `abrir` la necesita, pero una
    // empresa nueva nunca choca con la regla de una oportunidad abierta por
    // producto, así que no queda una ficha huérfana si algo falla después.
    let empresaId: number | null = datos.empresaId != null ? Number(datos.empresaId) : lead.empresa_id;
    let sujeto: { tipoSujeto: string; clave: string } | null = null;
    if (!empresaId && lead.tipo_sujeto && lead.clave) {
      sujeto = { tipoSujeto: lead.tipo_sujeto, clave: lead.clave };
    }
    if (!empresaId && !sujeto) {
      const nombre = textoONulo(datos.empresaNombre) ?? lead.empresa_nombre ?? lead.nombre;
      if (!nombre) throw new BadRequestException('Falta el nombre de la empresa.');
      const res = await this.dataSource.query(
        `INSERT INTO crm.empresa (name, tax_identifier, phone_number, sales_id, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [nombre, lead.ruc, lead.telefono, lead.asignado_a, usuario],
      );
      empresaId = Number(filasDe(res)[0].id);
    }

    const oportunidad = await this.crm.abrir(
      {
        ...(empresaId ? { empresaId } : sujeto!),
        nombre: textoONulo(datos.nombre) ?? undefined,
        producto,
        marca: textoONulo(datos.marca) ?? lead.marca,
        monto: datos.monto != null && datos.monto !== '' ? Number(datos.monto) : null,
        comercial: lead.asignado_a ?? usuario,
        origenLead: id,
      },
      usuario,
    );
    empresaId = Number(oportunidad.company_id);

    const contactoId = lead.contacto_id ?? (await this.crearContacto(lead, empresaId, usuario));
    // La ficha de la oportunidad enseña sus contactos por `contact_ids`: sin
    // esto, quien abre la venta no ve con quién habló el lead.
    if (contactoId) {
      await this.dataSource.query(
        `UPDATE crm.oportunidad
            SET contact_ids = array_append(contact_ids, $2::bigint)
          WHERE id = $1 AND NOT ($2::bigint = ANY(contact_ids))`,
        [oportunidad.id, contactoId],
      );
    }

    await this.dataSource.query(
      `UPDATE crm.lead
          SET estado = 'convertido', oportunidad_id = $2, empresa_id = $3, contacto_id = $4,
              primera_respuesta_en = coalesce(primera_respuesta_en, now()),
              actualizado_en = now()
        WHERE id = $1`,
      [id, oportunidad.id, empresaId, contactoId],
    );
    await this.anotarSistema(id, `Convertido en la oportunidad ${oportunidad.id}`, usuario);
    return this.obtener(id);
  }

  // ======================================================== formularios

  async formularios() {
    const filas = await this.dataSource.query(
      `SELECT f.*, m.nombre AS marca_nombre, pr.nombre AS producto_nombre,
              (SELECT count(*)::int FROM crm.lead l WHERE l.formulario_id = f.id) AS leads,
              (SELECT coalesce(sum(v.vistas), 0)::int FROM crm.formulario_vista v
                WHERE v.formulario = f.id) AS vistas
         FROM crm.formulario f
         JOIN crm.marca m ON m.codigo = f.marca
         LEFT JOIN producto pr ON pr.codigo = f.producto
        ORDER BY f.activo DESC, f.creado_en DESC`,
    );
    return filas.map((f: any) => ({ ...f, url: `${this.urlPublica}/crm/publico/f/${f.slug}` }));
  }

  async formulario(id: number) {
    const f = (await this.formularios()).find((x: any) => Number(x.id) === id);
    if (!f) throw new NotFoundException(`No existe el formulario ${id}`);
    return f;
  }

  /** El catálogo del que salen las oportunidades: lo que se puede ofrecer. */
  async productos() {
    return this.dataSource.query(`SELECT codigo, nombre FROM producto ORDER BY nombre`);
  }

  /** Lo que se rellena por defecto al crear uno, para no empezar en blanco. */
  plantillaDeFormulario() {
    return { campos: CAMPOS_POR_DEFECTO, texto_consentimiento: TEXTO_CONSENTIMIENTO };
  }

  async crearFormulario(datos: Record<string, any>, usuario: string) {
    const limpio = await this.validarFormulario(datos, true);
    try {
      const res = await this.dataSource.query(
        `INSERT INTO crm.formulario
           (slug, nombre, marca, producto, titulo, descripcion, campos, texto_consentimiento,
            mensaje_gracias, redirigir_a, reparto, activo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          limpio.slug,
          limpio.nombre,
          limpio.marca,
          limpio.producto,
          limpio.titulo,
          limpio.descripcion,
          JSON.stringify(limpio.campos),
          limpio.texto_consentimiento,
          limpio.mensaje_gracias,
          limpio.redirigir_a,
          limpio.reparto,
          limpio.activo,
          usuario,
        ],
      );
      return this.formulario(Number(filasDe(res)[0].id));
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(`Ya hay un formulario con la dirección «${limpio.slug}».`);
      }
      throw e;
    }
  }

  /**
   * Edita un formulario.
   *
   * El `slug` no se cambia: es la URL que ya está pegada en una web, impresa en
   * un QR o puesta en un anuncio. Cambiarlo dejaría todo eso apuntando a un 404
   * sin que nadie se entere hasta que dejen de llegar leads.
   */
  async editarFormulario(id: number, datos: Record<string, any>) {
    const actual = await this.formulario(id);
    if (datos.slug !== undefined && datos.slug !== actual.slug) {
      throw new BadRequestException(
        'La dirección de un formulario no se cambia: ya puede estar publicada. Crea otro formulario.',
      );
    }
    const limpio = await this.validarFormulario({ ...actual, ...datos }, false);
    await this.dataSource.query(
      `UPDATE crm.formulario
          SET nombre = $2, marca = $3, producto = $4, titulo = $5, descripcion = $6, campos = $7,
              texto_consentimiento = $8, mensaje_gracias = $9, redirigir_a = $10, reparto = $11,
              activo = $12, actualizado_en = now()
        WHERE id = $1`,
      [
        id,
        limpio.nombre,
        limpio.marca,
        limpio.producto,
        limpio.titulo,
        limpio.descripcion,
        JSON.stringify(limpio.campos),
        limpio.texto_consentimiento,
        limpio.mensaje_gracias,
        limpio.redirigir_a,
        limpio.reparto,
        limpio.activo,
      ],
    );
    return this.formulario(id);
  }

  // ============================================================ embudo

  /**
   * El embudo de captación: de la visita a la oportunidad.
   *
   * Agrupa por formulario y por fuente, que son las dos preguntas: qué página
   * capta y qué campaña trae gente que compra. Cuenta los leads recibidos en
   * el período, cada uno en la etapa más avanzada a la que llegó.
   */
  async embudo(filtros: { desde?: string; hasta?: string; marca?: string } = {}) {
    const desde = filtros.desde || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const hasta = filtros.hasta || new Date().toISOString().slice(0, 10);
    const params: any[] = [desde, hasta];
    let filtroMarca = '';
    if (filtros.marca) {
      params.push(filtros.marca);
      filtroMarca = `AND l.marca = $${params.length}`;
    }

    const conteos = (agrupar: string) => `
      SELECT ${agrupar} AS clave,
             count(*)::int AS recibidos,
             count(*) FILTER (WHERE l.primera_respuesta_en IS NOT NULL)::int AS atendidos,
             count(*) FILTER (WHERE l.estado IN ('calificado','convertido'))::int AS calificados,
             count(*) FILTER (WHERE l.estado = 'convertido')::int AS convertidos,
             count(*) FILTER (WHERE l.estado = 'descartado')::int AS descartados,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM l.primera_respuesta_en - l.recibido_en) / 60
             ) FILTER (WHERE l.primera_respuesta_en IS NOT NULL) AS minutos_respuesta
        FROM crm.lead l
       WHERE l.recibido_en >= $1::date AND l.recibido_en < $2::date + 1 ${filtroMarca}
       GROUP BY 1`;

    const [porFormulario, porFuente, vistas, formularios] = await Promise.all([
      this.dataSource.query(conteos('l.formulario_id'), params),
      this.dataSource.query(conteos(`coalesce(l.origen_fuente, l.origen_canal, 'sin origen')`), params),
      this.dataSource.query(
        `SELECT formulario AS clave, sum(vistas)::int AS vistas FROM crm.formulario_vista
          WHERE dia BETWEEN $1::date AND $2::date GROUP BY 1`,
        [desde, hasta],
      ),
      this.dataSource.query(`SELECT id, nombre FROM crm.formulario`),
    ]);

    const vistasDe = new Map<string, number>(
      vistas.map((v: any) => [String(v.clave), Number(v.vistas)]),
    );
    const nombreDe = new Map<string, string>(formularios.map((f: any) => [String(f.id), f.nombre]));

    const fila = (r: any, vistasFila: number) => ({
      ...r,
      vistas: vistasFila,
      minutos_respuesta: r.minutos_respuesta != null ? Math.round(Number(r.minutos_respuesta)) : null,
      tasas: tasasDelEmbudo({ ...r, vistas: vistasFila }),
    });

    const formulariosFilas = porFormulario.map((r: any) =>
      fila(
        { ...r, nombre: r.clave ? nombreDe.get(String(r.clave)) : 'Registrados a mano' },
        r.clave ? (vistasDe.get(String(r.clave)) ?? 0) : 0,
      ),
    );
    // Un formulario con visitas y ningún lead es justo el que más interesa ver:
    // todos lo abandonaron. Sin esto desaparecería del informe.
    for (const [clave, n] of vistasDe) {
      if (!porFormulario.some((r: any) => String(r.clave) === clave)) {
        formulariosFilas.push(
          fila(
            { clave, nombre: nombreDe.get(clave), recibidos: 0, atendidos: 0, calificados: 0, convertidos: 0, descartados: 0 },
            n,
          ),
        );
      }
    }

    const total = formulariosFilas.reduce(
      (t: any, r: any) => ({
        vistas: t.vistas + r.vistas,
        recibidos: t.recibidos + r.recibidos,
        atendidos: t.atendidos + r.atendidos,
        calificados: t.calificados + r.calificados,
        convertidos: t.convertidos + r.convertidos,
        descartados: t.descartados + r.descartados,
      }),
      { vistas: 0, recibidos: 0, atendidos: 0, calificados: 0, convertidos: 0, descartados: 0 },
    );

    return {
      desde,
      hasta,
      total: { ...total, tasas: tasasDelEmbudo(total) },
      porFormulario: formulariosFilas,
      porFuente: porFuente.map((r: any) => fila(r, 0)),
    };
  }

  // ============================================================ privado

  /**
   * Registra un lead, o suma el envío al que ya existía.
   *
   * Todo dentro de una transacción con cerrojo: ver `CERROJO_LEADS`. Si la
   * persona ya está en la bandeja con un lead vivo, no se crea otro: se le
   * suma el envío, se completan los datos que faltaban y se respeta su
   * asignación. El origen **no** se sobrescribe —la atribución es a lo que la
   * trajo primero—, sólo se completa si faltaba; el nuevo envío queda en el
   * historial con su página.
   */
  private async registrar(entrada: Entrada): Promise<number> {
    const { envio, origen } = entrada;

    // Lo que FRIDAY ya sabe de quien escribe. Se consulta fuera del cerrojo:
    // son lecturas por índice que no dependen de la carrera.
    const [contacto, padron] = await Promise.all([
      this.contactoQueCoincide(envio),
      envio.ruc
        ? this.dataSource.query(
            `SELECT tipo_sujeto, clave FROM perfil_comercial WHERE ruc = $1 LIMIT 1`,
            [envio.ruc],
          )
        : Promise.resolve([]),
    ]);
    const sujeto = padron[0] ?? null;

    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1)`, [CERROJO_LEADS]);

      const vivos = await m.query(
        `SELECT id, correo_norm, telefono_norm, recibido_en FROM crm.lead
          WHERE estado NOT IN ('convertido','descartado')
            AND (correo_norm = $1 OR telefono_norm = $2)`,
        [envio.correoNorm, envio.telefonoNorm],
      );
      const existente = duplicadoDe(envio, vivos);

      const id = existente
        ? await this.sumarEnvio(m, Number(existente.id), entrada, contacto, sujeto)
        : await this.insertar(m, entrada, contacto, sujeto);

      await m.query(
        `INSERT INTO crm.interaccion (canal, direccion, lead, resultado, texto, autor)
         VALUES ($1, 'entrante', $2, $3, $4, $5)`,
        [
          // El canal del lead, no uno de la lista de mano: esto lo escribe el
          // sistema al recibirlo, igual que `sistema` al mover una tarjeta.
          entrada.canal,
          id,
          existente ? 'volvio_a_escribir' : 'lead_recibido',
          [
            entrada.formulario ? `Formulario «${entrada.formulario.slug}»` : `Registrado a mano (${entrada.canal})`,
            origen.pagina ? `desde ${origen.pagina}` : null,
            envio.mensaje,
          ]
            .filter(Boolean)
            .join(' · '),
          entrada.usuario ?? 'formulario',
        ],
      );

      if (envio.consentimiento && envio.correo) {
        // El consentimiento se guarda por dirección de correo, igual que el
        // que miran las campañas: es el mismo registro, no una copia.
        await this.campanias.registrarConsentimiento(
          envio.correo,
          'otorgado',
          entrada.formulario ? `formulario ${entrada.formulario.slug}` : `registrado por ${entrada.usuario}`,
        );
      }
      return id;
    });
  }

  private async insertar(
    m: EntityManager,
    entrada: Entrada,
    contacto: { id: number; company_id: number | null } | null,
    sujeto: { tipo_sujeto: string; clave: string } | null,
  ): Promise<number> {
    const { envio, origen } = entrada;
    const asignado = entrada.asignarA
      ? (await this.exigirComercialActivo(entrada.asignarA), entrada.asignarA)
      : await this.siguienteComercial(m, entrada.formulario);

    // Si el sujeto del padrón ya tiene ficha en el CRM, el lead se enlaza a
    // ella: quien lo atienda tiene que ver que es un cliente que ya existe.
    const empresaId =
      contacto?.company_id ??
      (sujeto
        ? (
            await m.query(`SELECT id FROM crm.empresa WHERE tipo_sujeto = $1 AND clave = $2`, [
              sujeto.tipo_sujeto,
              sujeto.clave,
            ])
          )[0]?.id ?? null
        : null);

    const res = await m.query(
      `INSERT INTO crm.lead
         (marca, nombre, telefono, correo, empresa_nombre, ruc, mensaje, datos,
          correo_norm, telefono_norm, origen_canal, origen_fuente, origen_medio,
          origen_campania, origen_contenido, origen_termino, pagina, consentimiento,
          puntaje, formulario_id, asignado_a, asignado_en, contacto_id, empresa_id,
          tipo_sujeto, clave, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               CASE WHEN $21::text IS NULL THEN NULL ELSE now() END,$22,$23,$24,$25,$26)
       RETURNING id`,
      [
        entrada.marca,
        envio.nombre,
        envio.telefono,
        envio.correo,
        envio.empresa,
        envio.ruc,
        envio.mensaje,
        JSON.stringify(envio.datos),
        envio.correoNorm,
        envio.telefonoNorm,
        entrada.canal,
        origen.fuente,
        origen.medio,
        origen.campania,
        origen.contenido,
        origen.termino,
        origen.pagina,
        envio.consentimiento,
        puntajeDe({ ...envio, enPadron: !!sujeto }),
        entrada.formulario?.id ?? null,
        asignado,
        contacto?.id ?? null,
        empresaId,
        sujeto?.tipo_sujeto ?? null,
        sujeto?.clave ?? null,
        entrada.usuario,
      ],
    );
    return Number(filasDe(res)[0].id);
  }

  private async sumarEnvio(
    m: EntityManager,
    id: number,
    entrada: Entrada,
    contacto: { id: number; company_id: number | null } | null,
    sujeto: { tipo_sujeto: string; clave: string } | null,
  ): Promise<number> {
    const { envio } = entrada;
    // Se completa lo que faltaba y nada más: lo que ya estaba lo pudo haber
    // corregido un comercial, y un envío nuevo no debería deshacerlo.
    const res = await m.query(
      `UPDATE crm.lead
          SET nombre         = coalesce(nombre, $2),
              correo         = coalesce(correo, $3),
              correo_norm    = coalesce(correo_norm, $4),
              telefono       = coalesce(telefono, $5),
              telefono_norm  = coalesce(telefono_norm, $6),
              empresa_nombre = coalesce(empresa_nombre, $7),
              ruc            = coalesce(ruc, $8),
              mensaje        = coalesce($9, mensaje),
              datos          = datos || $10::jsonb,
              consentimiento = consentimiento OR $11,
              contacto_id    = coalesce(contacto_id, $12),
              empresa_id     = coalesce(empresa_id, $13),
              tipo_sujeto    = coalesce(tipo_sujeto, $14),
              clave          = coalesce(clave, $15),
              -- La atribución es al primer contacto, pero sólo si ese primer
              -- contacto trajo origen: un lead que entró sin utm y vuelve desde
              -- un anuncio se atribuye al anuncio, no a «sin origen».
              origen_fuente   = coalesce(origen_fuente, $16),
              origen_medio    = coalesce(origen_medio, $17),
              origen_campania = coalesce(origen_campania, $18),
              origen_contenido = coalesce(origen_contenido, $19),
              origen_termino  = coalesce(origen_termino, $20),
              pagina          = coalesce(pagina, $21),
              envios         = envios + 1,
              ultimo_envio_en = now(),
              actualizado_en = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        envio.nombre,
        envio.correo,
        envio.correoNorm,
        envio.telefono,
        envio.telefonoNorm,
        envio.empresa,
        envio.ruc,
        envio.mensaje,
        JSON.stringify(envio.datos),
        envio.consentimiento,
        contacto?.id ?? null,
        contacto?.company_id ?? null,
        sujeto?.tipo_sujeto ?? null,
        sujeto?.clave ?? null,
        entrada.origen.fuente,
        entrada.origen.medio,
        entrada.origen.campania,
        entrada.origen.contenido,
        entrada.origen.termino,
        entrada.origen.pagina,
      ],
    );
    const lead = filasDe(res)[0];
    await m.query(`UPDATE crm.lead SET puntaje = $2 WHERE id = $1`, [
      id,
      puntajeDe({
        correo: lead.correo,
        telefono: lead.telefono,
        empresa: lead.empresa_nombre,
        ruc: lead.ruc,
        mensaje: lead.mensaje,
        consentimiento: lead.consentimiento,
        envios: lead.envios,
        enPadron: !!lead.tipo_sujeto,
      }),
    ]);
    return id;
  }

  /**
   * A quién le toca el lead de este formulario. Ver `elegirComercial`.
   *
   * Se calcula dentro del cerrojo: fuera, dos leads simultáneos verían la
   * misma «última asignación» y caerían en la misma persona.
   */
  private async siguienteComercial(
    m: EntityManager,
    formulario: Entrada['formulario'],
  ): Promise<string | null> {
    if (!formulario?.reparto?.length) return null;
    const [activos, ultimas] = await Promise.all([
      m.query(`SELECT usuario FROM crm.comercial WHERE usuario = ANY($1) AND NOT disabled`, [
        formulario.reparto,
      ]),
      m.query(
        `SELECT asignado_a, max(asignado_en) AS ultima FROM crm.lead
          WHERE formulario_id = $1 AND asignado_a = ANY($2)
          GROUP BY asignado_a`,
        [formulario.id, formulario.reparto],
      ),
    ]);
    return elegirComercial(
      formulario.reparto,
      new Set(activos.map((a: any) => a.usuario)),
      new Map(ultimas.map((u: any) => [u.asignado_a, u.ultima])),
    );
  }

  /**
   * El contacto del CRM con ese correo o ese teléfono, si lo hay.
   *
   * El teléfono se compara por los últimos nueve dígitos: en la ficha puede
   * estar como `099…`, `+593 99…` o con espacios, y normalizar el jsonb entero
   * en SQL para compararlo con la función de TypeScript sería reimplementarla.
   * Nueve dígitos identifican un celular ecuatoriano sin el prefijo.
   */
  private async contactoQueCoincide(
    envio: EnvioLimpio,
  ): Promise<{ id: number; company_id: number | null } | null> {
    if (!envio.correoNorm && !envio.telefonoNorm) return null;
    const filas = await this.dataSource.query(
      `SELECT c.id, c.company_id FROM crm.contacto c
        WHERE ($1::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(coalesce(c.email_jsonb, '[]'::jsonb)) e
                 WHERE lower(trim(e->>'email')) = $1))
           OR ($2::text IS NOT NULL AND length($2) >= 9 AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(coalesce(c.phone_jsonb, '[]'::jsonb)) t
                 WHERE right(regexp_replace(t->>'number', '\\D', '', 'g'), 9) = right($2, 9)))
        ORDER BY c.id LIMIT 1`,
      [envio.correoNorm, envio.telefonoNorm],
    );
    return filas[0] ? { id: Number(filas[0].id), company_id: filas[0].company_id } : null;
  }

  private async crearContacto(lead: any, empresaId: number, usuario: string): Promise<number | null> {
    if (!lead.nombre && !lead.correo && !lead.telefono) return null;
    const [nombre, ...resto] = String(lead.nombre ?? lead.correo ?? lead.telefono).trim().split(/\s+/);
    const res = await this.dataSource.query(
      `INSERT INTO crm.contacto
         (first_name, last_name, company_id, email_jsonb, phone_jsonb, first_seen, last_seen, creado_por)
       VALUES ($1, $2, $3, $4, $5, now(), now(), $6) RETURNING id`,
      [
        nombre,
        resto.join(' ') || null,
        empresaId,
        JSON.stringify(lead.correo ? [{ email: lead.correo, type: 'Work' }] : []),
        JSON.stringify(lead.telefono ? [{ number: lead.telefono, type: 'Work' }] : []),
        usuario,
      ],
    );
    return Number(filasDe(res)[0].id);
  }

  private async leadParaEscribir(id: number): Promise<any & { estado: EstadoLead }> {
    const filas = await this.dataSource.query(
      `SELECT l.*, f.producto AS formulario_producto
         FROM crm.lead l LEFT JOIN crm.formulario f ON f.id = l.formulario_id
        WHERE l.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe el lead ${id}`);
    if (filas[0].estado === 'convertido') {
      throw new ConflictException(
        'Ese lead ya es una oportunidad: se sigue trabajando desde ella.',
      );
    }
    return filas[0];
  }

  private async exigirComercialActivo(usuario: string) {
    const existe = await this.dataSource.query(
      `SELECT 1 FROM crm.comercial WHERE usuario = $1 AND NOT disabled`,
      [usuario],
    );
    if (existe.length === 0) {
      throw new NotFoundException(`No hay ningún comercial activo llamado «${usuario}».`);
    }
  }

  private async anotarSistema(lead: number, texto: string, usuario: string) {
    await this.dataSource.query(
      `INSERT INTO crm.interaccion (canal, direccion, lead, resultado, texto, autor)
       VALUES ('sistema', 'saliente', $1, 'cambio_lead', $2, $3)`,
      [lead, texto, usuario],
    );
  }

  private async validarFormulario(datos: Record<string, any>, nuevo: boolean) {
    const slug = String(datos.slug ?? '').trim().toLowerCase();
    if (nuevo && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
      throw new BadRequestException(
        'La dirección va en minúsculas, con números y guiones: «feria-quito-2026».',
      );
    }
    const nombre = textoONulo(datos.nombre);
    if (!nombre) throw new BadRequestException('Falta el nombre del formulario.');

    const campos: CampoFormulario[] = Array.isArray(datos.campos) ? datos.campos : [];
    const problemas = problemasDeFormulario(campos);
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const marca = textoONulo(datos.marca);
    const existeMarca = marca
      ? await this.dataSource.query(`SELECT 1 FROM crm.marca WHERE codigo = $1`, [marca])
      : [];
    if (!existeMarca.length) throw new BadRequestException('Elige una marca que exista.');

    const producto = textoONulo(datos.producto);
    if (producto) {
      const existe = await this.dataSource.query(`SELECT 1 FROM producto WHERE codigo = $1`, [producto]);
      if (!existe.length) throw new BadRequestException(`El producto «${producto}» no existe.`);
    }

    const reparto: string[] = Array.isArray(datos.reparto)
      ? [...new Set<string>(datos.reparto.map((u: unknown) => String(u).trim()).filter(Boolean))]
      : [];
    for (const usuario of reparto) await this.exigirComercialActivo(usuario);

    const redirigir = textoONulo(datos.redirigir_a, 1000);
    if (redirigir && !/^https?:\/\//i.test(redirigir)) {
      throw new BadRequestException('La página de destino tiene que empezar por http:// o https://.');
    }

    return {
      slug,
      nombre,
      marca: marca!,
      producto,
      titulo: textoONulo(datos.titulo, 200),
      descripcion: textoONulo(datos.descripcion, 2000),
      campos: campos.map((c) => ({
        clave: c.clave,
        etiqueta: String(c.etiqueta ?? c.clave).trim(),
        tipo: c.tipo,
        obligatorio: !!c.obligatorio,
        ...(c.opciones?.length ? { opciones: c.opciones.map((o) => String(o).trim()).filter(Boolean) } : {}),
        ...(c.mostrarSi?.campo ? { mostrarSi: { campo: c.mostrarSi.campo, valor: String(c.mostrarSi.valor ?? '') } } : {}),
      })),
      // Sin texto de consentimiento no se puede saber a qué dijo que sí quien
      // marcó la casilla, y el registro no sostiene una reclamación.
      texto_consentimiento: textoONulo(datos.texto_consentimiento, 2000) ?? TEXTO_CONSENTIMIENTO,
      mensaje_gracias: textoONulo(datos.mensaje_gracias, 1000),
      redirigir_a: redirigir,
      reparto,
      activo: datos.activo !== false,
    };
  }
}
