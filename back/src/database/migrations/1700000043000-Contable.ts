import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La frontera con el módulo contable, en los dos sentidos.
 *
 * El contable no vive en este repositorio, así que esto no es una integración
 * sino un **contrato**: tablas que guardan lo que el otro sistema empuja, y
 * consultas que le devuelven lo que necesita. Mientras no exista, el CRM
 * funciona igual con las tablas vacías; el día que exista, se llenan sin tocar
 * nada más.
 *
 * Entra: el catálogo de artículos del inventario, el estado de facturación y
 * cobro de cada venta, y el costo del personal. Sale: las ventas pendientes
 * de facturar con sus líneas, las cotizaciones aceptadas y las comisiones por
 * comercial.
 *
 * **Lo que entra se guarda tal como llega y no se corrige desde el CRM.** Un
 * precio de inventario editado aquí dura hasta la siguiente sincronización, y
 * en medio los dos sistemas dicen cosas distintas sobre lo mismo.
 */
export class Contable1700000043000 implements MigrationInterface {
  name = 'Contable1700000043000';

  public async up(q: QueryRunner): Promise<void> {
    /**
     * El inventario del contable, copiado.
     *
     * Se copia y no se consulta en vivo porque cotizar no puede depender de
     * que el otro sistema esté levantado: una pantalla que se queda en blanco
     * cuando el contable está en mantenimiento es una pantalla que nadie usa.
     * `sincronizado_en` dice de cuándo es el dato, que es lo que permite
     * desconfiar de él cuando lleva días sin moverse.
     */
    await q.query(`
      CREATE TABLE crm.articulo (
        codigo      text PRIMARY KEY,
        nombre      text NOT NULL,
        descripcion text NULL,
        unidad      text NULL,

        precio      numeric(14,2) NULL CHECK (precio IS NULL OR precio >= 0),
        iva         numeric(5,2) NULL CHECK (iva IS NULL OR (iva >= 0 AND iva <= 100)),

        -- El stock es informativo: se enseña al cotizar para no ofrecer lo que
        -- no hay, pero el CRM no reserva ni descuenta nada. Quien manda sobre
        -- las existencias es el contable.
        stock       numeric(14,2) NULL,

        activo      boolean NOT NULL DEFAULT true,
        sincronizado_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_articulo_nombre ON crm.articulo (lower(nombre))`);

    /**
     * Lo que cuesta una hora de cada perfil, según la nómina.
     *
     * Es lo que hace que un cotizador diga la verdad: si el costo hora se
     * teclea a mano, se queda con el sueldo del año pasado y todo lo que se
     * cotiza sale barato sin que nadie lo note.
     *
     * Se guarda el **costo**, no el sueldo de una persona concreta. Un CRM al
     * que entra la nómina nominal acaba enseñando sueldos a quien no debería
     * verlos, y para cotizar basta con lo que cuesta la hora de un perfil.
     */
    await q.query(`
      CREATE TABLE crm.costo_personal (
        perfil      text PRIMARY KEY,
        nombre      text NOT NULL,

        -- Lo que cuesta la hora con todo cargado: sueldo, aportes, beneficios.
        costo_hora  numeric(10,2) NOT NULL CHECK (costo_hora >= 0),

        -- De dónde sale, para poder revisarlo: el bruto mensual del perfil,
        -- la carga patronal y las horas que se trabajan al mes.
        sueldo_mes  numeric(14,2) NULL,
        carga_pct   numeric(5,2) NULL,
        horas_mes   numeric(6,2) NULL,

        personas    smallint NULL,
        vigente_desde date NOT NULL DEFAULT current_date,
        sincronizado_en timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Qué tareas las hace qué perfil.
     *
     * Con esto el costo de una tarea deja de ser un número escrito a mano y
     * pasa a salir de la nómina. El orden es: lo que diga la tarea, si alguien
     * lo fijó a propósito; si no, su perfil; y si tampoco, el costo hora del
     * cotizador.
     */
    await q.query(`ALTER TABLE crm.cotizador_tarea ADD COLUMN perfil text NULL`);

    /**
     * Lo que el contable contesta sobre una venta.
     *
     * No se escribe sobre `crm.venta` y ya está: se guarda cada aviso, porque
     * la pregunta que llega después no es «cómo está» sino «cuándo se facturó
     * y cuándo entró el dinero», y eso con una sola fila por venta se pierde.
     * Una factura anulada y reemitida son dos avisos, no uno corregido.
     */
    await q.query(`
      CREATE TABLE crm.venta_movimiento (
        id        bigserial PRIMARY KEY,
        venta     bigint NOT NULL REFERENCES crm.venta(id) ON DELETE CASCADE,

        tipo      text NOT NULL CHECK (tipo IN ('facturada','cobrada','anulada')),
        documento text NULL,
        monto     numeric(14,2) NULL,
        ocurrido_en timestamptz NOT NULL,
        nota      text NULL,

        -- Para no aplicar dos veces el mismo aviso: el contable reintenta
        -- cuando no recibe respuesta, y sin esto un cobro reenviado contaría
        -- dos veces en las comisiones del mes.
        referencia text NULL,

        recibido_en timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_venta_movimiento ON crm.venta_movimiento (venta, ocurrido_en)`);
    await q.query(`
      CREATE UNIQUE INDEX idx_crm_venta_movimiento_referencia
        ON crm.venta_movimiento (referencia) WHERE referencia IS NOT NULL
    `);

    // La línea de proforma puede ser un artículo del inventario y no sólo un
    // producto del catálogo comercial: un servicio se vende con los insumos
    // que lleva, y escribirlos a mano es cómo se cotiza un precio que no es.
    await q.query(`
      ALTER TABLE crm.proforma_linea
        ADD COLUMN articulo text NULL REFERENCES crm.articulo(codigo) ON DELETE SET NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.proforma_linea DROP COLUMN IF EXISTS articulo`);
    await q.query(`DROP TABLE IF EXISTS crm.venta_movimiento`);
    await q.query(`ALTER TABLE crm.cotizador_tarea DROP COLUMN IF EXISTS perfil`);
    await q.query(`DROP TABLE IF EXISTS crm.costo_personal`);
    await q.query(`DROP TABLE IF EXISTS crm.articulo`);
  }
}
