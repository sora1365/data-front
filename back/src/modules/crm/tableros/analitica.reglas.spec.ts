import {
  alertas,
  cuelloDeBotella,
  periodoAnterior,
  probabilidadObservada,
  pronostico,
  sumarMeses,
  tasaDeFila,
  tiemposPorEtapa,
  validarDefinicion,
  variacion,
  type DatosDeAlertas,
} from './analitica.reglas';

const etapas = [
  { codigo: 'contacto', nombre: 'Por contactar', orden: 1, es_ganada: false, es_perdida: false },
  { codigo: 'propuesta', nombre: 'Propuesta', orden: 2, es_ganada: false, es_perdida: false },
  { codigo: 'negociacion', nombre: 'Negociación', orden: 3, es_ganada: false, es_perdida: false },
  { codigo: 'ganada', nombre: 'Ganada', orden: 4, es_ganada: true, es_perdida: false },
  { codigo: 'perdida', nombre: 'Perdida', orden: 5, es_ganada: false, es_perdida: true },
];

const paso = (oportunidad: number, hasta: string, dia: number) => ({
  oportunidad,
  hasta,
  ocurrido_en: new Date(2026, 0, dia).toISOString(),
});

describe('sumarMeses', () => {
  it('cruza el año', () => {
    expect(sumarMeses('2026-11', 2)).toBe('2027-01');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
  });
});

describe('probabilidadObservada', () => {
  it('cuenta sólo las cerradas que pasaron por cada etapa', () => {
    const pasos = [
      paso(1, 'contacto', 1), paso(1, 'propuesta', 2), paso(1, 'ganada', 3),
      paso(2, 'contacto', 1), paso(2, 'propuesta', 2), paso(2, 'perdida', 3),
      paso(3, 'contacto', 1), paso(3, 'perdida', 2),
      // Abierta: no dice nada todavía.
      paso(4, 'contacto', 1), paso(4, 'propuesta', 2),
    ];
    const r = probabilidadObservada(etapas, pasos, 1);
    expect(r.find((e) => e.codigo === 'contacto')).toEqual({ codigo: 'contacto', probabilidad: 33.3, muestra: 3 });
    expect(r.find((e) => e.codigo === 'propuesta')).toEqual({ codigo: 'propuesta', probabilidad: 50, muestra: 2 });
  });

  it('una ganada pasó por todo el recorrido aunque saltara etapas', () => {
    const r = probabilidadObservada(etapas, [paso(1, 'contacto', 1), paso(1, 'ganada', 2)], 1);
    expect(r.find((e) => e.codigo === 'negociacion')?.probabilidad).toBe(100);
  });

  it('una perdida que se reabrió y se ganó es una ganada', () => {
    const r = probabilidadObservada(
      etapas,
      [paso(1, 'contacto', 1), paso(1, 'perdida', 2), paso(1, 'propuesta', 3), paso(1, 'ganada', 4)],
      1,
    );
    expect(r.find((e) => e.codigo === 'contacto')?.probabilidad).toBe(100);
  });

  it('con poca muestra no se inventa un porcentaje', () => {
    const r = probabilidadObservada(etapas, [paso(1, 'contacto', 1), paso(1, 'ganada', 2)]);
    expect(r[0].probabilidad).toBeNull();
    expect(r[0].muestra).toBe(1);
  });
});

