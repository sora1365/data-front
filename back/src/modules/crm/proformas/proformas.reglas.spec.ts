import {
  cadenaDeSupervisores,
  calcularTotales,
  descuentoMayor,
  esMotivoDeRechazo,
  estadoVisible,
  estaVencida,
  firmaVigente,
  nivelRequerido,
  numeroDeProforma,
  numeroDeVersion,
  problemasParaEnviar,
  puedeAprobar,
  sePuedeEditar,
  sePuedeEnviar,
  sePuedeResponder,
  sePuedeVersionar,
  telefonoParaWhatsapp,
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

// ------------------------------------------------- propuestas: negociación

describe('líneas opcionales', () => {
  it('una opcional sin contestar no suma', () => {
    const t = calcularTotales([linea(), linea({ precio_unitario: 400, opcional: true })]);
    expect(t.subtotal).toBe(1000);
    expect(t.total).toBe(1150);
  });

  it('suma cuando el cliente la elige, y no cuando la descarta', () => {
    const elegida = calcularTotales([
      linea(),
      linea({ precio_unitario: 400, opcional: true, incluida: true }),
    ]);
    expect(elegida.subtotal).toBe(1400);

    const descartada = calcularTotales([
      linea(),
      linea({ precio_unitario: 400, opcional: true, incluida: false }),
    ]);
    expect(descartada.subtotal).toBe(1000);
  });
});

describe('versiones', () => {
  it('la primera conserva el número; las siguientes llevan sufijo', () => {
    expect(numeroDeVersion('P-2026-0007', 1)).toBe('P-2026-0007');
    expect(numeroDeVersion('P-2026-0007', 2)).toBe('P-2026-0007-v2');
  });

  it('versionar una versión no apila sufijos', () => {
    expect(numeroDeVersion('P-2026-0007-v2', 3)).toBe('P-2026-0007-v3');
  });

  it('sólo se versiona lo que el cliente tiene en la mano', () => {
    expect(sePuedeVersionar('enviada')).toBe(true);
    expect(sePuedeVersionar('rechazada')).toBe(true);
    expect(sePuedeVersionar('borrador')).toBe(false);
    expect(sePuedeVersionar('aceptada')).toBe(false);
    expect(sePuedeVersionar('anulada')).toBe(false);
    expect(sePuedeVersionar('reemplazada')).toBe(false);
  });

  it('una reemplazada no admite respuesta del cliente', () => {
    expect(sePuedeResponder('reemplazada')).toBe(false);
  });
});

describe('motivos de rechazo', () => {
  it('sólo los de la lista', () => {
    expect(esMotivoDeRechazo('precio')).toBe(true);
    expect(esMotivoDeRechazo('caro')).toBe(false);
    expect(esMotivoDeRechazo('toString')).toBe(false);
  });
});

describe('aprobación de descuentos', () => {
  const topes = [
    { nivel: 'libre' as const, hasta_pct: 10 },
    { nivel: 'supervisor' as const, hasta_pct: 25 },
    { nivel: 'direccion' as const, hasta_pct: 100 },
  ];

  it('cuenta el mayor descuento de línea, no el medio', () => {
    expect(descuentoMayor([linea({ descuento_pct: 5 }), linea({ descuento_pct: 60 })])).toBe(60);
  });

  it('cada tope incluye su límite', () => {
    expect(nivelRequerido(0, topes)).toBe('libre');
    expect(nivelRequerido(10, topes)).toBe('libre');
    expect(nivelRequerido(10.5, topes)).toBe('supervisor');
    expect(nivelRequerido(25, topes)).toBe('supervisor');
    expect(nivelRequerido(40, topes)).toBe('direccion');
  });

  it('por encima de todos los topes firma dirección', () => {
    expect(nivelRequerido(50, [{ nivel: 'libre', hasta_pct: 10 }])).toBe('direccion');
  });

  it('una firma cubre bajar el descuento, no subirlo', () => {
    expect(firmaVigente(20, 20)).toBe(true);
    expect(firmaVigente(15, 20)).toBe(true);
    expect(firmaVigente(22, 20)).toBe(false);
    expect(firmaVigente(5, null)).toBe(false);
  });

  const supervisorDe = new Map<string, string | null>([
    ['ana', 'beto'],
    ['beto', 'carla'],
    ['carla', null],
  ]);

  it('la cadena va del más cercano al más alto', () => {
    expect(cadenaDeSupervisores('ana', supervisorDe)).toEqual(['beto', 'carla']);
    expect(cadenaDeSupervisores('carla', supervisorDe)).toEqual([]);
  });

  it('un círculo no cuelga la cadena', () => {
    const circulo = new Map<string, string | null>([['x', 'y'], ['y', 'x']]);
    expect(cadenaDeSupervisores('x', circulo)).toEqual(['y']);
  });

  it('nivel supervisor: cualquiera por encima, nunca uno mismo', () => {
    const cadena = ['beto', 'carla'];
    expect(puedeAprobar('supervisor', 'ana', 'beto', cadena).permitido).toBe(true);
    expect(puedeAprobar('supervisor', 'ana', 'carla', cadena).permitido).toBe(true);
    expect(puedeAprobar('supervisor', 'ana', 'ana', cadena).permitido).toBe(false);
    expect(puedeAprobar('supervisor', 'ana', 'diego', cadena).permitido).toBe(false);
  });

  it('nivel dirección: sólo la cima', () => {
    const cadena = ['beto', 'carla'];
    expect(puedeAprobar('direccion', 'ana', 'carla', cadena).permitido).toBe(true);
    expect(puedeAprobar('direccion', 'ana', 'beto', cadena).permitido).toBe(false);
  });

  it('quien no responde a nadie firma lo suyo', () => {
    expect(puedeAprobar('direccion', 'carla', 'carla', []).permitido).toBe(true);
    expect(puedeAprobar('direccion', 'carla', 'beto', []).permitido).toBe(false);
  });
});

describe('teléfono para WhatsApp', () => {
  it('cambia el cero local por el 593', () => {
    expect(telefonoParaWhatsapp('099 123 4567')).toBe('593991234567');
    expect(telefonoParaWhatsapp('+593 99 123 4567')).toBe('593991234567');
  });

  it('sin número utilizable, nada', () => {
    expect(telefonoParaWhatsapp('')).toBeNull();
    expect(telefonoParaWhatsapp('ext. 12')).toBeNull();
  });
});
