import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cotizadores por servicio: de cuánto cuesta hacerlo a cuánto se cobra.
 *
 * Un precio de lista sirve para lo que siempre vale lo mismo. Un outsourcing
 * contable no: depende de qué tareas se hacen y de cuánto se mueve esa
 * empresa. Lo que hoy pasa es que alguien echa esa cuenta en una hoja aparte,
 * cotiza, y seis meses después nadie puede decir por qué ese cliente paga 480
 * y el de al lado 700.
 *
 * El cotizador guarda la cuenta: **tareas con tiempos, un costo por hora y un
 * margen**. Las tareas pueden tener horas fijas y horas por unidad de una
 * variable —las transacciones al mes, los empleados—, que es exactamente la
 * forma de «asigno tiempos según la transaccionalidad» sin inventar un
 * lenguaje de fórmulas que luego nadie sabe leer.
 *
 * Y cada cotización hecha se guarda con los valores que se usaron. Sin eso, el
 * precio es un número sin historia: la próxima renovación se discute a ciegas.
 */
export class Cotizadores1700000042000 implements MigrationInterface {
  name = 'Cotizadores1700000042000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE crm.cotizador (
        codigo      text PRIMARY KEY,
        nombre      text NOT NULL,
        descripcion text NULL,
        producto    text NULL REFERENCES producto(codigo),

        -- Lo que le cuesta a la empresa una hora de trabajo. Va aquí y no en
        -- una configuración global porque no cuesta lo mismo una hora de
        -- auditoría que una de digitación, y es el número que más se revisa.
        costo_hora  numeric(10,2) NOT NULL CHECK (costo_hora >= 0),

        margen      numeric(5,2) NOT NULL DEFAULT 30 CHECK (margen >= 0 AND margen < 100),

        /**
         * Qué significa ese margen.
         *
         * «30 % de margen» quiere decir dos cosas distintas y las dos son
         * normales: cargar un 30 % sobre el costo (100 → 130) o que la
         * ganancia sea el 30 % del precio (100 → 142,86). Dejarlo implícito
         * es cotizar un 10 % por debajo de lo que alguien cree.
         */
        modo_margen text NOT NULL DEFAULT 'sobre_costo'
                    CHECK (modo_margen IN ('sobre_costo','sobre_precio')),

        iva         numeric(5,2) NOT NULL DEFAULT 15 CHECK (iva >= 0 AND iva <= 100),

        -- Lo que sale al final: ¿es un precio al mes o uno por el trabajo?
        periodicidad text NOT NULL DEFAULT 'mensual'
                     CHECK (periodicidad IN ('mensual','unica','anual')),

        activo      boolean NOT NULL DEFAULT true,
        creado_por  text NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Lo que se pregunta al cotizar.
     *
     * El `codigo` es el que usan las tareas para multiplicar. Es texto corto y
     * estable a propósito: si las tareas apuntaran al id, renombrar una
     * variable rompería la cuenta en silencio.
     */
    await q.query(`
      CREATE TABLE crm.cotizador_variable (
        id        bigserial PRIMARY KEY,
        cotizador text NOT NULL REFERENCES crm.cotizador(codigo) ON DELETE CASCADE,
        codigo    text NOT NULL,
        nombre    text NOT NULL,
        unidad    text NULL,
        valor_defecto numeric(14,2) NOT NULL DEFAULT 0,
        orden     smallint NOT NULL DEFAULT 1,
        UNIQUE (cotizador, codigo)
      )
    `);

    await q.query(`
      CREATE TABLE crm.cotizador_tarea (
        id        bigserial PRIMARY KEY,
        cotizador text NOT NULL REFERENCES crm.cotizador(codigo) ON DELETE CASCADE,
        orden     smallint NOT NULL,
        nombre    text NOT NULL,

        horas_fijas      numeric(10,2) NOT NULL DEFAULT 0 CHECK (horas_fijas >= 0),
        horas_por_unidad numeric(10,4) NOT NULL DEFAULT 0 CHECK (horas_por_unidad >= 0),

        -- Qué variable multiplica a las horas por unidad. Nula cuando la tarea
        -- cuesta lo mismo pase lo que pase.
        variable  text NULL,

        -- El costo de esta tarea en concreto, cuando no la hace el mismo
        -- perfil: revisar el balance no cuesta lo que digitar facturas.
        costo_hora numeric(10,2) NULL CHECK (costo_hora IS NULL OR costo_hora >= 0),

        UNIQUE (cotizador, orden)
      )
    `);

