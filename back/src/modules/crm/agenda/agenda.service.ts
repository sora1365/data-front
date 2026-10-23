import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  conflictos,
  diaLocal,
  diasDeLaSemana,
  franjaValida,
  huecosLibres,
  repartirTareasPorDia,
} from './agenda.reglas';

export interface DatosEvento {
  calendario: number;
  titulo: string;
  descripcion?: string;
  lugar?: string;
  inicio: string;
  fin: string;
  todoElDia?: boolean;
  importante?: boolean;
  empresaId?: number | null;
  contactoId?: number | null;
  oportunidadId?: number | null;
  /** La tarea a la que sirve esta cita, si se reservó la hora para una. */
  tareaId?: number | null;
  participantes?: string[];
}

@Injectable()
export class AgendaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ------------------------------------------------------------- calendarios

  /**
   * Los calendarios que alguien puede ver.
   *
   * Un calendario al que no se pertenece no aparece: compartir es un acto
   * explícito, y una agenda que enseña todas las de la empresa a todo el mundo
   * deja de poder usarse para nada personal.
   */
  async calendarios(usuario: string) {
    return this.dataSource.query(
      `SELECT c.*, m.puede_editar,
              (SELECT count(*)::int FROM crm.calendario_miembro x WHERE x.calendario = c.id) AS miembros
         FROM crm.calendario c
         JOIN crm.calendario_miembro m ON m.calendario = c.id AND m.usuario = $1
        WHERE c.activo
        ORDER BY c.nombre`,
      [usuario],
    );
  }

  async crearCalendario(
    datos: { nombre: string; descripcion?: string; color?: string; marca?: string },
    usuario: string,
  ) {
    await this.asegurarComercial(usuario);

    const res = await this.dataSource.query(
      `INSERT INTO crm.calendario (nombre, descripcion, color, marca, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [datos.nombre, datos.descripcion ?? null, datos.color ?? '#1e3a5f', datos.marca ?? null, usuario],
    );
    const id = (Array.isArray(res[0]) ? res[0][0] : res[0]).id;

    // Quien lo crea queda dentro y puede editar. Si no, acabaría de crear un
    // calendario que no puede ver.
    await this.dataSource.query(
      `INSERT INTO crm.calendario_miembro (calendario, usuario, puede_editar) VALUES ($1,$2,true)`,
      [id, usuario],
    );

    return this.calendario(Number(id), usuario);
  }

  async calendario(id: number, usuario: string) {
    const filas = await this.dataSource.query(
      `SELECT c.*, m.puede_editar
         FROM crm.calendario c
         JOIN crm.calendario_miembro m ON m.calendario = c.id AND m.usuario = $2
        WHERE c.id = $1`,
      [id, usuario],
    );
    if (!filas[0]) {
      // Mismo mensaje tanto si no existe como si no se comparte: decir «existe
      // pero no es tuyo» ya revela que hay un calendario ahí.
      throw new NotFoundException(`No existe el calendario ${id} o no está compartido contigo.`);
    }
    return filas[0];
  }

  async compartir(calendarioId: number, con: string, puedeEditar: boolean, usuario: string) {
    const cal = await this.calendario(calendarioId, usuario);
    if (!cal.puede_editar) {
      throw new ForbiddenException('Sólo quien puede editar el calendario puede compartirlo.');
    }
    await this.asegurarComercial(con);

    await this.dataSource.query(
      `INSERT INTO crm.calendario_miembro (calendario, usuario, puede_editar)
       VALUES ($1,$2,$3)
       ON CONFLICT (calendario, usuario) DO UPDATE SET puede_editar = EXCLUDED.puede_editar`,
      [calendarioId, con, puedeEditar],
    );

    return this.miembros(calendarioId, usuario);
  }

  async miembros(calendarioId: number, usuario: string) {
    await this.calendario(calendarioId, usuario);
    return this.dataSource.query(
      `SELECT m.usuario, m.puede_editar, c.first_name, c.last_name
         FROM crm.calendario_miembro m
         JOIN crm.comercial c ON c.usuario = m.usuario
        WHERE m.calendario = $1
        ORDER BY c.first_name`,
      [calendarioId],
    );
  }

  // ----------------------------------------------------------------- eventos

  /**
   * Los eventos de un rango, de los calendarios que se pidan.
   *
   * Los filtros son por calendario y no por persona porque así se mira una
   * agenda compartida: «enséñame comercial y visitas, esconde el resto». Sin
   * calendarios pedidos se devuelven todos los que la persona ve, que es lo
   * que quiere al abrir la pantalla.
   */
  async eventos(
    usuario: string,
    desde: string,
    hasta: string,
    calendarios?: number[],
  ) {
    const params: any[] = [usuario, desde, hasta];
    let filtro = '';
    if (calendarios?.length) {
      params.push(calendarios);
      filtro = `AND e.calendario = ANY($${params.length})`;
    }

    return this.dataSource.query(
      `SELECT e.*, c.nombre AS calendario_nombre, c.color AS calendario_color,
              emp.name AS empresa, ct.first_name AS contacto_nombre,
              coalesce(
                (SELECT json_agg(json_build_object('usuario', p.usuario, 'estado', p.estado))
                   FROM crm.evento_participante p WHERE p.evento = e.id),
                '[]'::json
              ) AS participantes
         FROM crm.evento e
         JOIN crm.calendario c ON c.id = e.calendario
         JOIN crm.calendario_miembro m ON m.calendario = c.id AND m.usuario = $1
         LEFT JOIN crm.empresa emp ON emp.id = e.empresa_id
         LEFT JOIN crm.contacto ct ON ct.id = e.contacto_id
        WHERE e.inicio < $3 AND e.fin > $2 ${filtro}
        ORDER BY e.inicio`,
      params,
    );
  }

  async crearEvento(datos: DatosEvento, usuario: string) {
    const cal = await this.calendario(datos.calendario, usuario);
    if (!cal.puede_editar) {
      throw new ForbiddenException('No puedes añadir eventos a este calendario.');
    }

    const problema = franjaValida(datos.inicio, datos.fin);
    if (problema) throw new BadRequestException(problema);

    const res = await this.dataSource.query(
      `INSERT INTO crm.evento
         (calendario, titulo, descripcion, lugar, inicio, fin, todo_el_dia, importante,
          empresa_id, contacto_id, oportunidad_id, tarea_id, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        datos.calendario,
        datos.titulo,
        datos.descripcion ?? null,
        datos.lugar ?? null,
        datos.inicio,
        datos.fin,
        datos.todoElDia ?? false,
        datos.importante ?? false,
        datos.empresaId ?? null,
        datos.contactoId ?? null,
        datos.oportunidadId ?? null,
        datos.tareaId ?? null,
        usuario,
      ],
    );
    const id = (Array.isArray(res[0]) ? res[0][0] : res[0]).id;

    for (const participante of datos.participantes ?? []) {
      await this.dataSource.query(
        `INSERT INTO crm.evento_participante (evento, usuario) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [id, participante],
      );
    }

    return this.evento(Number(id), usuario);
  }

  async evento(id: number, usuario: string) {
    const filas = await this.dataSource.query(
      `SELECT e.*, c.nombre AS calendario_nombre, c.color AS calendario_color, m.puede_editar
         FROM crm.evento e
         JOIN crm.calendario c ON c.id = e.calendario
         JOIN crm.calendario_miembro m ON m.calendario = c.id AND m.usuario = $2
        WHERE e.id = $1`,
      [id, usuario],
    );
    if (!filas[0]) throw new NotFoundException(`No existe el evento ${id} o no lo puedes ver.`);

    const participantes = await this.dataSource.query(
      `SELECT p.usuario, p.estado, c.first_name, c.last_name
         FROM crm.evento_participante p
         JOIN crm.comercial c ON c.usuario = p.usuario
        WHERE p.evento = $1`,
      [id],
    );

    return { ...filas[0], participantes };
  }

  async editarEvento(id: number, datos: Partial<DatosEvento> & { resultado?: string; asistio?: boolean }, usuario: string) {
    const actual = await this.evento(id, usuario);
    if (!actual.puede_editar) throw new ForbiddenException('No puedes editar este evento.');

    if (datos.inicio || datos.fin) {
      const problema = franjaValida(datos.inicio ?? actual.inicio, datos.fin ?? actual.fin);
      if (problema) throw new BadRequestException(problema);
    }

    const columnas: Record<string, any> = {
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      lugar: datos.lugar,
      inicio: datos.inicio,
      fin: datos.fin,
      todo_el_dia: datos.todoElDia,
      importante: datos.importante,
      empresa_id: datos.empresaId,
      contacto_id: datos.contactoId,
      oportunidad_id: datos.oportunidadId,
      resultado: datos.resultado,
      asistio: datos.asistio,
    };

    const sets: string[] = [];
    const valores: any[] = [];
    for (const [columna, valor] of Object.entries(columnas)) {
      if (valor === undefined) continue;
      valores.push(valor);
      sets.push(`${columna} = $${valores.length}`);
    }
    if (sets.length === 0) return actual;

    valores.push(id);
    await this.dataSource.query(
      `UPDATE crm.evento SET ${sets.join(', ')} WHERE id = $${valores.length}`,
      valores,
    );
    return this.evento(id, usuario);
  }

  async borrarEvento(id: number, usuario: string) {
    const evento = await this.evento(id, usuario);
    if (!evento.puede_editar) throw new ForbiddenException('No puedes borrar este evento.');
    await this.dataSource.query(`DELETE FROM crm.evento WHERE id = $1`, [id]);
    return { borrado: id };
  }

  /** Quien asiste contesta a la invitación. */
  async responder(eventoId: number, estado: string, usuario: string) {
    const admitidos = ['invitado', 'aceptado', 'rechazado', 'tentativo'];
    if (!admitidos.includes(estado)) {
      throw new BadRequestException(`Respuesta no válida. Usa: ${admitidos.join(', ')}`);
    }
    await this.evento(eventoId, usuario);
    await this.dataSource.query(
      `INSERT INTO crm.evento_participante (evento, usuario, estado) VALUES ($1,$2,$3)
       ON CONFLICT (evento, usuario) DO UPDATE SET estado = EXCLUDED.estado`,
      [eventoId, usuario, estado],
    );
    return this.evento(eventoId, usuario);
  }

  // ------------------------------------------------------------ disponibilidad

  /**
   * Cuándo puede atender alguien, en un día.
   *
   * Mira **todos** sus eventos, de cualquier calendario, incluidos aquellos en
   * los que sólo participa: estar ocupado no depende de en qué calendario esté
   * la cita. Si sólo se miraran los suyos, se le agendarían encima reuniones a
   * las que ya había aceptado ir.
   */
  async disponibilidad(
    usuarios: string[],
    desde: string,
    hasta: string,
    duracionMinutos = 30,
  ) {
    const resultado = [];

    for (const usuario of usuarios) {
      const ocupadas = await this.dataSource.query(
        `SELECT DISTINCT e.inicio, e.fin, e.titulo
           FROM crm.evento e
           LEFT JOIN crm.evento_participante p ON p.evento = e.id
           LEFT JOIN crm.calendario_miembro m ON m.calendario = e.calendario
          WHERE e.inicio < $3 AND e.fin > $2
            AND (p.usuario = $1 OR e.creado_por = $1 OR m.usuario = $1)
          ORDER BY e.inicio`,
        [usuario, desde, hasta],
      );

      resultado.push({
        usuario,
        ocupadas,
        libres: huecosLibres({ inicio: desde, fin: hasta }, ocupadas, duracionMinutos),
      });
    }

    return resultado;
  }

  /** Si una franja choca con algo de quienes van a asistir. */
  async comprobarConflictos(datos: { inicio: string; fin: string; usuarios: string[] }) {
    const avisos = [];
    for (const usuario of datos.usuarios) {
      const ocupadas = await this.dataSource.query(
        `SELECT DISTINCT e.id, e.titulo, e.inicio, e.fin
           FROM crm.evento e
           LEFT JOIN crm.evento_participante p ON p.evento = e.id
          WHERE e.inicio < $3 AND e.fin > $2 AND (p.usuario = $1 OR e.creado_por = $1)`,
        [usuario, datos.inicio, datos.fin],
      );
      const choques = conflictos({ inicio: datos.inicio, fin: datos.fin }, ocupadas);
      if (choques.length) avisos.push({ usuario, conflictos: choques });
    }
    return avisos;
  }

  // ------------------------------------------------------------------ tareas

  /**
   * Las tareas que se pintan en una semana de la agenda.
   *
   * Son las de quien mira, no las del equipo: la franja de tareas contesta
   * «qué tengo que hacer esta semana», y con las de todos deja de contestar
   * nada. Para ver las de otra persona está el tablero.
   *
   * La consulta pide un día más por cada lado de lo pendiente vencido, y el
   * reparto a hoy lo decide `repartirTareasPorDia`. `due_date` sale como texto
   * `YYYY-MM-DD` porque es una columna `date`: convertida a `Date` se
   * serializa como un instante UTC, y una tarea que vence el lunes aparecería
   * el domingo en media Europa.
   */
  async tareas(usuario: string, lunes: string, hoyDelCliente?: string) {
    const dias = diasDeLaSemana(lunes);
    // Cuál es «hoy» lo decide el reloj de quien mira, que puede no estar en la
    // misma zona que el servidor; el del servidor es sólo el respaldo.
    const hoy = hoyDelCliente ?? diaLocal();

    const filas = await this.dataSource.query(
      `SELECT t.id, to_char(t.due_date, 'YYYY-MM-DD') AS vence,
              t.done_date IS NOT NULL AS hecha,
              t.text AS texto, t.type AS tipo, t.done_date AS hecha_en,
              t.deal_id, t.contact_id,
              o.name AS oportunidad, emp.name AS empresa,
              c.first_name AS contacto_nombre, c.last_name AS contacto_apellido,
              (SELECT count(*)::int FROM crm.evento e WHERE e.tarea_id = t.id) AS citas
         FROM crm.tarea t
         LEFT JOIN crm.oportunidad o ON o.id = t.deal_id
         LEFT JOIN crm.contacto c ON c.id = t.contact_id
         LEFT JOIN crm.empresa emp ON emp.id = coalesce(o.company_id, c.company_id)
        WHERE t.sales_id = $1
          AND (t.due_date BETWEEN $2::date AND $3::date
               OR (t.done_date IS NULL AND t.due_date < $4::date))
        ORDER BY t.due_date, t.id`,
      [usuario, dias[0], dias[6], hoy],
    );

    const porDia = repartirTareasPorDia(filas, dias, hoy);
    return dias.map((dia) => ({ dia, tareas: porDia.get(dia) ?? [] }));
  }

  /**
   * Dar una tarea por hecha, o deshacerlo.
   *
   * Se puede deshacer porque marcar la de al lado por error es la equivocación
   * más fácil de cometer en una lista con casillas, y sin vuelta atrás la
   * tarea desaparece de la vista: nadie la recupera porque nadie sabe que se
   * fue.
   */
  async marcarTarea(id: number, hecha: boolean, usuario: string) {
    const filas = await this.dataSource.query(
      `UPDATE crm.tarea SET done_date = CASE WHEN $2 THEN now() ELSE NULL END
        WHERE id = $1 AND sales_id = $3
       RETURNING id, to_char(due_date, 'YYYY-MM-DD') AS vence, done_date`,
      [id, hecha, usuario],
    );
    if (!filas[0]) {
      throw new NotFoundException(`No existe la tarea ${id} o no es tuya.`);
    }
    return filas[0];
  }

  /**
   * Da de alta al comercial si es su primera vez.
   *
   * Igual que en el resto del CRM: mientras no haya autenticación, la lista de
   * personas se forma con quien trabaja. Sin esto, crear tu primer calendario
   * falla con un error de clave foránea.
   */
  private async asegurarComercial(usuario: string) {
    await this.dataSource.query(
      `INSERT INTO crm.comercial (usuario, first_name) VALUES ($1,$1)
       ON CONFLICT (usuario) DO NOTHING`,
      [usuario],
    );
  }
}
