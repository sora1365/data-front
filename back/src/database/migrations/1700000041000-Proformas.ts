import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proformas: la oferta por escrito y su aceptación.
 *
 * Es el principio del ciclo de venta del requerimiento. Hasta aquí una
 * oportunidad tenía un importe suelto —un número en una tarjeta— y lo que el
 * cliente recibía era un correo escrito a mano. La proforma es el documento:
 * qué se le ofrece, por cuánto, hasta cuándo vale y quién dijo que sí.
 *
 * **Las líneas congelan el precio.** Una proforma enviada es una promesa: si
 * mañana sube la lista de precios, lo ofrecido ayer sigue valiendo lo que
 * decía. Por eso el precio se copia a la línea y no se lee de la lista al
 * mostrarla.
 *
 * El catálogo de productos es del gestor comercial y no se toca, así que la
 * lista de precios vive aquí, en el esquema del CRM. Añadirle una columna
 * `precio` a `producto` sería el CRM escribiendo en una tabla de otro módulo.
 */
export class Proformas1700000041000 implements MigrationInterface {
  name = 'Proformas1700000041000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.precio (
        producto    text PRIMARY KEY REFERENCES producto(codigo) ON DELETE CASCADE,
        precio      numeric(14,2) NOT NULL CHECK (precio >= 0),

        -- El IVA del producto, no uno global: en Ecuador conviven el 15 % y
        -- los servicios con tarifa cero, y un único porcentaje en la
        -- configuración obliga a corregir a mano cada proforma del otro tipo.
        iva         numeric(5,2) NOT NULL DEFAULT 15 CHECK (iva >= 0 AND iva <= 100),

        nota        text NULL,
        actualizado_por text NOT NULL,
        actualizado_en  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await q.query(`
      CREATE TABLE crm.proforma (
        id          bigserial PRIMARY KEY,
        numero      text NOT NULL UNIQUE,
        oportunidad bigint NOT NULL REFERENCES crm.oportunidad(id) ON DELETE CASCADE,

        estado      text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','enviada','aceptada','rechazada','anulada')),

        -- Hasta cuándo vale. Una oferta sin fecha se negocia seis meses
        -- después con el precio del año pasado.
        valida_hasta date NOT NULL,

        -- A quién va dirigida, congelado: la ficha de la empresa puede
        -- cambiar, y el documento que recibió el cliente decía lo que decía.
        razon_social text NOT NULL,
        ruc          text NULL,
        direccion    text NULL,
        contacto     text NULL,
        correo       text NULL,

        notas       text NULL,
        condiciones text NULL,

        subtotal    numeric(14,2) NOT NULL DEFAULT 0,
        descuento   numeric(14,2) NOT NULL DEFAULT 0,
        iva         numeric(14,2) NOT NULL DEFAULT 0,
        total       numeric(14,2) NOT NULL DEFAULT 0,

        /**
         * El enlace con el que el cliente la abre y la acepta.
         *
         * Es un uuid y no el id: con el id, cualquiera que reciba una
         * proforma puede leer las demás cambiando un número en la barra de
         * direcciones, y ahí van el RUC y los precios de otros clientes.
         */
        token       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,

        enviada_en  timestamptz NULL,
        vista_en    timestamptz NULL,
        cerrada_en  timestamptz NULL,
        aceptada_por text NULL,
        motivo      text NULL,

        creada_por  text NOT NULL,
        creada_en   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_proforma_oportunidad ON crm.proforma (oportunidad)`);
    await q.query(`CREATE INDEX idx_crm_proforma_estado ON crm.proforma (estado, valida_hasta)`);

    await q.query(`
      CREATE TABLE crm.proforma_linea (
        id          bigserial PRIMARY KEY,
        proforma    bigint NOT NULL REFERENCES crm.proforma(id) ON DELETE CASCADE,
        orden       smallint NOT NULL,

        -- El producto es opcional: en una propuesta entra «capacitación al
        -- equipo» que no está en el catálogo, y obligar a crearlo primero
        -- termina en productos basura inventados para poder cotizar.
        producto    text NULL REFERENCES producto(codigo),
        descripcion text NOT NULL,

        cantidad       numeric(12,2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
        precio_unitario numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
        descuento_pct  numeric(5,2) NOT NULL DEFAULT 0
                       CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
        iva_pct        numeric(5,2) NOT NULL DEFAULT 15
                       CHECK (iva_pct >= 0 AND iva_pct <= 100),

        UNIQUE (proforma, orden)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS crm.proforma_linea`);
    await q.query(`DROP TABLE IF EXISTS crm.proforma`);
    await q.query(`DROP TABLE IF EXISTS crm.precio`);
  }
}