    /**
     * Cada cotización hecha, con los valores que se usaron.
     *
     * Se guardan las entradas y **también los resultados**, aunque se puedan
     * recalcular: el costo por hora y el margen cambian, y recalcular una
     * cotización del año pasado con los números de hoy daría otro precio que
     * nadie ofreció nunca.
     */
    await q.query(`
      CREATE TABLE crm.cotizacion (
        id          bigserial PRIMARY KEY,
        cotizador   text NOT NULL REFERENCES crm.cotizador(codigo),
        oportunidad bigint NULL REFERENCES crm.oportunidad(id) ON DELETE SET NULL,

        entradas    jsonb NOT NULL DEFAULT '{}'::jsonb,
        detalle     jsonb NOT NULL DEFAULT '[]'::jsonb,

        horas       numeric(12,2) NOT NULL,
        costo       numeric(14,2) NOT NULL,
        margen      numeric(5,2) NOT NULL,
        modo_margen text NOT NULL,
        precio      numeric(14,2) NOT NULL,
        periodicidad text NOT NULL,

        nota        text NULL,
        creada_por  text NOT NULL,
        creada_en   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_crm_cotizacion_oportunidad ON crm.cotizacion (oportunidad)`);

    // De qué cotización salió una línea de proforma. Es lo que permite
    // contestar «¿por qué este cliente paga 480?» abriendo el documento.
    await q.query(`
      ALTER TABLE crm.proforma_linea
        ADD COLUMN cotizacion bigint NULL REFERENCES crm.cotizacion(id) ON DELETE SET NULL
    `);

    /**
     * La venta dice de qué proforma salió.
     *
     * Es la otra mitad de la frontera con el contable. Hasta aquí se le
     * entregaba un importe suelto; con esto puede facturar **las líneas que
     * el cliente aceptó**, con sus cantidades, descuentos y su IVA por
     * producto, en vez de que alguien las vuelva a teclear en el otro sistema
     * y la factura acabe sin cuadrar con la oferta.
     *
     * Nula cuando la venta se ganó sin proforma, que sigue siendo normal: no
     * todo se cotiza por escrito.
     */
    await q.query(`
      ALTER TABLE crm.venta
        ADD COLUMN proforma bigint NULL REFERENCES crm.proforma(id) ON DELETE SET NULL
    `);
    await q.query(
      `CREATE INDEX idx_crm_venta_proforma ON crm.venta (proforma) WHERE proforma IS NOT NULL`,
    );

    await this.sembrar(q);
  }

  /**
   * El outsourcing contable, que es el caso que lo pidió.
   *
   * Se siembra uno de verdad y no un ejemplo vacío: un cotizador en blanco
   * obliga a inventarse la estructura antes de poder ver si esto sirve, y los
   * números de aquí son los que se corrigen en pantalla en dos minutos.
   */
  private async sembrar(q: QueryRunner) {
    const producto = await q.query(
      `SELECT codigo FROM producto WHERE codigo LIKE 'contabilidad%' LIMIT 1`,
    );

    await q.query(
      `INSERT INTO crm.cotizador
         (codigo, nombre, descripcion, producto, costo_hora, margen, modo_margen, periodicidad, creado_por)
       VALUES ('outsourcing_contable',
               'Outsourcing contable',
               'Tiempos por tarea según la transaccionalidad de la empresa, por el costo hora, más el margen.',
               $1, 12.00, 35, 'sobre_costo', 'mensual', 'migracion')`,
      [producto[0]?.codigo ?? null],
    );

    await q.query(`
      INSERT INTO crm.cotizador_variable (cotizador, codigo, nombre, unidad, valor_defecto, orden) VALUES
        ('outsourcing_contable', 'transacciones', 'Transacciones al mes', 'transacciones', 100, 1),
        ('outsourcing_contable', 'empleados', 'Empleados en nómina', 'empleados', 5, 2),
        ('outsourcing_contable', 'sucursales', 'Sucursales', 'sucursales', 1, 3)
    `);

    await q.query(`
      INSERT INTO crm.cotizador_tarea
        (cotizador, orden, nombre, horas_fijas, horas_por_unidad, variable, costo_hora) VALUES
        ('outsourcing_contable', 1, 'Registro contable de transacciones', 2, 0.05, 'transacciones', NULL),
        ('outsourcing_contable', 2, 'Conciliación bancaria', 3, 0.5, 'sucursales', NULL),
        ('outsourcing_contable', 3, 'Nómina y aportes', 1, 0.25, 'empleados', NULL),
        ('outsourcing_contable', 4, 'Declaraciones mensuales', 4, 0, NULL, NULL),
        ('outsourcing_contable', 5, 'Revisión y cierre del mes', 2, 0, NULL, 25.00)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS crm.idx_crm_venta_proforma`);
    await q.query(`ALTER TABLE crm.venta DROP COLUMN IF EXISTS proforma`);
    await q.query(`ALTER TABLE crm.proforma_linea DROP COLUMN IF EXISTS cotizacion`);
    await q.query(`DROP TABLE IF EXISTS crm.cotizacion`);
    await q.query(`DROP TABLE IF EXISTS crm.cotizador_tarea`);
    await q.query(`DROP TABLE IF EXISTS crm.cotizador_variable`);
    await q.query(`DROP TABLE IF EXISTS crm.cotizador`);
  }
}
