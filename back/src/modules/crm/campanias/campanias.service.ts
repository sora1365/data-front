import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SegmentosService } from '../../segmentos/segmentos.service';
import { CorreoConector } from './correo.conector';
import {
  Destinatario,
  EstadoConsentimiento,
  normalizarCorreo,
  personalizar,
  problemasDeCampania,
  repartirDestinatarios,
} from './campanias.reglas';

/**
 * Cuántos correos se mandan de una tanda.
 *
 * Los proveedores limitan por segundo y, sobre todo, mandar cuarenta mil de
 * golpe desde un dominio nuevo es la forma más rápida de que lo marquen como
 * spam. Se envía en tandas con una pausa, y la campaña guarda por dónde iba.
 */
const TANDA = 50;
const PAUSA_MS = 1000;

@Injectable()
export class CampaniasService {
  private readonly log = new Logger('Campañas');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly correo: CorreoConector,
    private readonly segmentos: SegmentosService,
  ) {}

  get conectado() {
    return this.correo.real;
  }

  // ------------------------------------------------------------------ campañas

  async listar() {
    return this.dataSource.query(
      `SELECT c.*, s.nombre AS segmento_nombre,
              (SELECT count(*)::int FROM crm.campania_envio e WHERE e.campania = c.id) AS destinatarios,
              (SELECT count(*)::int FROM crm.campania_envio e
                WHERE e.campania = c.id AND e.estado = 'enviado') AS enviados,
              (SELECT count(*)::int FROM crm.campania_envio e
                WHERE e.campania = c.id AND e.abierto_en IS NOT NULL) AS abiertos
         FROM crm.campania c
         LEFT JOIN segmento s ON s.codigo = c.segmento
        ORDER BY c.creada_en DESC`,
    );
  }

  async obtener(id: number) {
    const filas = await this.dataSource.query(
      `SELECT c.*, s.nombre AS segmento_nombre FROM crm.campania c
         LEFT JOIN segmento s ON s.codigo = c.segmento
        WHERE c.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe la campaña ${id}`);

    const [{ resumen }] = await this.dataSource.query(
      `SELECT json_build_object(
                'total', count(*),
                'pendientes', count(*) FILTER (WHERE estado = 'pendiente'),
                'enviados', count(*) FILTER (WHERE estado = 'enviado'),
                'descartados', count(*) FILTER (WHERE estado = 'descartado'),
                'fallidos', count(*) FILTER (WHERE estado = 'fallido'),
                'abiertos', count(*) FILTER (WHERE abierto_en IS NOT NULL)
              ) AS resumen
         FROM crm.campania_envio WHERE campania = $1`,
      [id],
    );

    return { ...filas[0], resumen };
  }

  /**
   * Crea una campaña, opcionalmente desde una plantilla.
   *
   * Con `plantilla`, el asunto y el cuerpo se **copian** a la campaña en vez de
   * referenciarse. Es a propósito: editar la plantilla el mes que viene no
   * puede cambiar lo que ya se envió, y una campaña que muestra un texto
   * distinto del que recibió la gente no sirve ni para repetirla ni para
   * responder a una queja.
   */
  async crear(datos: Record<string, any>, usuario: string) {
    let base = { ...datos };

    if (datos.plantilla) {
      const plantilla = (
        await this.dataSource.query(`SELECT * FROM crm.plantilla_correo WHERE id = $1`, [
          datos.plantilla,
        ])
      )[0];
      if (!plantilla) throw new NotFoundException(`No existe la plantilla ${datos.plantilla}`);

      base = {
        ...base,
        asunto: datos.asunto ?? plantilla.asunto,
        cuerpo: datos.cuerpo ?? plantilla.cuerpo,
        remitente: datos.remitente ?? plantilla.remitente,
        producto: datos.producto ?? plantilla.producto,
        marca: datos.marca ?? plantilla.marca,
        nombre: datos.nombre ?? plantilla.nombre,
      };
    }

    const problemas = problemasDeCampania(base);
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const res = await this.dataSource.query(
      `INSERT INTO crm.campania (nombre, marca, segmento, producto, asunto, cuerpo, remitente, plantilla, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        base.nombre ?? base.asunto,
        base.marca ?? null,
        base.segmento ?? null,
        base.producto ?? null,
        base.asunto,
        base.cuerpo,
        base.remitente ?? null,
        datos.plantilla ?? null,
        usuario,
      ],
    );
    const id = (Array.isArray(res[0]) ? res[0][0] : res[0]).id;
    return this.obtener(Number(id));
  }

  /**
   * Materializa a quién se va a escribir.
   *
   * Se hace antes de enviar y se guarda, por dos razones: deja revisar a
   * cuántos va y por qué se descartó a cada quien **antes** de mandar nada, y
   * fija la lista. Recalcular el segmento durante el envío daría una lista
   * distinta a mitad de camino, porque los segmentos cambian con cada corrida.
   */
  async preparar(id: number, opciones: { exigirConsentimientoExpreso?: boolean } = {}) {
    const campania = await this.obtener(id);
    if (campania.estado === 'enviando' || campania.estado === 'enviada') {
      throw new BadRequestException('Esta campaña ya se envió o se está enviando.');
    }
    if (!campania.segmento) {
      throw new BadRequestException('La campaña no tiene segmento: no hay a quién escribir.');
    }

    const candidatos = await this.candidatosDelSegmento(campania.segmento);
    const consentimientos = await this.consentimientosDe(candidatos.map((c) => c.correo));

    const { envian, descartados } = repartirDestinatarios(candidatos, consentimientos, opciones);

    await this.dataSource.query(`DELETE FROM crm.campania_envio WHERE campania = $1`, [id]);

    for (const destinatario of envian) {
      await this.dataSource.query(
        `INSERT INTO crm.campania_envio (campania, correo, nombre, tipo_sujeto, clave)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (campania, correo) DO NOTHING`,
        [id, destinatario.correo, destinatario.nombre ?? null, destinatario.tipoSujeto ?? null, destinatario.clave ?? null],
      );
    }

    // Los descartados se guardan también, con su motivo: «se iba a escribir a
    // 12.000 y salieron 9.400» sin poder decir qué pasó con los otros 2.600 es
    // una cifra que nadie puede defender.
    for (const descartado of descartados) {
      await this.dataSource.query(
        `INSERT INTO crm.campania_envio (campania, correo, nombre, tipo_sujeto, clave, estado, motivo)
         VALUES ($1,$2,$3,$4,$5,'descartado',$6) ON CONFLICT (campania, correo) DO NOTHING`,
        [
          id,
          descartado.correo || `(sin correo) ${Math.random()}`,
          descartado.nombre ?? null,
          descartado.tipoSujeto ?? null,
          descartado.clave ?? null,
          descartado.motivo,
        ],
      );
    }

    await this.dataSource.query(`UPDATE crm.campania SET estado = 'preparada' WHERE id = $1`, [id]);
    return this.obtener(id);
  }

  /** Lo que se va a enviar y lo que se descartó, para revisarlo antes. */
  async destinatarios(id: number, estado?: string) {
    const params: any[] = [id];
    let filtro = '';
    if (estado) {
      params.push(estado);
      filtro = `AND estado = $2`;
    }
    return this.dataSource.query(
      `SELECT id, correo, nombre, estado, motivo, enviado_en, abierto_en
         FROM crm.campania_envio WHERE campania = $1 ${filtro}
        ORDER BY estado, correo LIMIT 500`,
      params,
    );
  }

  /**
   * Manda lo pendiente, en tandas.
   *
   * Cada envío se marca en cuanto se resuelve, no al final: si el proceso se
   * corta —se reinicia el servidor, falla la red— lo ya enviado queda escrito
   * y al retomar no se duplica. Guardar al final mandaría dos veces todo lo de
   * la última tanda.
   */
  async enviar(id: number) {
    const campania = await this.obtener(id);
    if (campania.estado === 'enviada') throw new BadRequestException('Esta campaña ya se envió.');
    if (campania.estado === 'borrador') {
      throw new BadRequestException('Prepara la campaña antes de enviarla.');
    }

    await this.dataSource.query(
      `UPDATE crm.campania SET estado = 'enviando', empezada_en = coalesce(empezada_en, now()) WHERE id = $1`,
      [id],
    );

    // Los adjuntos son los mismos para toda la campaña: se resuelven una vez.
    const adjuntos = (await this.adjuntos(id)).length
      ? await this.dataSource.query(
          `SELECT nombre, ruta FROM crm.campania_adjunto WHERE campania = $1`,
          [id],
        )
      : [];

    let enviados = 0;
    let fallidos = 0;

    for (;;) {
      const tanda = await this.dataSource.query(
        `SELECT id, correo, nombre, token FROM crm.campania_envio
          WHERE campania = $1 AND estado = 'pendiente'
          ORDER BY id LIMIT ${TANDA}`,
        [id],
      );
      if (tanda.length === 0) break;

      for (const envio of tanda) {
        const valores = {
          nombre: envio.nombre ?? '',
          correo: envio.correo,
          baja: this.enlaceDeBaja(envio.token),
        };

        try {
          const resultado = await this.correo.enviar({
            para: envio.correo,
            asunto: personalizar(campania.asunto, valores),
            cuerpo: personalizar(campania.cuerpo, valores),
            de: campania.remitente ?? undefined,
            adjuntos: adjuntos.length ? adjuntos : undefined,
          });
          await this.dataSource.query(
            `UPDATE crm.campania_envio
                SET estado = 'enviado', mensaje_id = $1, enviado_en = now()
              WHERE id = $2`,
            [resultado.mensajeId, envio.id],
          );
          enviados += 1;
        } catch (e: any) {
          await this.dataSource.query(
            `UPDATE crm.campania_envio SET estado = 'fallido', motivo = $1 WHERE id = $2`,
            [String(e?.message ?? e).slice(0, 300), envio.id],
          );
          fallidos += 1;
        }
      }

      // La pausa entre tandas no es cortesía: los proveedores limitan por
      // segundo, y un dominio nuevo que dispara miles de correos seguidos
      // acaba en listas de spam.
      if (tanda.length === TANDA) await new Promise((r) => setTimeout(r, PAUSA_MS));
    }

    await this.dataSource.query(
      `UPDATE crm.campania SET estado = 'enviada', terminada_en = now() WHERE id = $1`,
      [id],
    );

    this.log.log(`Campaña ${id}: ${enviados} enviados, ${fallidos} fallidos`);
    return this.obtener(id);
  }

  // -------------------------------------------------------------- plantillas

  /**
   * Las plantillas, opcionalmente las de un producto.
   *
   * Filtrar por producto es el caso normal: el gestor comercial entrega una
   * lista diciendo qué se le ofrece a esa gente, y lo que se les escribe sale
   * de ahí. Tener que buscar entre todas las plantillas de todas las unidades
   * es cómo se manda el correo de contabilidad a una lista de auditoría.
   */
  async plantillas(producto?: string) {
    const params: any[] = [];
    let filtro = 'WHERE p.activa';
    if (producto) {
      params.push(producto);
      filtro += ` AND p.producto = $${params.length}`;
    }
    return this.dataSource.query(
      `SELECT p.*, pr.nombre AS producto_nombre, m.nombre AS marca_nombre
         FROM crm.plantilla_correo p
         LEFT JOIN producto pr ON pr.codigo = p.producto
         LEFT JOIN crm.marca m ON m.codigo = p.marca
        ${filtro}
        ORDER BY pr.nombre NULLS LAST, p.nombre`,
      params,
    );
  }

  async crearPlantilla(datos: Record<string, any>, usuario: string) {
    const problemas = problemasDeCampania(datos);
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const res = await this.dataSource.query(
      `INSERT INTO crm.plantilla_correo (nombre, asunto, cuerpo, producto, marca, remitente, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        datos.nombre ?? datos.asunto,
        datos.asunto,
        datos.cuerpo,
        datos.producto ?? null,
        datos.marca ?? null,
        datos.remitente ?? null,
        usuario,
      ],
    );
    const id = (Array.isArray(res[0]) ? res[0][0] : res[0]).id;
    return (await this.plantillas()).find((p: any) => String(p.id) === String(id));
  }

  async editarPlantilla(id: number, datos: Record<string, any>) {
    const actual = (
      await this.dataSource.query(`SELECT * FROM crm.plantilla_correo WHERE id = $1`, [id])
    )[0];
    if (!actual) throw new NotFoundException(`No existe la plantilla ${id}`);

    const mezcla = { ...actual, ...datos };
    const problemas = problemasDeCampania(mezcla);
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    await this.dataSource.query(
      `UPDATE crm.plantilla_correo
          SET nombre = $1, asunto = $2, cuerpo = $3, producto = $4, marca = $5,
              remitente = $6, activa = $7, actualizada_en = now()
        WHERE id = $8`,
      [
        mezcla.nombre,
        mezcla.asunto,
        mezcla.cuerpo,
        mezcla.producto ?? null,
        mezcla.marca ?? null,
        mezcla.remitente ?? null,
        mezcla.activa ?? true,
        id,
      ],
    );
    return (await this.plantillas()).find((p: any) => String(p.id) === String(id));
  }

  // ---------------------------------------------------------------- adjuntos

  async adjuntos(campania: number) {
    return this.dataSource.query(
      `SELECT id, nombre, tipo, tamano, subido_por, subido_en
         FROM crm.campania_adjunto WHERE campania = $1 ORDER BY subido_en`,
      [campania],
    );
  }

  async agregarAdjunto(
    campania: number,
    archivo: { nombre: string; ruta: string; tipo?: string; tamano: number },
    usuario: string,
  ) {
    const estado = (
      await this.dataSource.query(`SELECT estado FROM crm.campania WHERE id = $1`, [campania])
    )[0];
    if (!estado) throw new NotFoundException(`No existe la campaña ${campania}`);
    // Adjuntar algo a una campaña ya enviada no cambia lo que recibieron, y
    // deja la ficha diciendo que llevaba un documento que nadie recibió.
    if (estado.estado === 'enviada' || estado.estado === 'enviando') {
      throw new BadRequestException('Esta campaña ya se envió: sus adjuntos no se pueden cambiar.');
    }

    await this.dataSource.query(
      `INSERT INTO crm.campania_adjunto (campania, nombre, ruta, tipo, tamano, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [campania, archivo.nombre, archivo.ruta, archivo.tipo ?? null, archivo.tamano, usuario],
    );
    return this.adjuntos(campania);
  }

  async quitarAdjunto(campania: number, id: number) {
    await this.dataSource.query(
      `DELETE FROM crm.campania_adjunto WHERE id = $1 AND campania = $2`,
      [id, campania],
    );
    return this.adjuntos(campania);
  }

  // ----------------------------------------------------------- consentimiento

  /**
   * Alguien se da de baja desde el enlace del correo.
   *
   * No pide identificarse y no puede pedirlo: exigir una cuenta para dejar de
   * recibir correos es, en la práctica, no dejar darse de baja. El token del
   * enlace es lo que identifica, y es por envío para que uno filtrado no sirva
   * para dar de baja a otra persona.
   */
  async darDeBaja(token: string, motivo?: string) {
    const envio = (
      await this.dataSource.query(
        `SELECT correo, tipo_sujeto, clave FROM crm.campania_envio WHERE token = $1`,
        [token],
      )
    )[0];
    if (!envio) throw new NotFoundException('Ese enlace no es válido.');

    await this.dataSource.query(
      `INSERT INTO crm.consentimiento (correo, estado, revocado_en, motivo, tipo_sujeto, clave, origen)
       VALUES ($1,'revocado',now(),$2,$3,$4,'enlace de baja')
       ON CONFLICT (correo) DO UPDATE
         SET estado = 'revocado', revocado_en = now(),
             motivo = coalesce(EXCLUDED.motivo, crm.consentimiento.motivo),
             actualizado_en = now()`,
      [envio.correo, motivo ?? null, envio.tipo_sujeto, envio.clave],
    );

    return { correo: envio.correo, estado: 'revocado' };
  }

  async registrarConsentimiento(correo: string, estado: EstadoConsentimiento, origen: string) {
    const normalizado = normalizarCorreo(correo);
    await this.dataSource.query(
      `INSERT INTO crm.consentimiento (correo, estado, origen, otorgado_en, revocado_en)
       VALUES ($1,$2,$3, CASE WHEN $2 = 'otorgado' THEN now() END, CASE WHEN $2 = 'revocado' THEN now() END)
       ON CONFLICT (correo) DO UPDATE
         SET estado = EXCLUDED.estado, origen = EXCLUDED.origen,
             otorgado_en = coalesce(EXCLUDED.otorgado_en, crm.consentimiento.otorgado_en),
             revocado_en = coalesce(EXCLUDED.revocado_en, crm.consentimiento.revocado_en),
             actualizado_en = now()`,
      [normalizado, estado, origen],
    );
    return { correo: normalizado, estado };
  }

  /** Alguien abrió el correo. Lo llama el pixel de seguimiento. */
  async marcarAbierto(token: string) {
    await this.dataSource.query(
      `UPDATE crm.campania_envio SET abierto_en = coalesce(abierto_en, now()) WHERE token = $1`,
      [token],
    );
  }

  // -------------------------------------------------------------------- privado

  /**
   * Los correos de un segmento.
   *
   * Salen del perfil comercial, que es donde están, y se excluye a quien tiene
   * estado comercial «no contactar»: esa marca vale para todo, no sólo para la
   * lista de llamadas.
   */
  private async candidatosDelSegmento(segmento: string): Promise<Destinatario[]> {
    return this.dataSource.query(
      `SELECT p.correo, p.nombre, p.tipo_sujeto, p.clave
         FROM segmento_miembro m
         JOIN perfil_comercial p ON p.tipo_sujeto = m.tipo_sujeto AND p.clave = m.clave
         LEFT JOIN sujeto_estado_comercial e
                ON e.tipo_sujeto = m.tipo_sujeto AND e.clave = m.clave
        WHERE m.segmento = $1
          AND p.correo IS NOT NULL AND p.correo <> ''
          AND coalesce(e.estado, '') <> 'no_contactar'`,
      [segmento],
    ).then((filas: any[]) =>
      filas.map((f) => ({
        correo: f.correo,
        nombre: f.nombre,
        tipoSujeto: f.tipo_sujeto,
        clave: f.clave,
      })),
    );
  }

  private async consentimientosDe(correos: string[]): Promise<Map<string, EstadoConsentimiento>> {
    if (correos.length === 0) return new Map();

    const normalizados = [...new Set(correos.map(normalizarCorreo).filter(Boolean))];
    const filas = await this.dataSource.query(
      `SELECT correo, estado FROM crm.consentimiento WHERE correo = ANY($1)`,
      [normalizados],
    );
    return new Map(filas.map((f: any) => [f.correo, f.estado]));
  }

  private enlaceDeBaja(token: string): string {
    const base = process.env.CRM_URL_PUBLICA ?? 'http://localhost:3001';
    return `${base}/crm/campanias/baja/${token}`;
  }
}
