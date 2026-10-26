import {
  claveUtm,
  dentroDelPeriodo,
  detectarDecimal,
  detectarOrdenFecha,
  indicadores,
  leerFecha,
  leerInformeDeGasto,
  leerNumero,
  ritmo,
} from './pauta.reglas';

const utf8 = (s: string) => Buffer.from(s, 'utf8');

describe('claveUtm', () => {
  it('compara sin mayúsculas ni espacios', () => {
    expect(claveUtm(' Auditoria-Octubre ')).toBe('auditoria-octubre');
    expect(claveUtm('   ')).toBeNull();
  });
});

describe('leerNumero y detectarDecimal', () => {
  it('lee la coma decimal de un informe en español', () => {
    const decimal = detectarDecimal(['1.234,56', '12,5']);
    expect(decimal).toBe(',');
    expect(leerNumero('1.234,56', decimal)).toBe(1234.56);
    expect(leerNumero('US$ 12,50', decimal)).toBe(12.5);
  });

  it('lee el punto decimal de un informe en inglés', () => {
    const decimal = detectarDecimal(['$1,234.56', '8.2']);
    expect(decimal).toBe('.');
    expect(leerNumero('$1,234.56', decimal)).toBe(1234.56);
  });

  /** «1.234» es mil en español; decidirlo número a número sería adivinar. */
  it('decide por el archivo, no por cada valor', () => {
    const decimal = detectarDecimal(['1.234', '20,10']);
    expect(leerNumero('1.234', decimal)).toBe(1234);
  });

  it('devuelve null para lo que no es un número', () => {
    expect(leerNumero('--', '.')).toBeNull();
    expect(leerNumero('', '.')).toBeNull();
  });
});

describe('leerFecha y detectarOrdenFecha', () => {
  it('lee el formato ISO', () => {
    expect(leerFecha('2026-10-03', 'dm')).toBe('2026-10-03');
  });

  it('decide día/mes o mes/día mirando todo el archivo', () => {
    expect(detectarOrdenFecha(['03/04/2026', '13/04/2026'])).toBe('dm');
    expect(detectarOrdenFecha(['04/03/2026', '04/13/2026'])).toBe('md');
    expect(leerFecha('03/04/2026', 'dm')).toBe('2026-04-03');
    expect(leerFecha('03/04/2026', 'md')).toBe('2026-03-04');
  });

  it('lee los meses con nombre, en español e inglés', () => {
    expect(leerFecha('1 oct. 2026', 'dm')).toBe('2026-10-01');
    expect(leerFecha('5 de diciembre de 2026', 'dm')).toBe('2026-12-05');
    expect(leerFecha('Oct 7, 2026', 'dm')).toBe('2026-10-07');
  });

  it('rechaza fechas que no existen', () => {
    expect(leerFecha('31/02/2026', 'dm')).toBeNull();
    expect(leerFecha('Total', 'dm')).toBeNull();
  });
});

describe('leerInformeDeGasto', () => {
  it('lee un informe de Meta y prefiere los clics en el enlace', () => {
    const csv = [
      '"Inicio del informe","Fin del informe","Nombre de la campaña","Importe gastado (USD)","Impresiones","Clics (todos)","Clics en el enlace"',
      '"2026-10-01","2026-10-01","Auditoría Octubre","12.50","1000","80","30"',
      '"2026-10-02","2026-10-02","Auditoría Octubre","10.00","900","70","25"',
    ].join('\n');
    const { dias, avisos } = leerInformeDeGasto(utf8(csv));
    expect(avisos).toEqual([]);
    expect(dias).toEqual([
      { dia: '2026-10-01', gasto: 12.5, impresiones: 1000, clics: 30 },
      { dia: '2026-10-02', gasto: 10, impresiones: 900, clics: 25 },
    ]);
  });

  /** Google: UTF-16, tabuladores, dos líneas de título y una fila de total. */
  it('lee un informe de Google en UTF-16 con títulos y total', () => {
    const tsv = [
      'Informe de campañas',
      '1 de octubre de 2026 - 3 de octubre de 2026',
      'Día\tCampaña\tImpr.\tClics\tCosto',
      '1 oct. 2026\tAuditoría\t1.200\t40\t15,30',
      '2 oct. 2026\tAuditoría\t800\t20\t9,70',
      'Total: cuenta\t\t2.000\t60\t25,00',
    ].join('\r\n');
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, 'utf16le')]);
    const { dias, avisos, encoding } = leerInformeDeGasto(buffer);
    expect(encoding).toBe('utf-16le');
    expect(avisos).toEqual([]);
    expect(dias).toEqual([
      { dia: '2026-10-01', gasto: 15.3, impresiones: 1200, clics: 40 },
      { dia: '2026-10-02', gasto: 9.7, impresiones: 800, clics: 20 },
    ]);
  });

  it('lee un CSV en Latin-1 separado por punto y coma', () => {
    const csv = 'Fecha;Inversión;Clics\n01/10/2026;20,00;10\n15/10/2026;5,50;3\n';
    const { dias } = leerInformeDeGasto(Buffer.from(csv, 'latin1'));
    expect(dias.map((d) => [d.dia, d.gasto])).toEqual([
      ['2026-10-01', 20],
      ['2026-10-15', 5.5],
    ]);
  });

  /** Un informe por conjunto de anuncios trae el mismo día varias veces. */
  it('suma las filas del mismo día', () => {
    const csv = 'Day,Amount spent,Impressions\n2026-10-01,5,100\n2026-10-01,7.5,50\n';
    expect(leerInformeDeGasto(utf8(csv)).dias).toEqual([
      { dia: '2026-10-01', gasto: 12.5, impresiones: 150, clics: null },
    ]);
  });

  it('avisa de lo que no puede leer en vez de tragárselo', () => {
    const csv = 'Día,Costo\n2026-10-01,5\nayer,3\n2026-10-03,abc\n';
    const { dias, avisos } = leerInformeDeGasto(utf8(csv));
    expect(dias).toHaveLength(1);
    expect(avisos).toEqual([
      'Línea 3: «ayer» no es una fecha que entienda.',
      'Línea 4: el gasto «abc» no es un número.',
    ]);
  });

  it('explica qué falta cuando no hay columnas reconocibles', () => {
    const { dias, avisos } = leerInformeDeGasto(utf8('Campaña,Alcance\nX,10\n'));
    expect(dias).toEqual([]);
    expect(avisos[0]).toMatch(/columnas de día y de gasto/);
  });
});

