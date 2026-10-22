import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsappConector } from './whatsapp.conector';
import {
  estadoVentana,
  normalizarTelefono,
  puedeEnviar,
  rellenarPlantilla,
  variablesDePlantilla,
} from './whatsapp.reglas';

@Injectable()
export class WhatsappService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly conector: WhatsappConector,
  ) {}

  /** Si los mensajes salen de verdad o se quedan aquí. */
  get conectado() {
    return this.conector.real;
  }

  // -------------------------------------------------------------- la bandeja

  /**
   * Las conversaciones, como se miran: por lo último que pasó.
   *
   * Incluye el estado de la ventana de 24 horas, porque es lo que decide si
   * quien abra la conversación podrá escribir o tendrá que elegir plantilla. Se
   * calcula al listar y no al abrir: ver en la bandeja cuáles están a punto de
   * cerrarse es la diferencia entre contestar a tiempo y tener que pagar una
   * plantilla.
   */
  async bandeja(filtros: { estado?: string; asignada?: string; canal?: number } = {}) {
    const where: string[] = [];
    const params: any[] = [];

    if (filtros.estado) {
      params.push(filtros.estado);
      where.push(`c.estado = $${params.length}`);
    }
    if (filtros.asignada) {
      params.push(filtros.asignada);
      where.push(`c.asignada_a = $${params.length}`);
    }
    if (filtros.canal) {
      params.push(filtros.canal);
      where.push(`c.canal_id = $${params.length}`);
    }

    const filas = await this.dataSource.query(
      `SELECT c.*, w.nombre AS canal_nombre, w.numero AS canal_numero,
              ct.first_name, ct.last_name, e.name AS empresa,
              (SELECT m.texto FROM crm.mensaje m
                WHERE m.conversacion_id = c.id
                ORDER BY m.ocurrido_en DESC LIMIT 1) AS ultimo_texto
         FROM crm.conversacion c
         JOIN crm.canal_whatsapp w ON w.id = c.canal_id
         LEFT JOIN crm.contacto ct ON ct.id = c.contacto_id
         LEFT JOIN crm.empresa e ON e.id = c.empresa_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.ultimo_mensaje_en DESC NULLS LAST
        LIMIT 100`,
      params,
    );

    return filas.map((f: any) => ({ ...f, ventana: estadoVentana(f.ultima_entrante_en) }));
  }

  async conversacion(id: number) {
    const filas = await this.dataSource.query(
      `SELECT c.*, w.nombre AS canal_nombre, w.numero AS canal_numero, w.phone_number_id
         FROM crm.conversacion c
         JOIN crm.canal_whatsapp w ON w.id = c.canal_id
        WHERE c.id = $1`,
      [id],
    );
    if (!filas[0]) throw new NotFoundException(`No existe la conversación ${id}`);

    const mensajes = await this.dataSource.query(
      `SELECT * FROM crm.mensaje WHERE conversacion_id = $1 ORDER BY ocurrido_en`,
      [id],
    );

    return {
      ...filas[0],
      ventana: estadoVentana(filas[0].ultima_entrante_en),
      mensajes,
    };
  }

  // ---------------------------------------------------------------- escribir

  /**
   * Manda un mensaje y lo deja escrito.
   *
   * El orden importa: primero se comprueba la ventana, luego se guarda como
   * `pendiente`, después se intenta enviar y al final se marca el resultado.
   * Guardar sólo si Meta responde bien dejaría sin rastro los mensajes que
   * fallan, que son justo los que alguien tiene que volver a intentar.
   */
  async enviar(
    conversacionId: number,
    datos: { texto?: string; plantilla?: string; variables?: string[] },
    usuario: string,
  ) {
    const conv = await this.conversacion(conversacionId);
    const tipo = datos.plantilla ? 'plantilla' : 'libre';

    const permiso = puedeEnviar(tipo, conv.ultima_entrante_en);
    if (!permiso.permitido) throw new BadRequestException(permiso.motivo);

    let texto = datos.texto ?? '';
    let plantillaMeta: { nombre: string; idioma: string; variables: string[] } | undefined;

    if (datos.plantilla) {
      const plantilla = (
        await this.dataSource.query(
          `SELECT * FROM crm.plantilla_whatsapp WHERE nombre = $1 AND estado = 'aprobada'`,
          [datos.plantilla],
        )
      )[0];
      if (!plantilla) {
        throw new BadRequestException(
          `La plantilla «${datos.plantilla}» no existe o Meta no la ha aprobado todavía.`,
        );
      }

      const esperadas = variablesDePlantilla(plantilla.cuerpo);
      const recibidas = datos.variables?.length ?? 0;
      if (recibidas !== esperadas) {
        // Meta rechaza el envío entero si el número no cuadra, y su error no
        // dice cuántas esperaba.
        throw new BadRequestException(
          `La plantilla «${plantilla.nombre}» necesita ${esperadas} dato(s) y llegaron ${recibidas}.`,
        );
      }

      texto = rellenarPlantilla(plantilla.cuerpo, datos.variables ?? []);
      plantillaMeta = {
        nombre: plantilla.nombre,
        idioma: plantilla.idioma,
        variables: datos.variables ?? [],
      };
    }

    if (!texto.trim()) throw new BadRequestException('El mensaje está vacío.');

    const guardado = (
      await this.dataSource.query(
        `INSERT INTO crm.mensaje (conversacion_id, direccion, tipo, texto, plantilla, enviado_por)
         VALUES ($1, 'saliente', $2, $3, $4, $5) RETURNING id`,
        [conversacionId, datos.plantilla ? 'plantilla' : 'texto', texto, datos.plantilla ?? null, usuario],
      )
    )[0];
    const mensajeId = Array.isArray(guardado) ? guardado[0].id : guardado.id;

    try {
      const envio = await this.conector.enviar({
        para: normalizarTelefono(conv.telefono),
        phoneNumberId: conv.phone_number_id,
        texto,
        plantilla: plantillaMeta,
      });

      await this.dataSource.query(
        `UPDATE crm.mensaje SET estado = 'enviado', wa_id = $1 WHERE id = $2`,
        [envio.waId, mensajeId],
      );
      await this.dataSource.query(
        `UPDATE crm.conversacion SET ultimo_mensaje_en = now() WHERE id = $1`,
        [conversacionId],
      );
    } catch (e: any) {
      await this.dataSource.query(
        `UPDATE crm.mensaje SET estado = 'fallido', error = $1 WHERE id = $2`,
        [String(e?.message ?? e).slice(0, 500), mensajeId],
      );
      throw new BadRequestException(`No se pudo enviar: ${e?.message ?? e}`);
    }

    return this.conversacion(conversacionId);
  }

  // ---------------------------------------------------------------- recibir

  /**
   * Un mensaje que llega de Meta.
   *
   * Es idempotente por el `wa_id`: los webhooks se reintentan, y sin eso la
   * conversación mostraría el mismo mensaje tres veces. El `ON CONFLICT` sobre
   * el índice único es lo que lo garantiza, no una comprobación previa, que no
   * cierra la carrera entre dos reintentos simultáneos.
   *
   * Ese `ON CONFLICT` lleva `WHERE wa_id IS NOT NULL` porque el índice es
   * parcial, y Postgres no lo usa para resolver el conflicto si no se repite
   * su condición: falla con «no unique constraint matching» y no guarda nada.
   * Lo que se rompía no era la deduplicación, sino la recepción entera.
   */
  async recibir(datos: {
    phoneNumberId: string;
    telefono: string;
    nombrePerfil?: string;
    waId: string;
    texto?: string;
    tipo?: string;
    media?: any;
    ocurridoEn?: Date;
  }) {
    const canal = (
      await this.dataSource.query(
        `SELECT id FROM crm.canal_whatsapp WHERE phone_number_id = $1`,
        [datos.phoneNumberId],
      )
    )[0];
    if (!canal) {
      // Llega un mensaje a un número que no está dado de alta. No es un error
      // del cliente: es que falta configurarlo, y hay que poder verlo.
      throw new NotFoundException(
        `Llegó un mensaje al número ${datos.phoneNumberId}, que no está registrado en el CRM.`,
      );
    }

    const telefono = normalizarTelefono(datos.telefono);
    const ocurrido = datos.ocurridoEn ?? new Date();

    const conv = (
      await this.dataSource.query(
        `INSERT INTO crm.conversacion (canal_id, telefono, nombre_perfil, ultima_entrante_en, ultimo_mensaje_en, sin_leer)
         VALUES ($1, $2, $3, $4, $4, 1)
         ON CONFLICT (canal_id, telefono) DO UPDATE
           SET ultima_entrante_en = EXCLUDED.ultima_entrante_en,
               ultimo_mensaje_en  = EXCLUDED.ultimo_mensaje_en,
               sin_leer = crm.conversacion.sin_leer + 1,
               nombre_perfil = coalesce(EXCLUDED.nombre_perfil, crm.conversacion.nombre_perfil),
               estado = 'abierta'
         RETURNING id`,
        [canal.id, telefono, datos.nombrePerfil ?? null, ocurrido],
      )
    )[0];
    const conversacionId = Array.isArray(conv) ? conv[0].id : conv.id;

    await this.dataSource.query(
      `INSERT INTO crm.mensaje (conversacion_id, direccion, tipo, texto, media, wa_id, estado, ocurrido_en)
       VALUES ($1, 'entrante', $2, $3, $4, $5, 'entregado', $6)
       ON CONFLICT (wa_id) WHERE wa_id IS NOT NULL DO NOTHING`,
      [
        conversacionId,
        datos.tipo ?? 'texto',
        datos.texto ?? null,
        datos.media ? JSON.stringify(datos.media) : null,
        datos.waId,
        ocurrido,
      ],
    );

    return { conversacionId };
  }

  /** El acuse de recibo que manda Meta cuando un mensaje se entrega o se lee. */
  async actualizarEstado(waId: string, estado: string, error?: string) {
    const admitidos = ['enviado', 'entregado', 'leido', 'fallido'];
    if (!admitidos.includes(estado)) return;

    await this.dataSource.query(
      `UPDATE crm.mensaje SET estado = $1, error = coalesce($2, error) WHERE wa_id = $3`,
      [estado, error ?? null, waId],
    );
  }

  async marcarLeida(conversacionId: number) {
    await this.dataSource.query(
      `UPDATE crm.conversacion SET sin_leer = 0 WHERE id = $1`,
      [conversacionId],
    );
  }

  async asignar(conversacionId: number, comercial: string | null) {
    await this.dataSource.query(
      `UPDATE crm.conversacion SET asignada_a = $1 WHERE id = $2`,
      [comercial, conversacionId],
    );
    return this.conversacion(conversacionId);
  }

  // -------------------------------------------------------------- plantillas

  async plantillas() {
    return this.dataSource.query(
      `SELECT * FROM crm.plantilla_whatsapp ORDER BY estado, nombre`,
    );
  }
}
