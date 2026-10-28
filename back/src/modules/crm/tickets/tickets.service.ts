import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CorreoConector } from '../campanias/correo.conector';
import {
  alCambiarEstado,
  CANALES,
  csat,
  csatValido,
  Estado,
  ESTADOS,
  prioridadInicial,
  PRIORIDADES,
  puedePasar,
  sla,
  slaQueManda,
  TERMINADOS,
  Tipo,
  TIPOS,
} from './tickets.reglas';

export interface DatosTicket {
  asunto?: string;
  descripcion?: string;
  tipo?: string;
  prioridad?: string;
  empresa_id?: number | null;
  contacto_id?: number | null;
  venta_id?: number | null;
  responsable?: string | null;
  solicitante_nombre?: string;
  solicitante_correo?: string;
  solicitante_telefono?: string;
}

export type Vista = 'abiertos' | 'vencidos' | 'mios' | 'esperando' | 'terminados' | 'todos';

const NOMBRE_DE_ESTADO: Record<Estado, string> = {
  abierto: 'abierto',
  en_curso: 'en curso',
  esperando_cliente: 'esperando al cliente',
  resuelto: 'resuelto',
  cerrado: 'cerrado',
};

/** El ticket tal como lo lee la pantalla: columnas, cliente y SLA calculado. */
const SELECT = `
  SELECT t.*, e.name AS empresa, e.tax_identifier AS ruc,
         nullif(trim(c.first_name || ' ' || c.last_name), '') AS contacto,
         coalesce(nullif(trim(r.first_name || ' ' || r.last_name), ''), t.responsable) AS responsable_nombre
    FROM crm.ticket t
    LEFT JOIN crm.empresa e ON e.id = t.empresa_id
    LEFT JOIN crm.contacto c ON c.id = t.contacto_id
    LEFT JOIN crm.comercial r ON r.usuario = t.responsable`;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger('Tickets');

  constructor(
    private readonly dataSource: DataSource,
    private readonly correo: CorreoConector,
  ) {}

  // ---------------------------------------------------------------- lectura

  async catalogos() {
    const [sla, comerciales] = await Promise.all([
      this.dataSource.query(
        `SELECT prioridad, horas_respuesta, horas_resolucion FROM crm.ticket_sla
          ORDER BY horas_resolucion`,
      ),
      this.dataSource.query(
        `SELECT usuario, coalesce(nullif(trim(first_name || ' ' || last_name), ''), usuario) AS nombre
           FROM crm.comercial WHERE NOT disabled ORDER BY nombre`,
      ),
    ]);
    return { tipos: TIPOS, prioridades: PRIORIDADES, estados: ESTADOS, sla, comerciales };
  }

  /**
   * La bandeja.
   *
   * Los vencidos se filtran después de calcular el SLA, no en SQL: la regla
   * del reloj (pausas, espera en curso) vive en `tickets.reglas.ts` y
   * copiarla a una consulta es tener dos definiciones de «vencido» que un día
   * dejan de coincidir.
   */
  async listar(f: { vista?: Vista; usuario?: string; q?: string; empresa?: number }) {
    const vista = f.vista ?? 'abiertos';
    const donde: string[] = [];
    const params: any[] = [];
    const p = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (vista === 'terminados') donde.push(`t.estado IN ('resuelto','cerrado')`);
    else if (vista === 'esperando') donde.push(`t.estado = 'esperando_cliente'`);
    else if (vista !== 'todos') donde.push(`t.estado NOT IN ('resuelto','cerrado')`);
    if (vista === 'mios') donde.push(`t.responsable = ${p(f.usuario ?? '')}`);
    if (f.empresa) donde.push(`t.empresa_id = ${p(f.empresa)}`);
    if (f.q?.trim()) {
      const like = p(`%${f.q.trim()}%`);
      donde.push(
        `(t.asunto ILIKE ${like} OR e.name ILIKE ${like} OR t.solicitante_nombre ILIKE ${like}
          OR t.id::text = ${p(f.q.trim().replace(/^#/, ''))})`,
      );
    }

    const filas = await this.dataSource.query(
      `${SELECT}
       ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''}
       ORDER BY t.creado_en DESC
       LIMIT 300`,
      params,
    );
    const ahora = new Date();
    const conSla = filas.map((t: any) => this.conSla(t, ahora));
    const resultado = vista === 'vencidos' ? conSla.filter((t: any) => t.sla_estado === 'incumplido') : conSla;

    // Lo más urgente arriba: incumplido, por vencer, y dentro de cada grupo lo
    // que vence antes. Ordenar por fecha de creación deja abajo el ticket de
    // hace una semana que es justo el que hay que mirar.
    const peso = { incumplido: 0, por_vencer: 1, en_plazo: 2, cumplido: 3 } as const;
    return resultado.sort(
      (a: any, b: any) =>
        peso[a.sla_estado as keyof typeof peso] - peso[b.sla_estado as keyof typeof peso] ||
        new Date(a.sla.resolucion.limite).getTime() - new Date(b.sla.resolucion.limite).getTime(),
    );
  }

  async obtener(id: number) {
    const [t] = await this.dataSource.query(`${SELECT} WHERE t.id = $1`, [id]);
    if (!t) throw new NotFoundException(`No existe el ticket #${id}`);
    const eventos = await this.dataSource.query(
      `SELECT id, tipo, texto, interna, autor, en FROM crm.ticket_evento
        WHERE ticket = $1 ORDER BY en, id`,
      [id],
    );
    // Lo anterior de ese cliente, para ver si es la cuarta vez que pide lo
    // mismo: es lo primero que hay que saber antes de contestarle.
    const anteriores = t.empresa_id
      ? await this.dataSource.query(
          `SELECT id, asunto, tipo, estado, creado_en FROM crm.ticket
            WHERE empresa_id = $1 AND id <> $2 ORDER BY creado_en DESC LIMIT 10`,
          [t.empresa_id, id],
        )
      : [];
    return { ...this.conSla(t, new Date()), eventos, anteriores };
  }

  private conSla(t: any, ahora: Date) {
    const fecha = (v: any) => (v ? new Date(v) : null);
    const s = sla(
      {
        creado_en: new Date(t.creado_en),
        horas_respuesta: t.horas_respuesta,
        horas_resolucion: t.horas_resolucion,
        pausado_seg: t.pausado_seg,
        en_espera_desde: fecha(t.en_espera_desde),
        primera_respuesta_en: fecha(t.primera_respuesta_en),
        resuelto_en: fecha(t.resuelto_en),
      },
      ahora,
    );
    // El token de la encuesta no sale en la lista: es la llave de una página
    // pública, y la lista la ve cualquiera que abra el CRM.
    const { csat_token, ...resto } = t;
    return { ...resto, sla: s, sla_estado: slaQueManda(s) };
  }

  // ---------------------------------------------------------------- crear

  async crear(datos: DatosTicket, autor: string, canal: (typeof CANALES)[number] = 'manual', extra: { conversacion_id?: number } = {}) {
    const asunto = String(datos.asunto ?? '').trim();
    if (!asunto) throw new BadRequestException('El ticket necesita un asunto.');
    const tipo = (datos.tipo ?? 'consulta') as Tipo;
    if (!TIPOS.includes(tipo)) throw new BadRequestException(`Tipo no válido. Usa: ${TIPOS.join(', ')}`);
    if (datos.prioridad && !(PRIORIDADES as readonly string[]).includes(datos.prioridad)) {
      throw new BadRequestException(`Prioridad no válida. Usa: ${PRIORIDADES.join(', ')}`);
    }
    const prioridad = prioridadInicial(tipo, datos.prioridad);

    return this.dataSource.transaction(async (m) => {
      const [politica] = await m.query(`SELECT * FROM crm.ticket_sla WHERE prioridad = $1`, [prioridad]);

      // Sin responsable explícito, el que lleva la cuenta. No siempre es
      // quien atiende soporte, pero es quien tiene que enterarse de que su
      // cliente está pidiendo algo, y un ticket sin dueño no lo mira nadie.
      let responsable = datos.responsable ?? null;
      if (responsable === null && datos.empresa_id) {
        const [e] = await m.query(`SELECT sales_id FROM crm.empresa WHERE id = $1`, [datos.empresa_id]);
        responsable = e?.sales_id ?? null;
      }
      if (responsable) await this.exigirComercial(m, responsable);

      const [t] = await m.query(
        `INSERT INTO crm.ticket
           (asunto, descripcion, tipo, prioridad, canal, empresa_id, contacto_id, venta_id,
            conversacion_id, solicitante_nombre, solicitante_correo, solicitante_telefono,
            responsable, horas_respuesta, horas_resolucion, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          asunto.slice(0, 200),
          datos.descripcion?.trim() || null,
          tipo,
          prioridad,
          canal,
          datos.empresa_id ?? null,
          datos.contacto_id ?? null,
          datos.venta_id ?? null,
          extra.conversacion_id ?? null,
          datos.solicitante_nombre?.trim() || null,
          datos.solicitante_correo?.trim().toLowerCase() || null,
          datos.solicitante_telefono?.trim() || null,
          responsable,
          politica.horas_respuesta,
          politica.horas_resolucion,
          autor,
        ],
      );
      await this.anotar(m, t.id, 'creado', `Entró por ${canal}`, autor, true);
      return { id: Number(t.id) };
    });
  }

  /**
   * Un ticket desde una conversación de WhatsApp.
   *
   * Hereda lo que la conversación ya sabe —contacto, empresa, teléfono— y toma
   * como descripción lo último que escribió el cliente, que es lo que hay que
   * atender. Si esa conversación ya tiene un ticket abierto devuelve ése: dos
   * tickets del mismo chat son dos personas contestando lo mismo.
   */
  async desdeWhatsapp(conversacion: number, autor: string, datos: DatosTicket = {}) {
    const [c] = await this.dataSource.query(
      `SELECT id, telefono, nombre_perfil, contacto_id, empresa_id FROM crm.conversacion WHERE id = $1`,
      [conversacion],
    );
    if (!c) throw new NotFoundException(`No existe la conversación ${conversacion}`);

    const [abierto] = await this.dataSource.query(
      `SELECT id FROM crm.ticket WHERE conversacion_id = $1 AND estado NOT IN ('resuelto','cerrado')
        ORDER BY id DESC LIMIT 1`,
      [conversacion],
    );
    if (abierto) return { id: Number(abierto.id), yaExistia: true };

    const ultimos: { texto: string }[] = await this.dataSource.query(
      `SELECT texto FROM crm.mensaje
        WHERE conversacion_id = $1 AND direccion = 'entrante' AND texto IS NOT NULL
        ORDER BY ocurrido_en DESC LIMIT 5`,
      [conversacion],
    );
    const descripcion = ultimos.map((u) => u.texto).reverse().join('\n\n');
    const asunto =
      datos.asunto?.trim() ||
      (ultimos[0]?.texto ? ultimos[0].texto.replace(/\s+/g, ' ').slice(0, 80) : `WhatsApp de ${c.telefono}`);

    return this.crear(
      {
        ...datos,
        asunto,
        descripcion: datos.descripcion ?? (descripcion || undefined),
        empresa_id: c.empresa_id,
        contacto_id: c.contacto_id,
        solicitante_nombre: c.nombre_perfil ?? undefined,
        solicitante_telefono: c.telefono,
      },
      autor,
      'whatsapp',
      { conversacion_id: c.id },
    );
  }

  /**
   * Lo que llega del formulario público.
   *
   * Se enlaza con la empresa sólo si el RUC coincide exacto, y con el contacto
   * sólo si el correo coincide exacto. Un parecido por nombre no basta: atar
   * una queja a la empresa equivocada es contestarle a otro cliente.
   */
  async desdeFormulario(datos: DatosTicket & { ruc?: string }) {
    const correo = datos.solicitante_correo?.trim().toLowerCase();
    if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      throw new BadRequestException('Escribe un correo válido para poder contestarte.');
    }
    let empresa_id: number | null = null;
    let contacto_id: number | null = null;
    const ruc = datos.ruc?.replace(/\D/g, '');
    if (ruc) {
      const [e] = await this.dataSource.query(
        `SELECT id FROM crm.empresa WHERE tax_identifier = $1 LIMIT 2`,
        [ruc],
      );
      empresa_id = e?.id ?? null;
    }
    const contactos = await this.dataSource.query(
      `SELECT id, company_id FROM crm.contacto
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(email_jsonb) x
                       WHERE lower(x->>'email') = $1)
        LIMIT 2`,
      [correo],
    );
    // Dos contactos con el mismo correo: no se elige uno al azar.
    if (contactos.length === 1) {
      contacto_id = contactos[0].id;
      empresa_id = empresa_id ?? contactos[0].company_id ?? null;
    }

    const tipo = (TIPOS as readonly string[]).includes(datos.tipo ?? '') ? datos.tipo : 'consulta';
    return this.crear(
      {
        asunto: datos.asunto,
        descripcion: datos.descripcion,
        tipo,
        empresa_id,
        contacto_id,
        solicitante_nombre: datos.solicitante_nombre,
        solicitante_correo: correo,
        solicitante_telefono: datos.solicitante_telefono,
      },
      'formulario',
      'formulario',
    );
  }

  // ------------------------------------------------------------ escribir

  /**
   * Anotar en el ticket.
   *
   * - `respuesta`: lo que se le dijo al cliente. La primera marca el SLA de
   *   respuesta y pone el ticket «en curso»: haber contestado es haber
   *   empezado.
   * - `nota`: interna, no la ve el cliente y no cuenta como respuesta.
   * - `cliente`: lo que dijo el cliente. Si se le estaba esperando, el reloj
   *   vuelve a correr.
   */
  async anotarEn(id: number, tipo: 'respuesta' | 'nota' | 'cliente', texto: string, autor: string) {
    texto = String(texto ?? '').trim();
    if (!texto) throw new BadRequestException('No hay nada que anotar.');
    await this.dataSource.transaction(async (m) => {
      const t = await this.bloquear(m, id);
      if (t.estado === 'cerrado') {
        throw new ConflictException('El ticket está cerrado. Si vuelve a pasar, abre otro.');
      }
      await this.anotar(m, id, tipo, texto, autor, tipo === 'nota');

      if (tipo === 'respuesta' && !t.primera_respuesta_en) {
        await m.query(`UPDATE crm.ticket SET primera_respuesta_en = now() WHERE id = $1`, [id]);
      }
      const destino: Estado | null =
        tipo === 'respuesta' && t.estado === 'abierto'
          ? 'en_curso'
          : tipo === 'cliente' && t.estado === 'esperando_cliente'
            ? 'en_curso'
            : null;
      if (destino) await this.aplicarEstado(m, t, destino, autor);
    });
    return this.obtener(id);
  }

  async cambiarEstado(id: number, estado: string, autor: string, nota?: string) {
    if (!(ESTADOS as readonly string[]).includes(estado)) {
      throw new BadRequestException(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    }
    await this.dataSource.transaction(async (m) => {
      const t = await this.bloquear(m, id);
      if (t.estado === estado) return;
      if (!puedePasar(t.estado, estado as Estado)) {
        throw new BadRequestException(
          `Un ticket ${NOMBRE_DE_ESTADO[t.estado as Estado]} no pasa a ${NOMBRE_DE_ESTADO[estado as Estado]}.`,
        );
      }
      // Resolver sin haber contestado nunca es cerrar algo que el cliente no
      // sabe que se resolvió. Se exige la respuesta, que es también lo que
      // le cuenta qué se hizo.
      if (estado === 'resuelto' && !t.primera_respuesta_en) {
        throw new BadRequestException('Antes de resolverlo, anota qué se le respondió al cliente.');
      }
      await this.aplicarEstado(m, t, estado as Estado, autor, nota);
    });
    return this.obtener(id);
  }

  private async aplicarEstado(m: EntityManager, t: any, a: Estado, autor: string, nota?: string) {
    const cambios = alCambiarEstado(
      {
        estado: t.estado,
        pausado_seg: t.pausado_seg,
        en_espera_desde: t.en_espera_desde ? new Date(t.en_espera_desde) : null,
        resuelto_en: t.resuelto_en ? new Date(t.resuelto_en) : null,
        cerrado_en: t.cerrado_en ? new Date(t.cerrado_en) : null,
        reabierto: t.reabierto,
      },
      a,
      new Date(),
    );
    const columnas = Object.keys(cambios);
    await m.query(
      `UPDATE crm.ticket SET ${columnas.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [t.id, ...columnas.map((c) => (cambios as any)[c])],
    );
    const texto = `De «${NOMBRE_DE_ESTADO[t.estado as Estado]}» a «${NOMBRE_DE_ESTADO[a]}»${nota?.trim() ? `: ${nota.trim()}` : ''}`;
    await this.anotar(m, t.id, 'estado', texto, autor, true);
    Object.assign(t, cambios);
  }

  /** Prioridad, responsable, tipo y a qué cliente pertenece. */
  async actualizar(id: number, datos: DatosTicket, autor: string) {
    await this.dataSource.transaction(async (m) => {
      const t = await this.bloquear(m, id);

      if (datos.prioridad !== undefined && datos.prioridad !== t.prioridad) {
        if (!(PRIORIDADES as readonly string[]).includes(datos.prioridad)) {
          throw new BadRequestException(`Prioridad no válida. Usa: ${PRIORIDADES.join(', ')}`);
        }
        // Cambiar la prioridad cambia lo prometido, y se mide con lo nuevo
        // desde la creación: subir a urgente un ticket de hace dos días lo
        // deja incumplido en el acto, que es exactamente lo que es.
        const [politica] = await m.query(`SELECT * FROM crm.ticket_sla WHERE prioridad = $1`, [datos.prioridad]);
        await m.query(
          `UPDATE crm.ticket SET prioridad = $2, horas_respuesta = $3, horas_resolucion = $4 WHERE id = $1`,
          [id, datos.prioridad, politica.horas_respuesta, politica.horas_resolucion],
        );
        await this.anotar(m, id, 'prioridad', `Prioridad de ${t.prioridad} a ${datos.prioridad}`, autor, true);
      }

      if (datos.tipo !== undefined && datos.tipo !== t.tipo) {
        if (!(TIPOS as readonly string[]).includes(datos.tipo)) {
          throw new BadRequestException(`Tipo no válido. Usa: ${TIPOS.join(', ')}`);
        }
        await m.query(`UPDATE crm.ticket SET tipo = $2 WHERE id = $1`, [id, datos.tipo]);
        await this.anotar(m, id, 'nota', `Tipo de ${t.tipo} a ${datos.tipo}`, autor, true);
      }

      if (datos.responsable !== undefined && (datos.responsable || null) !== t.responsable) {
        if (datos.responsable) await this.exigirComercial(m, datos.responsable);
        await m.query(`UPDATE crm.ticket SET responsable = $2 WHERE id = $1`, [id, datos.responsable || null]);
        await this.anotar(
          m,
          id,
          'asignado',
          datos.responsable ? `Asignado a ${datos.responsable}` : 'Sin responsable',
          autor,
          true,
        );
      }

      const enlaces = (['empresa_id', 'contacto_id', 'venta_id'] as const).filter(
        (c) => datos[c] !== undefined && (datos[c] ?? null) !== (t[c] === null ? null : Number(t[c])),
      );
      if (enlaces.length) {
        await m.query(
          `UPDATE crm.ticket SET ${enlaces.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...enlaces.map((c) => datos[c] ?? null)],
        );
        if (enlaces.includes('empresa_id')) {
          const [e] = datos.empresa_id
            ? await m.query(`SELECT name FROM crm.empresa WHERE id = $1`, [datos.empresa_id])
            : [];
          await this.anotar(m, id, 'cliente', e ? `Enlazado a ${e.name}` : 'Sin cliente enlazado', autor, true);
        }
      }
    });
    return this.obtener(id);
  }

  // ------------------------------------------------------------------ CSAT

  /**
   * Mandar la encuesta de satisfacción de este ticket.
   *
   * La manda una persona, no el sistema al resolver: resolver a veces es
   * «el cliente dejó de contestar», y preguntarle qué tal le atendimos ahí es
   * echar sal en la herida.
   */
  async enviarCsat(id: number, enlaceBase: string, autor: string) {
    const [t] = await this.dataSource.query(
      `SELECT t.id, t.asunto, t.estado, t.csat_token, t.csat_en,
              coalesce(t.solicitante_correo,
                       (SELECT x->>'email' FROM crm.contacto c, jsonb_array_elements(c.email_jsonb) x
                         WHERE c.id = t.contacto_id LIMIT 1)) AS correo
         FROM crm.ticket t WHERE t.id = $1`,
      [id],
    );
    if (!t) throw new NotFoundException(`No existe el ticket #${id}`);
    if (!TERMINADOS.includes(t.estado)) {
      throw new BadRequestException('Se pregunta qué tal fue cuando el ticket está resuelto.');
    }
    if (t.csat_en) throw new ConflictException('El cliente ya contestó la encuesta de este ticket.');
    if (!t.correo) throw new BadRequestException('El ticket no tiene un correo a donde mandarla.');

    const enlace = `${enlaceBase}/crm/tickets/csat/${t.csat_token}`;
    const resultado = await this.correo.enviar({
      para: t.correo,
      asunto: `¿Resolvimos tu solicitud #${t.id}?`,
      cuerpo: [
        `<p>Hola:</p>`,
        `<p>Dimos por resuelta tu solicitud <strong>#${t.id} — ${escaparHtml(t.asunto)}</strong>.</p>`,
        `<p>¿Qué tal te atendimos? Es una sola pregunta.</p>`,
        `<p><a href="${enlace}">Contestar</a></p>`,
      ].join('\n'),
    });
    await this.dataSource.query(
      `UPDATE crm.ticket SET csat_enviada_en = coalesce(csat_enviada_en, now()) WHERE id = $1`,
      [id],
    );
    await this.anotar(this.dataSource.manager, id, 'csat', `Encuesta enviada a ${t.correo}`, autor, true);
    this.logger.log(`Encuesta del ticket ${id} enviada (${resultado.mensajeId})`);
    return { enlace, simulado: resultado.simulado };
  }

  async csatPorToken(token: string) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new NotFoundException();
    const [t] = await this.dataSource.query(
      `SELECT id, asunto, csat_puntaje, csat_en FROM crm.ticket WHERE csat_token = $1`,
      [token],
    );
    if (!t) throw new NotFoundException();
    return t;
  }

  async responderCsat(token: string, puntaje: number, comentario?: string) {
    if (!csatValido(puntaje)) throw new BadRequestException('Elige una opción del 1 al 5.');
    const t = await this.csatPorToken(token);
    if (t.csat_en) throw new ConflictException('Ya habías contestado. Gracias.');
    await this.dataSource.transaction(async (m) => {
      await m.query(
        `UPDATE crm.ticket SET csat_puntaje = $2, csat_comentario = $3, csat_en = now()
          WHERE id = $1 AND csat_en IS NULL`,
        [t.id, puntaje, comentario?.trim().slice(0, 2000) || null],
      );
      await this.anotar(
        m,
        t.id,
        'csat',
        `Satisfacción ${puntaje}/5${comentario?.trim() ? `: ${comentario.trim()}` : ''}`,
        'cliente',
        false,
      );
    });
  }

  // ---------------------------------------------------------------- resumen

  /**
   * Los indicadores del módulo 11: abiertos, vencidos, tiempos medios,
   * cumplimiento del SLA y satisfacción.
   *
   * Los tiempos y el cumplimiento se miden sobre lo **resuelto** en el
   * periodo, no sobre lo abierto: un ticket sin resolver todavía no tiene
   * tiempo de resolución, y contarlo como cero mejoraría el promedio justo
   * cuando hay más trabajo atrasado.
   */
  async resumen(dias = 30) {
    const abiertos = await this.listar({ vista: 'abiertos' });
    const resueltos = await this.dataSource.query(
      `SELECT t.*, extract(epoch FROM (t.primera_respuesta_en - t.creado_en)) / 60 AS min_respuesta,
              (extract(epoch FROM (t.resuelto_en - t.creado_en)) - t.pausado_seg) / 60 AS min_resolucion
         FROM crm.ticket t
        WHERE t.resuelto_en >= now() - make_interval(days => $1)`,
      [dias],
    );
    const ahora = new Date();
    const medidos = resueltos.map((t: any) => this.conSla(t, ahora));
    const media = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const cumplidos = medidos.filter((t: any) => t.sla.resolucion.estado === 'cumplido').length;
    const respondidos = medidos.filter((t: any) => t.primera_respuesta_en);
    const respuestasATiempo = respondidos.filter((t: any) => t.sla.respuesta.estado === 'cumplido').length;

    const csats = await this.dataSource.query(
      `SELECT csat_puntaje FROM crm.ticket
        WHERE csat_en >= now() - make_interval(days => $1)`,
      [dias],
    );

    const porTipo: Record<string, number> = {};
    for (const t of abiertos) porTipo[t.tipo] = (porTipo[t.tipo] ?? 0) + 1;

    return {
      dias,
      abiertos: abiertos.length,
      vencidos: abiertos.filter((t: any) => t.sla_estado === 'incumplido').length,
      porVencer: abiertos.filter((t: any) => t.sla_estado === 'por_vencer').length,
      sinResponsable: abiertos.filter((t: any) => !t.responsable).length,
      esperandoCliente: abiertos.filter((t: any) => t.estado === 'esperando_cliente').length,
      porTipo,
      resueltos: medidos.length,
      minutosRespuesta: media(
        resueltos.filter((t: any) => t.min_respuesta !== null).map((t: any) => Number(t.min_respuesta)),
      ),
      minutosResolucion: media(resueltos.map((t: any) => Number(t.min_resolucion))),
      slaCumplido: medidos.length ? Math.round((cumplidos / medidos.length) * 100) : null,
      respuestaATiempo: respondidos.length
        ? Math.round((respuestasATiempo / respondidos.length) * 100)
        : null,
      reabiertos: resueltos.filter((t: any) => t.reabierto > 0).length,
      csat: csat(csats.map((c: any) => Number(c.csat_puntaje))),
    };
  }

  // ---------------------------------------------------------------- piezas

  private async bloquear(m: EntityManager, id: number) {
    const [t] = await m.query(`SELECT * FROM crm.ticket WHERE id = $1 FOR UPDATE`, [id]);
    if (!t) throw new NotFoundException(`No existe el ticket #${id}`);
    return t;
  }

  private async exigirComercial(m: EntityManager, usuario: string) {
    const [c] = await m.query(`SELECT 1 FROM crm.comercial WHERE usuario = $1 AND NOT disabled`, [usuario]);
    if (!c) throw new BadRequestException(`«${usuario}» no es un comercial activo del CRM.`);
  }

  private anotar(m: EntityManager, ticket: number, tipo: string, texto: string, autor: string, interna: boolean) {
    return m.query(
      `INSERT INTO crm.ticket_evento (ticket, tipo, texto, interna, autor) VALUES ($1,$2,$3,$4,$5)`,
      [ticket, tipo, texto, interna, autor],
    );
  }
}

export function escaparHtml(texto: unknown): string {
  return String(texto ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
