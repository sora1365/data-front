import {
  comisionDeVenta,
  cumplimiento,
  reglaAplicable,
  resumenDeComercial,
} from './comisiones.reglas';

const regla = (
  codigo: string,
  porcentaje: number,
  extra: Partial<{ producto: string | null; marca: string | null; desde_cumplimiento: number }> = {},
) => ({
  codigo,
  nombre: codigo,
  producto: null,
  marca: null,
  desde_cumplimiento: 0,
  porcentaje,
  ...extra,
});

const venta = (monto: number, producto = 'auditoria', marca = 'friday') => ({
  producto,
  marca,
  monto,
});

describe('reglaAplicable', () => {
  it('la de producto gana a la de marca y a la general', () => {
    const reglas = [
      regla('general', 5),
      regla('marca', 6, { marca: 'friday' }),
      regla('producto', 8, { producto: 'auditoria' }),
    ];
    expect(reglaAplicable(reglas, venta(100))?.codigo).toBe('producto');
  });

  it('la de marca gana a la general', () => {
    const reglas = [regla('general', 5), regla('marca', 6, { marca: 'friday' })];
    expect(reglaAplicable(reglas, venta(100))?.codigo).toBe('marca');
  });

  it('una regla de otra marca no aplica', () => {
    const reglas = [regla('otra', 9, { marca: 'ascendra' })];
    expect(reglaAplicable(reglas, venta(100))).toBeNull();
  });

  it('sin reglas no hay regla', () => {
    expect(reglaAplicable([], venta(100))).toBeNull();
  });
});

describe('cumplimiento', () => {
  it('es el porcentaje de la meta', () => {
    expect(cumplimiento(750, 1000)).toBe(75);
  });

  it('sin meta no hay cumplimiento, que no es cero', () => {
    expect(cumplimiento(750, null)).toBeNull();
    expect(cumplimiento(750, 0)).toBeNull();
  });
});

describe('comisionDeVenta', () => {
  it('aplica el porcentaje de su regla', () => {
    const linea = comisionDeVenta(venta(1000), [regla('general', 5)], 100);
    expect(linea.comision).toBe(50);
    expect(linea.motivo).toBeNull();
  });

  it('sin regla no paga, y lo dice', () => {
    const linea = comisionDeVenta(venta(1000), [], 100);
    expect(linea.comision).toBe(0);
    expect(linea.motivo).toMatch(/Sin regla/);
  });

  /**
   * Una comisión en cero sin explicación se lee como un error del sistema y
   * acaba en una reclamación; con el motivo al lado, se entiende.
   */
  it('no paga por debajo del umbral y explica por qué', () => {
    const reglas = [regla('general', 5, { desde_cumplimiento: 80 })];
    const linea = comisionDeVenta(venta(1000), reglas, 60);
    expect(linea.comision).toBe(0);
    expect(linea.motivo).toMatch(/80%/);
  });

  it('paga en cuanto se alcanza el umbral', () => {
    const reglas = [regla('general', 5, { desde_cumplimiento: 80 })];
    expect(comisionDeVenta(venta(1000), reglas, 80).comision).toBe(50);
  });

  /**
   * Sin meta cargada no se puede evaluar el umbral. Se paga igual: lo
   * contrario sería no pagarle a alguien por un dato que la empresa no puso.
   */
  it('sin meta, el umbral no bloquea el pago', () => {
    const reglas = [regla('general', 5, { desde_cumplimiento: 80 })];
    expect(comisionDeVenta(venta(1000), reglas, null).comision).toBe(50);
  });

  it('redondea a céntimos', () => {
    const linea = comisionDeVenta(venta(333.33), [regla('general', 7.5)], null);
    expect(linea.comision).toBe(25);
  });
});

describe('resumenDeComercial', () => {
  const reglas = [regla('general', 10)];

  it('la comisión se paga sobre lo cobrado, no sobre lo ganado', () => {
    const r = resumenDeComercial('sora', 1000, [venta(500)], [venta(2000)], reglas);
    expect(r.cobrado).toBe(500);
    expect(r.comision).toBe(50);
    expect(r.porCobrar).toBe(2000);
    expect(r.comisionEnCamino).toBe(200);
  });

  it('el cumplimiento también se mide sobre lo cobrado', () => {
    const r = resumenDeComercial('sora', 1000, [venta(500)], [venta(5000)], reglas);
    expect(r.cumplimiento).toBe(50);
  });

  /**
   * El umbral se evalúa con lo cobrado, así que una venta enorme pendiente de
   * cobro no destraba la comisión del mes.
   */
  it('lo pendiente de cobro no destraba el umbral', () => {
    const conUmbral = [regla('general', 10, { desde_cumplimiento: 80 })];
    const r = resumenDeComercial('sora', 1000, [venta(500)], [venta(5000)], conUmbral);
    expect(r.comision).toBe(0);
    expect(r.comisionEnCamino).toBe(0);
  });

  it('un mes sin nada cobrado no inventa comisión', () => {
    const r = resumenDeComercial('sora', 1000, [], [], reglas);
    expect(r.cobrado).toBe(0);
    expect(r.comision).toBe(0);
    expect(r.cumplimiento).toBe(0);
  });
});
