import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { diaLocal } from '../agenda/agenda.reglas';
import { CorreoConector } from '../campanias/correo.conector';
import { CrmService } from '../crm.service';
import {
  fechaDeRenovacion,
  renovacionesQueTocan,
  resumirEncuestas,
  type Periodicidad,
} from './postventa.reglas';

@Injectable()
export class PostventaService {
  private readonly logger = new Logger('Postventa');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly correo: CorreoConector,
    private readonly crm: CrmService,
  ) {}

  // ------------------------------------------------------------ encuestas

  /**
   * Prepara la encuesta de una venta.
   *
   * Una viva por venta: dos enlaces en el buzón del cliente son dos encuestas
   * que cuentan como una sola respuesta, y la segunda se queda sin contestar
   * para siempre ensuciando el recuento.
   */
  async crearEncuesta(venta: number, usuario: string, correo?: string) {
    const fila = (
      await this.dataSource.query(
        `SELECT v.id, v.razon_social, p.correo AS correo_proforma
           FROM crm.venta v
           LEFT JOIN crm.proforma p ON p.id = v.proforma
          WHERE v.id = $1`,
        [venta],
      )
    )[0];
    if (!fila) throw new NotFoundException(`No existe la venta ${venta}`);

    try {
      const creada = (
        await this.dataSource.query(
          `INSERT INTO crm.encuesta (venta, correo, creada_por)
           VALUES ($1,$2,$3) RETURNING *`,
          [venta, correo ?? fila.correo_proforma ?? null, usuario],
        )
      )[0];
      return creada;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException('Esa venta ya tiene una encuesta sin contestar.');
      }
      throw e;
    }
  }

  async enviarEncuesta(id: number, enlaceBase: string) {
    const encuesta = (
      await this.dataSource.query(
        `SELECT e.*, v.razon_social, v.producto
           FROM crm.encuesta e JOIN crm.venta v ON v.id = e.venta
          WHERE e.id = $1`,
        [id],
      )
    )[0];
    if (!encuesta) throw new NotFoundException(`No existe la encuesta ${id}`);
    if (!encuesta.correo) throw new BadRequestException('La encuesta no tiene correo a donde ir.');
    if (encuesta.respondida_en) {
      throw new ConflictException('Esa encuesta ya está contestada.');
    }

    const enlace = `${enlaceBase}/crm/postventa/encuesta/${encuesta.token}`;
    const resultado = await this.correo.enviar({
      para: encuesta.correo,
      asunto: '¿Qué tal vamos?',
      cuerpo: [
        `<p>Hola:</p>`,
        `<p>Nos gustaría saber qué tal ha ido el servicio. Es una sola pregunta y se contesta en diez segundos.</p>`,
        `<p><a href="${enlace}">Contestar la encuesta</a></p>`,
      ].join('\n'),
    });

    await this.dataSource.query(
      `UPDATE crm.encuesta SET enviada_en = coalesce(enviada_en, now()) WHERE id = $1`,
      [id],
    );

    this.logger.log(`Encuesta ${id} enviada (${resultado.mensajeId})`);
    return { enlace, simulado: resultado.simulado };
  }

  /** Lo que ve el cliente al abrir su enlace. */
  async encuestaPorToken(token: string) {
    const filas = await this.dataSource.query(
      `SELECT e.*, v.razon_social, m.nombre AS marca
         FROM crm.encuesta e
         JOIN crm.venta v ON v.id = e.venta
         LEFT JOIN crm.marca m ON m.codigo = v.marca
        WHERE e.token = $1`,
      [token],
    );
    if (!filas[0]) throw new NotFoundException('Ese enlace no corresponde a ninguna encuesta.');

    if (!filas[0].vista_en) {
      await this.dataSource.query(
        `UPDATE crm.encuesta SET vista_en = now() WHERE id = $1 AND vista_en IS NULL`,
        [filas[0].id],
      );
    }
    return filas[0];
  }

  /**
   * La respuesta del cliente.
   *
   * El comentario es opcional pero se pide siempre: el número dice que algo va
   * mal y el comentario dice qué, y sin él un 6 obliga a llamar para preguntar
   * lo que la persona ya había escrito si le hubieran dejado.
   */
  async responder(token: string, puntaje: number, comentario?: string, quien?: string) {
    if (!Number.isInteger(puntaje) || puntaje < 0 || puntaje > 10) {
      throw new BadRequestException('El puntaje va del 0 al 10.');
    }

    const encuesta = await this.encuestaPorToken(token);
    if (encuesta.respondida_en) {
      throw new ConflictException('Esta encuesta ya fue contestada. Gracias.');
    }

    const filas = await this.dataSource.query(
      `UPDATE crm.encuesta
          SET puntaje = $2, comentario = $3, respondida_por = $4, respondida_en = now()
        WHERE id = $1
       RETURNING *`,
      [encuesta.id, puntaje, comentario?.trim() || null, quien?.trim() || null],
    );

    // Queda también en el historial de la venta, que es donde lo mira quien
    // la lleva: una encuesta guardada aparte es una encuesta que nadie lee.
    await this.dataSource.query(
      `INSERT INTO crm.interaccion (canal, direccion, oportunidad, resultado, texto, autor)
       SELECT 'correo', 'entrante', v.oportunidad, 'encuesta',
              $2 || '/10' || coalesce(' · ' || $3, ''), coalesce($4, 'el cliente')
         FROM crm.venta v WHERE v.id = $1`,
      [encuesta.venta, puntaje, comentario?.trim() || null, quien?.trim() || null],
    );

    return filas[0];
  }

  async encuestas() {
    const filas = await this.dataSource.query(
      `SELECT e.id, e.venta, e.puntaje, e.comentario, e.respondida_por,
              e.enviada_en, e.vista_en, e.respondida_en, e.correo, e.token,
              v.razon_social, v.producto, v.comercial, pr.nombre AS producto_nombre
         FROM crm.encuesta e
         JOIN crm.venta v ON v.id = e.venta
         LEFT JOIN producto pr ON pr.codigo = v.producto
        ORDER BY coalesce(e.respondida_en, e.enviada_en, e.creada_en) DESC
        LIMIT 200`,
    );
    return { resumen: resumirEncuestas(filas), encuestas: filas };
  }

  // --------------------------------------------------------- renovaciones

  /**
   * Las renovaciones que hay que mirar.
   *
   * Se calcula al preguntar y no hay ningún proceso nocturno: un programador
   * que corre de madrugada es una pieza que se cae en silencio y nadie lo nota
   * hasta que pasan tres meses sin avisos.
   */
  async renovaciones(dias = 45) {
    const ventas = await this.dataSource.query(
      `SELECT v.id, v.razon_social, v.producto, v.comercial, v.estado,
              v.monto::float8 AS monto, v.periodicidad,
              to_char(v.renueva_en, 'YYYY-MM-DD') AS renueva_en,
              v.renovada_en, v.renovacion_de,
              pr.nombre AS producto_nombre, emp.id AS empresa,
              emp.tipo_sujeto, emp.clave, v.marca
         FROM crm.venta v
         LEFT JOIN producto pr ON pr.codigo = v.producto
         LEFT JOIN crm.empresa emp ON emp.id = v.company_id
        WHERE v.renueva_en IS NOT NULL`,
    );
    return renovacionesQueTocan(ventas, diaLocal(), dias);
  }

  /**
   * Abre la oportunidad de la renovación.
   *
   * Se abre una oportunidad normal, no una venta directa: renovar se negocia
   * —el precio sube, el cliente pide algo distinto— y darla por hecha haría
   * que el embudo contara como ganado algo que todavía hay que trabajar.
   *
   * La venta vieja queda marcada como renovada, para que deje de avisar; la
   * nueva, cuando se gane, apuntará a ella.
   */
  async renovar(venta: number, usuario: string) {
    const fila = (
      await this.dataSource.query(
        `SELECT v.*, emp.tipo_sujeto, emp.clave, pr.nombre AS producto_nombre
           FROM crm.venta v
           LEFT JOIN crm.empresa emp ON emp.id = v.company_id
           LEFT JOIN producto pr ON pr.codigo = v.producto
          WHERE v.id = $1`,
        [venta],
      )
    )[0];
    if (!fila) throw new NotFoundException(`No existe la venta ${venta}`);
    if (fila.renovada_en) throw new ConflictException('Esa venta ya se renovó.');

    const oportunidad = await this.crm.abrir(
      {
        tipoSujeto: fila.tipo_sujeto,
        clave: fila.clave,
        empresaId: fila.company_id,
        producto: fila.producto,
        marca: fila.marca,
        monto: Number(fila.monto),
        nombre: `Renovación · ${fila.producto_nombre ?? fila.producto}`,
      } as any,
      usuario,
    );

    await this.dataSource.query(
      `UPDATE crm.venta SET renovada_en = now() WHERE id = $1`,
      [venta],
    );

    return { oportunidad, venta };
  }

  /** Corrige a mano la fecha de renovación, o la pone donde no la había. */
  async fijarRenovacion(venta: number, periodicidad: Periodicidad | null, desde?: string) {
    const fecha = periodicidad ? fechaDeRenovacion(periodicidad, desde ?? diaLocal()) : null;

    const filas = await this.dataSource.query(
      `UPDATE crm.venta SET periodicidad = $2, renueva_en = $3::date WHERE id = $1
       RETURNING id, periodicidad, to_char(renueva_en, 'YYYY-MM-DD') AS renueva_en`,
      [venta, periodicidad, fecha],
    );
    if (!filas[0]) throw new NotFoundException(`No existe la venta ${venta}`);
    return filas[0];
  }

  /** El panel: qué toca renovar, cómo va el NPS y qué encuestas faltan. */
  async resumen(dias = 45) {
    const [renovaciones, encuestas, sinEncuesta] = await Promise.all([
      this.renovaciones(dias),
      this.encuestas(),
      this.dataSource.query(
        `SELECT v.id, v.razon_social, v.producto, v.comercial, v.cobrada_en,
                pr.nombre AS producto_nombre
           FROM crm.venta v
           LEFT JOIN producto pr ON pr.codigo = v.producto
          WHERE v.estado = 'cobrada' AND v.anulada_en IS NULL
            AND NOT EXISTS (SELECT 1 FROM crm.encuesta e WHERE e.venta = v.id)
          ORDER BY v.cobrada_en DESC NULLS LAST
          LIMIT 50`,
      ),
    ]);

    return {
      renovaciones,
      nps: encuestas.resumen,
      encuestas: encuestas.encuestas,
      sinEncuesta,
    };
  }
}
