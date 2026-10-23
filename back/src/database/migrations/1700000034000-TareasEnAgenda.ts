import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las tareas del CRM, dentro de la agenda.
 *
 * Hasta aquí eran dos cosas separadas que compiten por lo mismo: la tarea dice
 * «llamar a esta empresa antes del jueves» y la agenda dice qué hay el jueves.
 * Mirar sólo una de las dos lleva a prometer una visita a la misma hora que ya
 * había otra, o a que una tarea venza sin que nadie la viera.
 *
 * No se fusionan en una sola tabla, porque no son lo mismo: una tarea tiene
 * día de vencimiento y no hora, y se termina; un evento ocupa una franja y se
 * asiste. Lo que se añade es el puente en el único sentido que hace falta:
 * **un evento puede decir a qué tarea sirve**. Reservar una hora para hacer
 * algo que estaba pendiente es el caso real, y así la tarea sigue siendo la
 * dueña de su vencimiento mientras la cita es sólo cuándo se va a hacer.
 *
 * El sentido contrario —una columna `evento` en la tarea— sería falso: nada
 * impide reservar dos ratos para una misma tarea, y guardar sólo el último
 * haría desaparecer el primero del calendario sin avisar.
 */
export class TareasEnAgenda1700000034000 implements MigrationInterface {
  name = 'TareasEnAgenda1700000034000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE crm.evento
        ADD COLUMN tarea_id bigint NULL REFERENCES crm.tarea(id) ON DELETE SET NULL
    `);

    // `SET NULL` y no `CASCADE`: si alguien borra la tarea, la hora reservada
    // ya está comprometida con otras personas. Borrarles la cita de la agenda
    // porque se borró la tarea que la originó es una sorpresa cara.
    await q.query(
      `CREATE INDEX idx_crm_evento_tarea ON crm.evento (tarea_id) WHERE tarea_id IS NOT NULL`,
    );

    /**
     * El índice con el que se pinta la franja de tareas de la semana.
     *
     * Ya existe `idx_crm_tarea_pendiente (sales_id, due_date) WHERE done_date
     * IS NULL`, que sirve para lo pendiente. Este cubre lo que la agenda pide
     * además: las ya hechas de los días que se están mirando, porque una
     * semana en la que las tareas terminadas desaparecen parece una semana en
     * la que no se hizo nada.
     */
    await q.query(`CREATE INDEX idx_crm_tarea_agenda ON crm.tarea (sales_id, due_date)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_tarea_agenda`);
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_evento_tarea`);
    await q.query(`ALTER TABLE crm.evento DROP COLUMN IF EXISTS tarea_id`);
  }
}
