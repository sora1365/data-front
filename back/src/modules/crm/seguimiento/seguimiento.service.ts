import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { diaLocal } from '../agenda/agenda.reglas';
import {
  estaTerminado,
  fechasDePasos,
  impedimentoParaIniciar,
  motivoDeCorte,
} from './seguimiento.reglas';

@Injectable()
export class SeguimientoService {
  private readonly logger = new Logger(SeguimientoService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // -------------------------------------------------------------- secuencias

  async secuencias() {
    return this.dataSource.query(
      `SELECT s.*,
              coalesce(
                (SELECT json_agg(json_build_object(
                          'orden', p.orden, 'dia', p.dia,
                          'canal', p.canal, 'texto', p.texto)
                        ORDER BY p.dia, p.orden)
                   FROM crm.secuencia_paso p WHERE p.secuencia = s.codigo),
                '[]'::json
              ) AS pasos,
              (SELECT count(*)::int FROM crm.seguimiento g
                WHERE g.secuencia = s.codigo AND g.estado = 'vivo') AS vivos
         FROM crm.secuencia s
        ORDER BY s.activa DESC, s.nombre`,
    );
  }

  /** Los seguimientos en marcha, con lo que les queda por hacer. */
  async vivos() {
    return this.dataSource.query(
      `SELECT g.id, g.secuencia, g.oportunidad, g.iniciado_en, g.iniciado_por,
              s.nombre AS secuencia_nombre,
              o.name AS oportunidad_nombre, o.etapa, o.comercial,
              emp.name AS empresa,
              count(t.id)::int AS pasos,
              count(t.id) FILTER (WHERE t.done_date IS NOT NULL)::int AS hechos,
              min(t.due_date) FILTER (WHERE t.done_date IS NULL) AS proximo
         FROM crm.seguimiento g
         JOIN crm.secuencia s ON s.codigo = g.secuencia
         JOIN crm.oportunidad o ON o.id = g.oportunidad
         JOIN crm.empresa emp ON emp.id = o.company_id
         LEFT JOIN crm.tarea t ON t.seguimiento = g.id
        WHERE g.estado = 'vivo'
        GROUP BY g.id, s.nombre, o.name, o.etapa, o.comercial, emp.name
        ORDER BY proximo NULLS LAST`,
    );
  }

  /**
   * En qué días caería una secuencia, sin crear nada.
   *
   * Sirve para enseñar el plan antes de arrancarlo: un seguimiento que pone
   * tres tareas en la agenda de otra persona no debería ser una sorpresa.
   */
  async previo(codigo: string, arranque?: string) {
    const pasos = await this.dataSource.query(
      `SELECT orden, dia, canal, texto FROM crm.secuencia_paso
        WHERE secuencia = $1 ORDER BY dia, orden`,
      [codigo],
    );
    if (pasos.length === 0) {
      throw new NotFoundException(`La secuencia «${codigo}» no tiene pasos.`);
    }
    return fechasDePasos(pasos, arranque ?? diaLocal());
  }

  // ------------------------------------------------------------- aplicarlas

  /**
   * Arranca una secuencia sobre una oportunidad y deja sus tareas puestas.
   *
   * Las tareas se crean **todas de una vez**, no una tras otra según se van
   * haciendo. Es lo que permite ver el plan completo en la agenda de la semana
   * que viene en vez de descubrirlo paso a paso, y lo que hace que no haya que
   * montar un proceso que despierte cada noche para crear la siguiente.
   */
  async iniciar(
    secuencia: string,
    oportunidad: number,
    usuario: string,
    arranqueDelCliente?: string,
  ) {
    const sec = (
      await this.dataSource.query(`SELECT * FROM crm.secuencia WHERE codigo = $1`, [secuencia])
    )[0];
    if (!sec) throw new NotFoundException(`No existe la secuencia «${secuencia}»`);

    const op = (
      await this.dataSource.query(
        `SELECT o.id, o.marca, o.producto, o.comercial, o.archivada_en,
                e.es_ganada, e.es_perdida
           FROM crm.oportunidad o
           JOIN crm.etapa e ON e.codigo = o.etapa
          WHERE o.id = $1`,
        [oportunidad],
      )
    )[0];
    if (!op) throw new NotFoundException(`No existe la oportunidad ${oportunidad}`);

    const impedimento = impedimentoParaIniciar(
      { activa: sec.activa, marca: sec.marca, producto: sec.producto },
      {
        marca: op.marca,
        producto: op.producto,
        archivada: op.archivada_en != null,
        cerrada: op.es_ganada || op.es_perdida,
      },
    );
    if (impedimento) throw new BadRequestException(impedimento);

    const pasos = await this.dataSource.query(
      `SELECT orden, dia, canal, texto FROM crm.secuencia_paso
        WHERE secuencia = $1 ORDER BY dia, orden`,
      [secuencia],
    );
    if (pasos.length === 0) {
      throw new BadRequestException('Esa secuencia no tiene ningún paso.');
    }

    const arranque = arranqueDelCliente ?? diaLocal();
    const conFecha = fechasDePasos(pasos, arranque);

    return this.dataSource.transaction(async (manager) => {
      let creado;
      try {
        const res = await manager.query(
          `INSERT INTO crm.seguimiento (secuencia, oportunidad, iniciado_por)
           VALUES ($1,$2,$3) RETURNING id`,
          [secuencia, oportunidad, usuario],
        );
        creado = Array.isArray(res[0]) ? res[0][0] : res[0];
      } catch (e: any) {
        // El único parcial de los vivos: uno por oportunidad. Dos planes a la
        // vez son dos calendarios de llamadas que no se conocen, y el cliente
        // recibe la misma llamada dos veces el mismo día.
        if (e?.code === '23505') {
          throw new ConflictException(
            'Esa oportunidad ya tiene un seguimiento en marcha. Córtalo antes de empezar otro.',
          );
        }
        throw e;
      }

      for (const paso of conFecha) {
        await manager.query(
          `INSERT INTO crm.tarea (deal_id, text, type, due_date, sales_id, seguimiento)
           VALUES ($1,$2,$3,$4::date,$5,$6)`,
          [
            oportunidad,
            paso.texto,
            paso.canal,
            paso.vence,
            // La tarea es de quien lleva la venta, no de quien aprieta el
            // botón: un seguimiento que salta solo al mover una tarjeta no
            // tiene a nadie apretando nada.
            op.comercial ?? usuario,
            creado.id,
          ],
        );
      }

      return { id: creado.id, secuencia, oportunidad, pasos: conFecha };
    });
  }

  /**
   * Arranca sola la secuencia de una etapa, si la hay.
   *
   * Se llama al mover una tarjeta y **no puede romper el movimiento**: que
   * falle el seguimiento no es razón para que la venta se quede en la etapa
   * anterior. Por eso devuelve lo que pasó en vez de lanzar, y quien la llama
   * sigue adelante igual.
   */
  async dispararPorEtapa(oportunidad: number, etapa: string, usuario: string) {
    const secuencias = await this.dataSource.query(
      `SELECT codigo FROM crm.secuencia WHERE activa AND etapa_disparo = $1`,
      [etapa],
    );

    const arrancadas: string[] = [];
    for (const { codigo } of secuencias) {
      try {
        await this.iniciar(codigo, oportunidad, usuario);
        arrancadas.push(codigo);
      } catch (e) {
        // Ya estaba en marcha, o la secuencia no aplica a esta venta. Las dos
        // cosas son normales aquí y ninguna es un error del movimiento. Lo
        // demás —la base de datos que falla— sí se deja escrito.
        if (!(e instanceof HttpException)) {
          this.logger.error(`No arrancó «${codigo}» sobre la oportunidad ${oportunidad}`, e as Error);
        }
      }
    }
    return arrancadas;
  }

  // ------------------------------------------------------------------ cortar

  /**
   * Corta un seguimiento y quita de en medio lo que quedaba por hacer.
   *
   * Las tareas pendientes se **borran**, no se dan por hechas: marcarlas como
   * hechas diría que alguien llamó, y el historial dejaría de poder usarse
   * para saber qué se hizo de verdad. Las ya hechas se quedan, que son el
   * registro de lo que sí ocurrió.
   */
  async cortar(id: number, motivo: string) {
    const seguimiento = (
      await this.dataSource.query(`SELECT * FROM crm.seguimiento WHERE id = $1`, [id])
    )[0];
    if (!seguimiento) throw new NotFoundException(`No existe el seguimiento ${id}`);
    if (seguimiento.estado !== 'vivo') return seguimiento;

    return this.dataSource.transaction(async (manager) => {
      const borradas = await manager.query(
        `DELETE FROM crm.tarea WHERE seguimiento = $1 AND done_date IS NULL RETURNING id`,
        [id],
      );
      const filas = await manager.query(
        `UPDATE crm.seguimiento
            SET estado = 'cortado', motivo_corte = $2, cerrado_en = now()
          WHERE id = $1
         RETURNING *`,
        [id, motivo],
      );
      return { ...filas[0], tareas_quitadas: borradas.length };
    });
  }

  /** Corta los seguimientos vivos de una venta que se acaba de cerrar. */
  async cortarPorEtapa(oportunidad: number, etapa: {
    codigo: string;
    es_ganada: boolean;
    es_perdida: boolean;
  }) {
    const motivo = motivoDeCorte(etapa);
    if (!motivo) return [];

    const vivos = await this.dataSource.query(
      `SELECT id FROM crm.seguimiento WHERE oportunidad = $1 AND estado = 'vivo'`,
      [oportunidad],
    );
    for (const { id } of vivos) await this.cortar(Number(id), motivo);
    return vivos.map((v: any) => Number(v.id));
  }

  /**
   * Da por terminado lo que ya no tiene pasos pendientes.
   *
   * Se llama al consultar y no desde un proceso nocturno: el estado de un
   * seguimiento se deduce de sus tareas, y lo único que esto hace es
   * escribirlo para no tener que recalcularlo en cada consulta.
   */
  async recogerTerminados() {
    const candidatos = await this.dataSource.query(
      `SELECT g.id,
              coalesce(json_agg(json_build_object('hecha', t.done_date IS NOT NULL))
                       FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tareas
         FROM crm.seguimiento g
         LEFT JOIN crm.tarea t ON t.seguimiento = g.id
        WHERE g.estado = 'vivo'
        GROUP BY g.id`,
    );

    const terminados = candidatos.filter((c: any) => estaTerminado(c.tareas)).map((c: any) => c.id);
    if (terminados.length) {
      await this.dataSource.query(
        `UPDATE crm.seguimiento SET estado = 'terminado', cerrado_en = now()
          WHERE id = ANY($1)`,
        [terminados],
      );
    }
    return terminados;
  }

  /** Lo que el CRM sabe del seguimiento de una oportunidad. */
  async deOportunidad(oportunidad: number) {
    return this.dataSource.query(
      `SELECT g.*, s.nombre AS secuencia_nombre,
              coalesce(
                (SELECT json_agg(json_build_object(
                          'id', t.id, 'texto', t.text, 'canal', t.type,
                          'vence', to_char(t.due_date, 'YYYY-MM-DD'),
                          'hecha', t.done_date IS NOT NULL)
                        ORDER BY t.due_date)
                   FROM crm.tarea t WHERE t.seguimiento = g.id),
                '[]'::json
              ) AS tareas
         FROM crm.seguimiento g
         JOIN crm.secuencia s ON s.codigo = g.secuencia
        WHERE g.oportunidad = $1
        ORDER BY g.iniciado_en DESC`,
      [oportunidad],
    );
  }
}
