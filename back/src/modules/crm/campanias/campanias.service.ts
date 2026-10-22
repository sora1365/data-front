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

  async crear(datos: Record<string, any>, usuario: string) {
    const problemas = problemasDeCampania(datos);
    if (problemas.length) throw new BadRequestException(problemas.join(' '));

    const res = await this.dataSource.query(
      `INSERT INTO crm.campania (nombre, marca, segmento, producto, asunto, cuerpo, remitente, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        datos.nombre ?? datos.asunto,
        datos.marca ?? null,
        datos.segmento ?? null,
        datos.producto ?? null,
        datos.asunto,
        datos.cuerpo,
        datos.remitente ?? null,
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
