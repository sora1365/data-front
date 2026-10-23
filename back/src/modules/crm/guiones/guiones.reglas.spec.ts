import { guionAplicable, limpiarObjeciones, limpiarPreguntas } from './guiones.reglas';

const g = (codigo: string, producto: string | null, segmento: string | null, activo = true) => ({
  codigo,
  nombre: codigo,
  producto,
  segmento,
  activo,
});

describe('guionAplicable', () => {
  const guiones = [
    g('general', null, null),
    g('por_producto', 'contabilidad_mes', null),
    g('por_segmento', null, 'companias_recien_creadas'),
    g('exacto', 'contabilidad_mes', 'companias_recien_creadas'),
  ];

  it('el de producto y segmento gana a todos', () => {
    const elegido = guionAplicable(guiones, {
      producto: 'contabilidad_mes',
      segmento: 'companias_recien_creadas',
    });
    expect(elegido?.codigo).toBe('exacto');
  });

  it('el de producto gana al de segmento', () => {
    const elegido = guionAplicable(guiones, {
      producto: 'contabilidad_mes',
      segmento: 'otro_segmento',
    });
    expect(elegido?.codigo).toBe('por_producto');
  });

  it('sin producto, manda el del segmento', () => {
    const elegido = guionAplicable(guiones, { segmento: 'companias_recien_creadas' });
    expect(elegido?.codigo).toBe('por_segmento');
  });

  it('sin nada que case, queda el general', () => {
    expect(guionAplicable(guiones, { producto: 'otro', segmento: 'otro' })?.codigo).toBe('general');
  });

  it('sin guiones no hay guion', () => {
    expect(guionAplicable([], { producto: 'x' })).toBeNull();
  });

  it('sin general y sin coincidencias, tampoco', () => {
    expect(guionAplicable([g('x', 'otro', null)], { producto: 'contabilidad_mes' })).toBeNull();
  });

  it('un guion desactivado no sale aunque sea el más específico', () => {
    const elegido = guionAplicable(
      [g('general', null, null), g('exacto', 'contabilidad_mes', null, false)],
      { producto: 'contabilidad_mes' },
    );
    expect(elegido?.codigo).toBe('general');
  });
});

describe('limpiarObjeciones', () => {
  it('deja pasar las completas', () => {
    expect(
      limpiarObjeciones([{ objecion: 'Ya tengo contador', respuesta: 'Entonces le propongo…' }]),
    ).toHaveLength(1);
  });

  /**
   * Media objeción en la pantalla de alguien que está llamando es peor que
   * ninguna: la lee y se queda a medias.
   */
  it('tira las que no tienen respuesta', () => {
    expect(limpiarObjeciones([{ objecion: 'Es caro', respuesta: '  ' }])).toEqual([]);
  });

  it('tira las filas vacías que quedan al editar', () => {
    expect(limpiarObjeciones([{ objecion: '', respuesta: '' }, null, undefined])).toEqual([]);
  });

  it('recorta los espacios', () => {
    expect(limpiarObjeciones([{ objecion: '  Es caro  ', respuesta: ' Depende  ' }])).toEqual([
      { objecion: 'Es caro', respuesta: 'Depende' },
    ]);
  });

  it('lo que no es una lista no revienta', () => {
    expect(limpiarObjeciones('nada')).toEqual([]);
    expect(limpiarObjeciones(undefined)).toEqual([]);
  });
});

describe('limpiarPreguntas', () => {
  it('quita las vacías y recorta', () => {
    expect(limpiarPreguntas([' ¿Quién les lleva la contabilidad? ', '', null])).toEqual([
      '¿Quién les lleva la contabilidad?',
    ]);
  });
});
