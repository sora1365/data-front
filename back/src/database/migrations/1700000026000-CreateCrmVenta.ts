import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La venta: la costura entre el CRM y el módulo contable.
 *
 * Ganar una oportunidad deja al sujeto como cliente, pero eso no es algo que
 * otro sistema pueda recoger. Sin esta tabla, el contable sólo podría preguntar
 * «¿qué oportunidades están en etapa ganada?» y adivinar cuáles ya facturó; se
 * rompe el primer día que alguien reabra o archive una.
 *
 * Aquí la venta es un hecho con su propio ciclo —pendiente de facturar,
 * facturada, cobrada— que el contable **consulta y marca**. El CRM no necesita
 * saber nada de facturación y el contable no necesita entender de etapas ni de
 * embudos; lo único compartido es esta fila.
 *
 * **El RUC y la razón social se congelan al ganar.** El resto de la aplicación
 * lee del perfil precisamente para no tener dos verdades, pero una venta es un
 * hecho histórico y no una vista: a quien se le vendió en marzo se le vendió
 * con el nombre que tenía en marzo, y si ese sujeto desaparece del perfil la
 * venta no puede quedarse sin saber a quién fue. La consulta devuelve además
 * los datos actuales, para que el contable vea si han cambiado antes de emitir.
 */
export class CreateCrmVenta1700000026000 implements MigrationInterface {
  name = 'CreateCrmVenta1700000026000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm_venta (
        id          bigserial PRIMARY KEY,
        -- Una venta por oportunidad: ganar dos veces no vende dos veces.
        -- RESTRICT y no CASCADE: una oportunidad con venta no se borra sin
        -- mirar qué pasó con la factura.
        oportunidad bigint NOT NULL UNIQUE REFERENCES crm_oportunidad(id) ON DELETE RESTRICT,
        marca       text NOT NULL REFERENCES crm_marca(codigo),
        tipo_sujeto text NOT NULL,
        clave       text NOT NULL,
        producto    text NOT NULL REFERENCES producto(codigo),
        monto       numeric(14,2) NULL,
        comercial   text NULL REFERENCES crm_comercial(usuario),

        -- Congelados en el momento de ganar.
        ruc           text NULL,
        razon_social  text NULL,
        direccion     text NULL,

        estado text NOT NULL DEFAULT 'pendiente_facturacion'
          CHECK (estado IN ('pendiente_facturacion','facturada','cobrada','anulada')),

        -- Lo que escribe el módulo contable.
        documento    text NULL,
        facturada_en timestamptz NULL,
        cobrada_en   timestamptz NULL,
        anulada_en   timestamptz NULL,
        nota         text NULL,
        marcada_por  text NULL,

        ganada_en  timestamptz NOT NULL DEFAULT now(),
        creada_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // La pregunta que hace el contable es siempre «qué me falta facturar»,
    // en orden de antigüedad.
    await q.query(`
      CREATE INDEX idx_crm_venta_pendiente ON crm_venta (estado, ganada_en)
    `);
    await q.query(`CREATE INDEX idx_crm_venta_sujeto ON crm_venta (tipo_sujeto, clave)`);
    await q.query(`CREATE INDEX idx_crm_venta_marca ON crm_venta (marca, ganada_en)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm_venta`);
  }
}
