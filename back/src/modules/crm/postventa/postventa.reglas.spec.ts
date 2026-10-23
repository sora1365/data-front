import {
  clasificar,
  diasEntreDias,
  fechaDeRenovacion,
  renovacionesQueTocan,
  resumirEncuestas,
} from './postventa.reglas';

describe('fechaDeRenovacion', () => {
  it('un mes para lo mensual, un año para lo anual', () => {
    expect(fechaDeRenovacion('mensual', '2026-10-22')).toBe('2026-11-22');
    expect(fechaDeRenovacion('anual', '2026-10-22')).toBe('2027-10-22');
  });

  /**
   * Sumando meses a la brava, el 31 de enero se convierte en el 3 de marzo:
   * los días que sobran desbordan al mes siguiente. Un contrato que empieza el
   * 31 vence el 28.
   */
  it('el último día del mes no se desborda al siguiente', () => {
    expect(fechaDeRenovacion('mensual', '2026-01-31')).toBe('2026-02-28');
    expect(fechaDeRenovacion('mensual', '2026-03-31')).toBe('2026-04-30');
  });

  it('respeta los bisiestos', () => {
    expect(fechaDeRenovacion('mensual', '2028-01-31')).toBe('2028-02-29');
    expect(fechaDeRenovacion('anual', '2028-02-29')).toBe('2029-02-28');
  });

  it('cruza el año sin perderse', () => {
    expect(fechaDeRenovacion('mensual', '2026-12-15')).toBe('2027-01-15');
  });

  /**
   * Inventarle fecha a lo que se vende una sola vez llenaría la lista de
   * avisos de cosas que no hay que renovar, y una lista que miente no se mira.
   */
  it('lo de una sola vez no se renueva', () => {
    expect(fechaDeRenovacion('unica', '2026-10-22')).toBeNull();
    expect(fechaDeRenovacion(null, '2026-10-22')).toBeNull();
  });

  it('una fecha ilegible no inventa una renovación', () => {
    expect(fechaDeRenovacion('anual', 'el martes')).toBeNull();
  });
});

describe('renovacionesQueTocan', () => {
  const venta = (id: number, renueva_en: string | null, extra = {}) => ({
    id,
    renueva_en,
    renovada_en: null,
    estado: 'cobrada',
    ...extra,
  });

  const HOY = '2026-10-22';

  it('avisa de lo que vence dentro del plazo', () => {
    const tocan = renovacionesQueTocan([venta(1, '2026-11-15'), venta(2, '2027-06-01')], HOY, 45);
    expect(tocan.map((v) => v.id)).toEqual([1]);
    expect(tocan[0].dias).toBe(24);
  });

  /**
   * Una renovación que pasó de fecha no desaparece del problema: se convierte
   * en el problema.
   */
  it('lo vencido sigue en la lista, y marcado', () => {
    const tocan = renovacionesQueTocan([venta(1, '2026-09-30')], HOY, 45);
    expect(tocan[0]).toMatchObject({ vencida: true, dias: -22 });
  });

  it('lo ya renovado sale de la lista', () => {
    const tocan = renovacionesQueTocan(
      [venta(1, '2026-11-01', { renovada_en: '2026-10-20' })],
      HOY,
    );
    expect(tocan).toEqual([]);
  });

  it('una venta anulada no se renueva', () => {
    expect(renovacionesQueTocan([venta(1, '2026-11-01', { estado: 'anulada' })], HOY)).toEqual([]);
  });

  it('lo que no tiene fecha no estorba', () => {
    expect(renovacionesQueTocan([venta(1, null)], HOY)).toEqual([]);
  });

  it('lo más urgente va primero', () => {
    const tocan = renovacionesQueTocan(
      [venta(1, '2026-11-20'), venta(2, '2026-10-01'), venta(3, '2026-11-01')],
      HOY,
      45,
    );
    expect(tocan.map((v) => v.id)).toEqual([2, 3, 1]);
  });
});

describe('clasificar', () => {
  it('usa los cortes de siempre del NPS', () => {
    expect(clasificar(10)).toBe('promotor');
    expect(clasificar(9)).toBe('promotor');
    expect(clasificar(8)).toBe('pasivo');
    expect(clasificar(7)).toBe('pasivo');
    expect(clasificar(6)).toBe('detractor');
    expect(clasificar(0)).toBe('detractor');
  });
});

describe('resumirEncuestas', () => {
  const r = (puntaje: number | null) => ({ puntaje });

  it('cuenta promotores, pasivos y detractores', () => {
    const resumen = resumirEncuestas([r(10), r(9), r(8), r(3)]);
    expect(resumen).toMatchObject({ respuestas: 4, promotores: 2, pasivos: 1, detractores: 1 });
  });

  /**
   * Dejar los pasivos fuera del denominador infla el número justo cuando hay
   * muchos clientes tibios, que es cuando más importa saberlo.
   */
  it('los pasivos no suman pero sí cuentan', () => {
    // 2 promotores, 1 detractor, 1 pasivo sobre 4: (2-1)/4 = 25
    expect(resumirEncuestas([r(10), r(9), r(8), r(3)]).nps).toBe(25);
    // Sin el pasivo en el denominador saldría 33, que es el error típico.
  });

  it('todos promotores es cien', () => {
    expect(resumirEncuestas([r(9), r(10)]).nps).toBe(100);
  });

  it('todos detractores es menos cien', () => {
    expect(resumirEncuestas([r(2), r(6)]).nps).toBe(-100);
  });

  /**
   * Un cero se lee como «vamos regular». La verdad, sin respuestas, es que no
   * se sabe.
   */
  it('sin respuestas no hay NPS, que no es cero', () => {
    expect(resumirEncuestas([]).nps).toBeNull();
    expect(resumirEncuestas([r(null)]).nps).toBeNull();
  });

  it('ignora las encuestas mandadas y sin contestar', () => {
    expect(resumirEncuestas([r(10), r(null)]).respuestas).toBe(1);
  });

  it('da también el promedio, con un decimal', () => {
    expect(resumirEncuestas([r(10), r(7)]).promedio).toBe(8.5);
  });
});

describe('diasEntreDias', () => {
  it('cuenta en UTC para no perder un día con el horario', () => {
    expect(diasEntreDias('2026-10-24', '2026-10-26')).toBe(2);
  });
});
