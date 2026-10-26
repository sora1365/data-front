import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devolución de impuestos: dos segmentos sacados del análisis tributario.
 *
 * ## Quién entra
 *
 * Sólo las compañías cuyo crédito **se acumula** según `credito_tributario_empresa`:
 * el saldo cierra el último ejercicio en su máximo y ha subido más veces de las
 * que ha bajado. Es impuesto pagado que la empresa no ha logrado imputar contra
 * nada, y es la única de las etiquetas del diagnóstico que apunta a una
 * devolución. `consume` e `irregular` no entran: ahí la conversación es otra.
 *
 * Y con al menos **10.000 USD** de saldo en el último ejercicio. Por debajo, el
 * trámite le cuesta al cliente más de lo que recupera. El umbral va contra el
 * último saldo y no contra la suma de los años, por la misma razón que en la
 * pantalla de crédito: un saldo de hace cuatro años que ya se compensó no es una
 * devolución pendiente.
 *
 * ## Dos segmentos y no uno
 *
 * IVA y renta son trámites distintos, y una misma compañía puede estar
 * compensando uno y acumulando el otro (el caso que originó el diagnóstico es
 * justo ése). Juntos en una lista, el gestor tendría que mirar cada fila para
 * saber qué ofrecer. Separados, la lista ya lo dice. Las 1.881 compañías que
 * acumulan en los dos aparecen en ambos.
 *
 * Tamaño en la primera corrida (vigentes): 8.632 en IVA y 7.494 en renta.
 *
 * ## Sólo compañías
 *
 * El diagnóstico sale de los balances de la Superintendencia, y personas
 * naturales y sociedades no supervisadas no los presentan. No es una exclusión
 * comercial: es que no hay dato.
 *
 * ## Que entre en el segmento no significa que la devolución proceda
 *
 * Eso depende de la naturaleza del crédito, de la caducidad y del respaldo,
 * nada de lo cual consta en un balance. La descripción lo dice para que nadie
 * llame prometiendo un monto.
 */
export class SegmentosDevolucion1700000049000 implements MigrationInterface {
  name = 'SegmentosDevolucion1700000049000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO producto (codigo, unidad, nombre, descripcion) VALUES
        ('devolucion_impuestos', 'contabilidad', 'Devolución de impuestos',
         'Recuperación de crédito tributario de IVA y de impuesto a la renta no imputado')
    `);

    await q.query(`
      INSERT INTO segmento (codigo, nombre, descripcion, condicion, activo, bloqueo) VALUES
        (
          'devolucion_iva',
          'Devolución de IVA',
          'Compañías cuyo crédito tributario de IVA se acumula —crece y cierra en su máximo— con al menos 10.000 USD en el último ejercicio. Es potencialmente recuperable, pero la procedencia depende de la naturaleza del crédito, la caducidad y el respaldo: hay que analizar el detalle antes de ofrecer un monto.',
          $$p.tipo_sujeto = 'compania'
            AND EXISTS (
              SELECT 1 FROM credito_tributario_empresa d
               WHERE d.expediente = p.expediente
                 AND d.diagnostico_iva = 'acumula'
                 AND d.iva_ult >= 10000)$$,
          true, NULL
        ),
        (
          'devolucion_renta',
          'Devolución de impuesto a la renta',
          'Compañías cuyo crédito tributario de impuesto a la renta se acumula —crece y cierra en su máximo— con al menos 10.000 USD en el último ejercicio. Es potencialmente recuperable, pero la procedencia depende de la naturaleza del crédito, la caducidad y el respaldo: hay que analizar el detalle antes de ofrecer un monto.',
          $$p.tipo_sujeto = 'compania'
            AND EXISTS (
              SELECT 1 FROM credito_tributario_empresa d
               WHERE d.expediente = p.expediente
                 AND d.diagnostico_ir = 'acumula'
                 AND d.ir_ult >= 10000)$$,
          true, NULL
        )
    `);

    await q.query(`
      INSERT INTO producto_segmento (producto, segmento, prioridad) VALUES
        ('devolucion_impuestos', 'devolucion_iva',   10),
        ('devolucion_impuestos', 'devolucion_renta', 10)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // El FK de producto_segmento y de segmento_miembro va en cascada.
    await q.query(`DELETE FROM segmento WHERE codigo IN ('devolucion_iva', 'devolucion_renta')`);
    await q.query(`DELETE FROM producto WHERE codigo = 'devolucion_impuestos'`);
  }
}
