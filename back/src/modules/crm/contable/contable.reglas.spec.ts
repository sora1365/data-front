import {
  aDesactivar,
  costoHoraDeNomina,
  costoHoraDeTarea,
  estadoTrasMovimiento,
  revisarArticulos,
} from './contable.reglas';

describe('revisarArticulos', () => {
  const bueno = { codigo: 'TON-105A', nombre: 'Tóner HP 105A', precio: 48, iva: 15, stock: 12 };

  it('deja pasar un artículo completo', () => {
    const { validos, rechazos } = revisarArticulos([bueno]);
    expect(rechazos).toEqual([]);
    expect(validos[0]).toMatchObject({ codigo: 'TON-105A', precio: 48, stock: 12, activo: true });
  });

  /**
   * El contable manda su catálogo entero. Rechazar las mil filas por una sin
   * código deja al CRM sin inventario hasta que alguien arregle el otro lado.
   */
  it('guarda lo bueno y rechaza sólo lo malo', () => {
    const { validos, rechazos } = revisarArticulos([
      bueno,
      { nombre: 'Sin código' },
      { codigo: 'X', nombre: '' },
      { codigo: 'Y', nombre: 'Precio raro', precio: -5 },
    ]);
    expect(validos).toHaveLength(1);
    expect(rechazos.map((r) => r.motivo)).toEqual([
      'Sin código.',
      'Sin nombre.',
      'Precio negativo.',
    ]);
  });

  it('dice en qué fila venía cada rechazo', () => {
    const { rechazos } = revisarArticulos([bueno, { nombre: 'mala' }]);
    expect(rechazos[0].fila).toBe(2);
  });

  it('rechaza el mismo código repetido en el lote', () => {
    const { validos, rechazos } = revisarArticulos([bueno, { ...bueno, precio: 99 }]);
    expect(validos).toHaveLength(1);
    expect(rechazos[0].motivo).toMatch(/Repetido/);
  });

  it('rechaza un IVA imposible', () => {
    const { rechazos } = revisarArticulos([{ ...bueno, iva: 150 }]);
    expect(rechazos[0].motivo).toMatch(/IVA/);
  });

  it('acepta un artículo sin precio: hay cosas que se cotizan cada vez', () => {
    const { validos } = revisarArticulos([{ codigo: 'A', nombre: 'Servicio' }]);
    expect(validos[0]).toMatchObject({ precio: null, stock: null });
  });

  it('entiende los números que llegan como texto', () => {
    const { validos } = revisarArticulos([{ ...bueno, precio: '48.50', stock: '3' }]);
    expect(validos[0]).toMatchObject({ precio: 48.5, stock: 3 });
  });
});

describe('aDesactivar', () => {
  /**
   * Desactivar y no borrar: un artículo borrado se lleva por delante las
   * líneas de proforma que lo citaban, y una oferta de hace dos meses tiene
   * que seguir diciendo qué se ofreció.
   */
  it('señala lo que ya no viene en el lote', () => {
    expect(aDesactivar(['A', 'B', 'C'], ['A', 'C'])).toEqual(['B']);
  });

  it('con el lote completo no desactiva nada', () => {
    expect(aDesactivar(['A', 'B'], ['A', 'B'])).toEqual([]);
  });
});

describe('costoHoraDeNomina', () => {
  it('usa el costo hora del contable cuando lo manda', () => {
    expect(costoHoraDeNomina({ costo_hora: 14.5, sueldo_mes: 9999 })).toBe(14.5);
  });

  it('lo calcula del sueldo con la carga patronal', () => {
    // 1.000 + 20 % = 1.200 entre 160 horas = 7,50
    expect(costoHoraDeNomina({ sueldo_mes: 1000, carga_pct: 20, horas_mes: 160 })).toBe(7.5);
  });

  it('sin horas no se puede repartir nada', () => {
    expect(costoHoraDeNomina({ sueldo_mes: 1000, horas_mes: 0 })).toBeNull();
    expect(costoHoraDeNomina({ sueldo_mes: 1000 })).toBeNull();
  });

  it('sin sueldo ni costo hora, no inventa un cero', () => {
    expect(costoHoraDeNomina({})).toBeNull();
  });
});

describe('costoHoraDeTarea', () => {
  const nomina = { contador: 9, senior: 22 };

  it('lo fijado a mano en la tarea gana siempre', () => {
    expect(costoHoraDeTarea({ costo_hora: 25, perfil: 'contador' }, nomina, 12)).toEqual({
      costo: 25,
      origen: 'tarea',
    });
  });

  /**
   * Es lo que hace que un cotizador no se quede con el sueldo del año pasado:
   * sin esto, el costo hora se teclea una vez y todo sale barato sin que nadie
   * lo note.
   */
  it('sin número propio, manda la nómina del perfil', () => {
    expect(costoHoraDeTarea({ perfil: 'senior' }, nomina, 12)).toEqual({
      costo: 22,
      origen: 'perfil',
    });
  });

  it('con un perfil que la nómina no conoce, cae al del cotizador', () => {
    expect(costoHoraDeTarea({ perfil: 'inventado' }, nomina, 12)).toEqual({
      costo: 12,
      origen: 'cotizador',
    });
  });

  it('sin perfil ni número, el del cotizador', () => {
    expect(costoHoraDeTarea({}, nomina, 12).origen).toBe('cotizador');
  });
});

describe('estadoTrasMovimiento', () => {
  it('facturar una pendiente la deja facturada', () => {
    expect(estadoTrasMovimiento('pendiente_facturacion', 'facturada')).toBe('facturada');
  });

  it('el mismo aviso dos veces no cambia nada la segunda', () => {
    expect(estadoTrasMovimiento('facturada', 'facturada')).toBeNull();
    expect(estadoTrasMovimiento('cobrada', 'cobrada')).toBeNull();
  });

  /**
   * Hay ventas que se cobran por adelantado y el documento sale después.
   * Rechazarlo obligaría al contable a inventarse una factura para poder
   * registrar dinero que ya entró.
   */
  it('se puede cobrar sin haber facturado', () => {
    expect(estadoTrasMovimiento('pendiente_facturacion', 'cobrada')).toBe('cobrada');
  });

  /**
   * Retroceder de «cobrada» a «facturada» haría desaparecer la comisión del
   * mes, que se paga sobre lo cobrado.
   */
  it('facturar una ya cobrada no la hace retroceder', () => {
    expect(estadoTrasMovimiento('cobrada', 'facturada')).toBeNull();
  });

  it('anular gana sobre cualquier estado', () => {
    expect(estadoTrasMovimiento('cobrada', 'anulada')).toBe('anulada');
    expect(estadoTrasMovimiento('facturada', 'anulada')).toBe('anulada');
  });

  it('una anulada no revive por un aviso suelto', () => {
    expect(estadoTrasMovimiento('anulada', 'facturada')).toBeNull();
    expect(estadoTrasMovimiento('anulada', 'cobrada')).toBeNull();
  });
});
