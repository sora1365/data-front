import {
  calcularCotizacion,
  horasDeTarea,
  precioDesdeCosto,
  problemasDeConfiguracion,
  valoresConDefecto,
  type TareaDeCotizador,
} from './cotizadores.reglas';

const tarea = (extra: Partial<TareaDeCotizador> = {}): TareaDeCotizador => ({
  orden: 1,
  nombre: 'Registro contable',
  horas_fijas: 2,
  horas_por_unidad: 0.05,
  variable: 'transacciones',
  costo_hora: null,
  ...extra,
});

const COTIZADOR = { costo_hora: 12, margen: 35, modo_margen: 'sobre_costo' as const };

describe('horasDeTarea', () => {
  it('suma las fijas y las que dependen de la variable', () => {
    // 2 fijas + 100 transacciones × 0,05 = 7
    expect(horasDeTarea(tarea(), { transacciones: 100 })).toBe(7);
  });

  it('una tarea sin variable cuesta siempre lo mismo', () => {
    expect(horasDeTarea(tarea({ variable: null, horas_fijas: 4 }), { transacciones: 900 })).toBe(4);
  });

  /**
   * Es un error de configuración. Contar sólo las fijas lo deja a la vista en
   * el detalle; multiplicar por cero en silencio lo escondería y reventar
   * tiraría una cotización que estaba a medio hacer.
   */
  it('con una variable que nadie pregunta, cuenta sólo las horas fijas', () => {
    expect(horasDeTarea(tarea({ variable: 'inventada' }), { transacciones: 100 })).toBe(2);
  });

  it('con la variable en cero, quedan las fijas', () => {
    expect(horasDeTarea(tarea(), { transacciones: 0 })).toBe(2);
  });
});

describe('precioDesdeCosto', () => {
  it('sobre el costo: 100 con 30 % son 130', () => {
    expect(precioDesdeCosto(100, 30, 'sobre_costo')).toBe(130);
  });

  /**
   * La diferencia que justifica guardar el modo: con el mismo «30 %», uno
   * cotiza 130 y el otro 142,86. Dejarlo implícito es cotizar por debajo de
   * lo que alguien cree.
   */
  it('sobre el precio: 100 con 30 % son 142,86', () => {
    expect(precioDesdeCosto(100, 30, 'sobre_precio')).toBe(142.86);
  });

  it('sin margen, el precio es el costo', () => {
    expect(precioDesdeCosto(100, 0, 'sobre_costo')).toBe(100);
    expect(precioDesdeCosto(100, 0, 'sobre_precio')).toBe(100);
  });

  it('un margen del 100 % sobre el precio no divide por cero', () => {
    expect(precioDesdeCosto(100, 100, 'sobre_precio')).toBe(100);
  });
});

describe('calcularCotizacion', () => {
  const TAREAS = [
    tarea({ orden: 1, nombre: 'Registro', horas_fijas: 2, horas_por_unidad: 0.05, variable: 'transacciones' }),
    tarea({ orden: 2, nombre: 'Declaraciones', horas_fijas: 4, horas_por_unidad: 0, variable: null }),
    tarea({ orden: 3, nombre: 'Revisión', horas_fijas: 2, horas_por_unidad: 0, variable: null, costo_hora: 25 }),
  ];

  it('el caso del outsourcing contable, de punta a punta', () => {
    const c = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 100 });
    // Registro 7 h × 12 = 84 · Declaraciones 4 h × 12 = 48 · Revisión 2 h × 25 = 50
    expect(c.horas).toBe(13);
    expect(c.costo).toBe(182);
    expect(c.precio).toBe(245.7);
    expect(c.ganancia).toBe(63.7);
  });

  it('una tarea con su propio costo hora no usa el del cotizador', () => {
    const c = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 100 });
    expect(c.detalle[2]).toMatchObject({ costo_hora: 25, costo: 50 });
  });

  it('más transacciones, más horas y más precio', () => {
    const poca = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 100 });
    const mucha = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 500 });
    expect(mucha.horas).toBeGreaterThan(poca.horas);
    expect(mucha.precio).toBeGreaterThan(poca.precio);
  });

  it('el detalle dice qué variable movió cada tarea, para poder explicarlo', () => {
    const c = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 100 });
    expect(c.detalle[0]).toMatchObject({ variable: 'transacciones', valor: 100 });
    expect(c.detalle[1].variable).toBeNull();
  });

  it('el costo total es la suma de lo que se ve en cada tarea', () => {
    const c = calcularCotizacion(COTIZADOR, TAREAS, { transacciones: 137 });
    const suma = c.detalle.reduce((s, l) => s + l.costo, 0);
    expect(c.costo).toBe(Math.round(suma * 100) / 100);
  });

  it('ordena el detalle aunque las tareas vengan desordenadas', () => {
    const revueltas = [TAREAS[2], TAREAS[0], TAREAS[1]];
    const c = calcularCotizacion(COTIZADOR, revueltas, { transacciones: 100 });
    expect(c.detalle.map((l) => l.orden)).toEqual([1, 2, 3]);
  });

  it('sin tareas no inventa un precio', () => {
    const c = calcularCotizacion(COTIZADOR, [], {});
    expect(c).toMatchObject({ horas: 0, costo: 0, precio: 0, ganancia: 0 });
  });
});

describe('problemasDeConfiguracion', () => {
  const variables = [{ codigo: 'transacciones' }];

  it('no se queja de un cotizador bien puesto', () => {
    expect(problemasDeConfiguracion([tarea()], variables)).toEqual([]);
  });

  it('avisa de una tarea que multiplica por una variable que no existe', () => {
    const problemas = problemasDeConfiguracion([tarea({ variable: 'empleados' })], variables);
    expect(problemas[0]).toMatch(/empleados/);
  });

  it('avisa de una variable que no cambia nada', () => {
    const problemas = problemasDeConfiguracion([tarea({ horas_por_unidad: 0 })], variables);
    expect(problemas[0]).toMatch(/no suma horas/);
  });

  it('un cotizador sin tareas no cotiza nada', () => {
    expect(problemasDeConfiguracion([], variables)).toContain(
      'El cotizador no tiene ninguna tarea.',
    );
  });
});

describe('valoresConDefecto', () => {
  const variables = [
    { codigo: 'transacciones', valor_defecto: 100 },
    { codigo: 'empleados', valor_defecto: 5 },
  ];

  it('usa lo que escribió la persona', () => {
    expect(valoresConDefecto(variables, { transacciones: 300 })).toEqual({
      transacciones: 300,
      empleados: 5,
    });
  });

  /**
   * El defecto es un número plausible, no cero: un cero en «transacciones al
   * mes» da una cotización baratísima que nadie mira dos veces.
   */
  it('rellena con el defecto lo que falta', () => {
    expect(valoresConDefecto(variables, {})).toEqual({ transacciones: 100, empleados: 5 });
  });

  it('un cero escrito a mano sí es un cero', () => {
    expect(valoresConDefecto(variables, { transacciones: 0 }).transacciones).toBe(0);
  });

  it('lo que no es un número cae al defecto', () => {
    expect(valoresConDefecto(variables, { transacciones: 'muchas' }).transacciones).toBe(100);
  });
});
