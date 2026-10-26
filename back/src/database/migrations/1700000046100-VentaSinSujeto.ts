import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una venta puede ser de una empresa que no está en el padrón.
 *
 * `crm.venta` nació exigiendo `(tipo_sujeto, clave)` cuando el cliente **era**
 * un sujeto del padrón. Desde `EmpresaPropia` el cliente es `crm.empresa`
 * —enlazada a la venta por `company_id`— y el sujeto es opcional: un
 * proveedor extranjero, una empresa recién creada o un lead que llegó por la
 * web no lo tienen. Con la columna obligatoria, ganar la oportunidad de
 * cualquiera de ellos fallaba con un 500 y la venta no llegaba al contable.
 *
 * El sujeto se sigue copiando cuando existe, porque la venta congela los
 * datos con los que se ganó.
 */
export class VentaSinSujeto1700000046100 implements MigrationInterface {
  name = 'VentaSinSujeto1700000046100';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.venta ALTER COLUMN tipo_sujeto DROP NOT NULL`);
    await q.query(`ALTER TABLE crm.venta ALTER COLUMN clave DROP NOT NULL`);
  }

  /** Falla si ya hay ventas sin sujeto: deshacerla obligaría a inventarles uno. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE crm.venta ALTER COLUMN tipo_sujeto SET NOT NULL`);
    await q.query(`ALTER TABLE crm.venta ALTER COLUMN clave SET NOT NULL`);
  }
}
