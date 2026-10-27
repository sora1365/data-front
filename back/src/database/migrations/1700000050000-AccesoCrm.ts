import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Entrar al CRM con clave.
 *
 * Hasta aquí quien abría el CRM escribía un nombre y ese nombre firmaba todo,
 * sin comprobarse contra nada: identificaba, no protegía. Con el RUC, los
 * precios y las comisiones de todos los clientes detrás, eso deja de valer en
 * cuanto el CRM sale del ordenador de quien lo construye.
 *
 * La identidad sigue siendo `crm.comercial.usuario` —el mismo valor que ya
 * firma cada fila—, así que nada de lo escrito hasta hoy hay que migrarlo: la
 * clave se le añade a la persona que ya existe.
 *
 * - `clave_hash` admite nulo: un comercial sin clave existe (tiene ventas,
 *   tareas, comisiones) pero no puede entrar hasta que un administrador se la
 *   ponga. Es el estado en que quedan todos al aplicar esta migración.
 * - `debe_cambiar_clave`: la clave que pone un administrador la ha visto otra
 *   persona, así que sólo sirve para entrar y cambiarla.
 * - `sesion_version` revoca: sube al cambiar la clave o desactivar a alguien,
 *   y las sesiones firmadas con la versión anterior dejan de valer en la
 *   siguiente petición, sin esperar a que caduquen.
 *
 * `crm.acceso` es el registro de entradas, buenas y malas. Es lo que pide el
 * módulo 16 —«registro de accesos al sistema»— y es también de donde sale el
 * bloqueo por intentos fallidos, sin un contador aparte que se desincronice.
 */
export class AccesoCrm1700000050000 implements MigrationInterface {
  name = 'AccesoCrm1700000050000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE crm.comercial
        ADD COLUMN clave_hash         text    NULL,
        ADD COLUMN debe_cambiar_clave boolean NOT NULL DEFAULT false,
        ADD COLUMN sesion_version     integer NOT NULL DEFAULT 0
    `);

    await q.query(`
      CREATE TABLE crm.acceso (
        id      bigserial   PRIMARY KEY,
        -- Sin clave foránea a propósito: se registran también los intentos con
        -- un usuario que no existe, que es justo lo que interesa ver.
        usuario text        NOT NULL,
        exito   boolean     NOT NULL,
        motivo  text        NULL,
        ip      text        NULL,
        agente  text        NULL,
        en      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX acceso_usuario_en ON crm.acceso (usuario, en DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE crm.acceso`);
    await q.query(`
      ALTER TABLE crm.comercial
        DROP COLUMN clave_hash,
        DROP COLUMN debe_cambiar_clave,
        DROP COLUMN sesion_version
    `);
  }
}