describe('pronostico', () => {
  const hoy = '2026-10-15';
  const op = (monto: number, etapa: string, probabilidad: number, cierre: string | null) => ({
    id: Math.random(), monto, etapa, probabilidad, cierre_estimado: cierre,
  });

  it('reparte por mes de cierre y pondera por la etapa', () => {
    const p = pronostico(
      [op(1000, 'propuesta', 50, '2026-10-30'), op(2000, 'negociacion', 75, '2026-11-10')],
      new Map(),
      hoy,
    );
    expect(p.meses.map((m) => m.mes)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(p.meses[0]).toMatchObject({ cuenta: 1, abierto: 1000, ponderado: 500, comprometido: 0 });
    expect(p.meses[1]).toMatchObject({ abierto: 2000, ponderado: 1500, comprometido: 2000 });
  });

  it('las atrasadas no inflan el mes en curso', () => {
    const p = pronostico([op(5000, 'propuesta', 50, '2026-08-01')], new Map(), hoy);
    expect(p.meses[0].abierto).toBe(0);
    expect(p.atrasadas).toEqual({ cuenta: 1, monto: 5000 });
  });

  it('sin fecha va aparte', () => {
    const p = pronostico([op(300, 'contacto', 10, null)], new Map(), hoy);
    expect(p.sinFecha).toEqual({ cuenta: 1, monto: 300 });
  });

  it('la observada se usa sólo si todas las etapas del mes la tienen', () => {
    const conTodas = pronostico(
      [op(1000, 'propuesta', 50, '2026-10-20')],
      new Map([['propuesta', 20]]),
      hoy,
    );
    expect(conTodas.meses[0].ponderadoObservado).toBe(200);

    const conHueco = pronostico(
      [op(1000, 'propuesta', 50, '2026-10-20'), op(1000, 'contacto', 10, '2026-10-21')],
      new Map([['propuesta', 20], ['contacto', null]]),
      hoy,
    );
    expect(conHueco.meses[0].ponderadoObservado).toBeNull();
  });
});

describe('tiempos por etapa', () => {
  it('mide estancias terminadas, no las que siguen dentro', () => {
    const t = tiemposPorEtapa(
      [
        paso(1, 'contacto', 1), paso(1, 'propuesta', 3), paso(1, 'ganada', 13),
        paso(2, 'contacto', 1), paso(2, 'propuesta', 5),
      ],
      etapas,
    );
    expect(t.find((e) => e.codigo === 'contacto')).toMatchObject({ salidas: 2, diasMedios: 3, diasMediana: 3 });
    expect(t.find((e) => e.codigo === 'propuesta')).toMatchObject({ salidas: 1, diasMedios: 10 });
    expect(t.find((e) => e.codigo === 'negociacion')?.diasMedios).toBeNull();
  });

  it('el cuello de botella exige muestra', () => {
    const tiempos = [
      { codigo: 'a', salidas: 10, diasMedios: 4, diasMediana: 4 },
      { codigo: 'b', salidas: 8, diasMedios: 30, diasMediana: 12 },
      { codigo: 'c', salidas: 2, diasMedios: 90, diasMediana: 90 },
    ];
    expect(cuelloDeBotella(tiempos)?.codigo).toBe('b');
    expect(cuelloDeBotella([tiempos[2]])).toBeNull();
    expect(cuelloDeBotella([{ codigo: 'd', salidas: 20, diasMedios: 0.2, diasMediana: 0.1 }])).toBeNull();
  });
});

describe('alertas', () => {
  const base: DatosDeAlertas = {
    hoy: '2026-10-15',
    meta: null,
    vendidoMes: 0,
    vendidoAnioAnterior: 0,
    ponderadoRestante: 0,
    abiertas: 0,
    estancadas: 0,
    atrasadas: 0,
    proformasSinAbrir: 0,
    aprobacionesPendientes: 0,
    serieMensual: [],
  };
  const codigos = (d: Partial<DatosDeAlertas>) => alertas({ ...base, ...d }).map((a) => a.codigo);

  it('sin nada raro, nada', () => {
    expect(codigos({})).toEqual([]);
  });

  it('el ritmo compara con lo que toca a estas alturas, no con la meta entera', () => {
    // Día 15 de 31: tocarían ~4.839 de 10.000.
    expect(codigos({ meta: 10000, vendidoMes: 4500, ponderadoRestante: 99999 })).not.toContain('ritmo');
    expect(codigos({ meta: 10000, vendidoMes: 3000, ponderadoRestante: 99999 })).toContain('ritmo');
  });

  it('los primeros días del mes no saltan', () => {
    expect(codigos({ hoy: '2026-10-03', meta: 10000, vendidoMes: 0, ponderadoRestante: 99999 })).not.toContain('ritmo');
  });

  it('cobertura: lo que falta frente a lo que puede entrar', () => {
    expect(codigos({ meta: 10000, vendidoMes: 6000, ponderadoRestante: 3000 })).toContain('cobertura');
    expect(codigos({ meta: 10000, vendidoMes: 6000, ponderadoRestante: 5000 })).not.toContain('cobertura');
  });

  it('caída frente al año anterior', () => {
    expect(codigos({ vendidoMes: 7000, vendidoAnioAnterior: 10000 })).toContain('anual');
    expect(codigos({ vendidoMes: 9000, vendidoAnioAnterior: 10000 })).not.toContain('anual');
  });

  it('anomalía sólo pasada la mitad del mes', () => {
    const serie = [10000, 11000, 9000, 10500, 9500, 10000];
    expect(codigos({ hoy: '2026-10-20', vendidoMes: 1000, serieMensual: serie })).toContain('anomalia');
    expect(codigos({ hoy: '2026-10-10', vendidoMes: 100, serieMensual: serie })).not.toContain('anomalia');
  });

  it('estancadas: proporción y mínimo', () => {
    expect(codigos({ abiertas: 10, estancadas: 4 })).toContain('estancadas');
    expect(codigos({ abiertas: 4, estancadas: 2 })).not.toContain('estancadas');
  });

  it('las altas van primero', () => {
    const lista = alertas({ ...base, meta: 10000, vendidoMes: 0, atrasadas: 2 });
    expect(lista[0].nivel).toBe('alta');
  });
});

describe('reportes', () => {
  it('acepta lo que está en las listas', () => {
    const r = validarDefinicion({
      dimension: 'producto',
      metricas: ['vendido', 'ganadas', 'vendido'],
      desde: '2026-01-01',
      hasta: '2026-02-01',
    });
    expect(r.errores).toEqual([]);
    expect(r.definicion?.metricas).toEqual(['vendido', 'ganadas']);
  });

  it('rechaza dimensiones y métricas inventadas', () => {
    const r = validarDefinicion({
      dimension: 'o.monto; DROP TABLE crm.venta',
      metricas: ['vendido', 'sum(1)'],
      desde: '2026-01-01',
      hasta: '2026-02-01',
    });
    expect(r.definicion).toBeUndefined();
    expect(r.errores.length).toBe(2);
  });

  it('un programado puede ir sin periodo', () => {
    expect(validarDefinicion({ dimension: 'mes', metricas: ['vendido'] }, { exigirPeriodo: false }).errores).toEqual([]);
    expect(validarDefinicion({ dimension: 'mes', metricas: ['vendido'] }).errores.length).toBe(1);
  });

  it('tasa de cierre de una fila', () => {
    expect(tasaDeFila(3, 1)).toBe(75);
    expect(tasaDeFila(0, 0)).toBeNull();
  });

  it('el envío semanal cuenta la semana anterior de lunes a lunes', () => {
    // 2026-10-28 es miércoles.
    expect(periodoAnterior('semanal', '2026-10-28')).toEqual({ desde: '2026-10-19', hasta: '2026-10-26' });
    expect(periodoAnterior('semanal', '2026-10-26')).toEqual({ desde: '2026-10-19', hasta: '2026-10-26' });
  });

  it('el mensual, el mes anterior entero, cruzando el año', () => {
    expect(periodoAnterior('mensual', '2026-01-01')).toEqual({ desde: '2025-12-01', hasta: '2026-01-01' });
  });

  it('variación sin base es nula', () => {
    expect(variacion(10, 0)).toBeNull();
    expect(variacion(80, 100)).toBe(-20);
  });
});