describe('dentroDelPeriodo', () => {
  it('separa los días fuera de la campaña', () => {
    const dias = ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'].map((dia) => ({
      dia,
      gasto: 1,
      impresiones: null,
      clics: null,
    }));
    const { dentro, fuera } = dentroDelPeriodo(dias, '2026-10-01', '2026-10-31');
    expect(dentro.map((d) => d.dia)).toEqual(['2026-10-01', '2026-10-31']);
    expect(fuera.map((d) => d.dia)).toEqual(['2026-09-30', '2026-11-01']);
  });
});

describe('indicadores', () => {
  const base = {
    presupuesto: 1000,
    desde: '2026-10-01',
    hasta: '2026-10-31',
    gasto: 500,
    impresiones: 50_000,
    clics: 1_000,
    leads: 50,
    oportunidades: 10,
    ventas: 4,
    clientes: 4,
    ingresos: 2_000,
    cobrado: 1_000,
  };

  it('calcula CPL, CAC, ROAS y ROI', () => {
    expect(indicadores(base)).toEqual({
      ctr: 2,
      cpc: 0.5,
      cpl: 10,
      conversionLead: 8,
      cac: 125,
      roas: 4,
      roi: 300,
      roiCobrado: 100,
    });
  });

  /** Un CPL de cero diría que los leads salieron gratis. */
  it('sin denominador devuelve null, no cero', () => {
    const r = indicadores({ ...base, gasto: 0, leads: 0, clientes: 0, clics: 0, impresiones: 0 });
    expect(r.cpl).toBeNull();
    expect(r.cac).toBeNull();
    expect(r.roi).toBeNull();
    expect(r.ctr).toBeNull();
  });

  it('un ROI negativo es pérdida', () => {
    expect(indicadores({ ...base, ingresos: 250 }).roi).toBe(-50);
  });
});

describe('ritmo', () => {
  const c = { presupuesto: 310, desde: '2026-10-01', hasta: '2026-10-31' };

  it('en línea si va cerca de lo esperado', () => {
    const r = ritmo({ ...c, gasto: 100 }, '2026-10-10');
    expect(r.esperado).toBe(100);
    expect(r.estado).toBe('en_linea');
    expect(r.proyeccion).toBe(310);
  });

  it('avisa de que va por encima o por debajo', () => {
    expect(ritmo({ ...c, gasto: 150 }, '2026-10-10').estado).toBe('sobre');
    expect(ritmo({ ...c, gasto: 50 }, '2026-10-10').estado).toBe('bajo');
  });

  it('distingue antes de empezar, terminada y excedida', () => {
    expect(ritmo({ ...c, gasto: 0 }, '2026-09-20').estado).toBe('sin_empezar');
    expect(ritmo({ ...c, gasto: 300 }, '2026-11-05').estado).toBe('terminada');
    expect(ritmo({ ...c, gasto: 400 }, '2026-10-20').estado).toBe('excedida');
  });
});
