import {
  calcularTotales,
  estadoVisible,
  estaVencida,
  numeroDeProforma,
  problemasParaEnviar,
  sePuedeEditar,
  sePuedeEnviar,
  sePuedeResponder,
} from './proformas.reglas';

const linea = (extra: Partial<Parameters<typeof calcularTotales>[0][0]> = {}) => ({
  descripcion: 'Auditoría externa',
  cantidad: 1,
  precio_unitario: 1000,
  descuento_pct: 0,
  iva_pct: 15,
  ...extra,
});

describe('calcularTotales', () => {
  it('cantidad por precio, más el IVA', () => {
    const t = calcularTotales([linea({ cantidad: 2, precio_unitario: 500 })]);
    expect(t.subtotal).toBe(1000);
    expect(t.iva).toBe(150);
    expect(t.total).toBe(1150);
  });

  it('el descuento sale aparte y el IVA va sobre lo que queda', () => {
    const t = calcularTotales([linea({ descuento_pct: 10 })]);
    expect(t.subtotal).toBe(1000);
    expect(t.descuento).toBe(100);
    expect(t.iva).toBe(135);
    expect(t.total).toBe(1035);
  });

  it('respeta la tarifa cero de un servicio exento', () => {
    const t = calcularTotales([linea({ iva_pct: 0 })]);
    expect(t.iva).toBe(0);
    expect(t.total).toBe(1000);
  });

  it('mezcla tarifas distintas en el mismo documento', () => {
    const t = calcularTotales([linea({ iva_pct: 15 }), linea({ iva_pct: 0 })]);
    expect(t.subtotal).toBe(2000);
    expect(t.iva).toBe(150);
    expect(t.total).toBe(2150);
  });

  /**
   * Se redondea por línea y después se suma. Sumando los valores largos y
   * redondeando al final, el total no cuadra con la suma de lo que el cliente
   * ve impreso, y esa diferencia de un céntimo es la que hace que llame.
   */
  it('el total es la suma de lo que se imprime en cada línea', () => {
    const t = calcularTotales([
      linea({ precio_unitario: 33.33, cantidad: 3 }),
      linea({ precio_unitario: 16.67, cantidad: 3 }),
    ]);
    const sumaDeLineas = t.lineas.reduce((s, l) => s + l.total, 0);
    expect(t.total).toBe(Math.round(sumaDeLineas * 100) / 100);
  });

  it('sin líneas, todo en cero y sin reventar', () => {
    const t = calcularTotales([]);
    expect(t).toMatchObject({ subtotal: 0, descuento: 0, iva: 0, total: 0 });
  });

  it('un descuento del 100 % deja la línea en cero', () => {
    const t = calcularTotales([linea({ descuento_pct: 100 })]);
    expect(t.total).toBe(0);
    expect(t.iva).toBe(0);
  });
});

describe('qué se puede hacer según el estado', () => {
  /**
   * El cliente tiene en la mano un documento con un número; cambiarle los
   * precios por detrás y que siga llamándose igual es perder la discusión
   * sobre lo que se acordó.
   */
  it('una enviada ya no se edita', () => {
    expect(sePuedeEditar('borrador')).toBe(true);
    expect(sePuedeEditar('enviada')).toBe(false);
    expect(sePuedeEditar('aceptada')).toBe(false);
  });

  it('se puede reenviar una enviada, pero no una cerrada', () => {
    expect(sePuedeEnviar('enviada')).toBe(true);
    expect(sePuedeEnviar('aceptada')).toBe(false);
    expect(sePuedeEnviar('anulada')).toBe(false);
  });

  it('sólo contesta quien recibió algo', () => {
    expect(sePuedeResponder('enviada')).toBe(true);
    expect(sePuedeResponder('borrador')).toBe(false);
    expect(sePuedeResponder('aceptada')).toBe(false);
  });
});

describe('vencimiento', () => {
  it('el último día todavía vale', () => {
    expect(estaVencida('2026-10-30', '2026-10-30')).toBe(false);
    expect(estaVencida('2026-10-30', '2026-10-31')).toBe(true);
  });

  it('una enviada con la fecha pasada se lee «vencida»', () => {
    expect(estadoVisible('enviada', '2026-10-01', '2026-10-22')).toBe('vencida');
  });

  it('una aceptada no vence: ya se cerró', () => {
    expect(estadoVisible('aceptada', '2026-10-01', '2026-10-22')).toBe('aceptada');
  });

  it('un borrador con fecha pasada sigue siendo borrador', () => {
    expect(estadoVisible('borrador', '2026-10-01', '2026-10-22')).toBe('borrador');
  });
});

describe('numeroDeProforma', () => {
  it('se rellena con ceros para que ordene como texto', () => {
    expect(numeroDeProforma(2026, 1)).toBe('P-2026-0001');
    expect(numeroDeProforma(2026, 142)).toBe('P-2026-0142');
  });
});

describe('problemasParaEnviar', () => {
  const buena = {
    correo: 'cliente@example.com',
    lineas: [linea()],
    total: 1150,
    valida_hasta: '2026-11-30',
  };

  it('deja pasar una proforma completa', () => {
    expect(problemasParaEnviar(buena, '2026-10-22')).toEqual([]);
  });

  /**
   * Se dicen todos juntos: enviar es irreversible, y descubrir los problemas
   * de uno en uno acaba con tres versiones en el buzón del cliente.
   */
  it('dice todo lo que falta de una vez', () => {
    const problemas = problemasParaEnviar(
      { correo: null, lineas: [], total: 0, valida_hasta: '2026-01-01' },
      '2026-10-22',
    );
    expect(problemas).toHaveLength(4);
  });

  it('no deja mandar una oferta que nace vencida', () => {
    expect(problemasParaEnviar({ ...buena, valida_hasta: '2026-10-01' }, '2026-10-22')).toEqual([
      'La fecha de validez ya pasó: ponle una nueva antes de enviarla.',
    ]);
  });
});
