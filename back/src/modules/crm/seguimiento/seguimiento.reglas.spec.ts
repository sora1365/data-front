import {
  estaTerminado,
  fechasDePasos,
  impedimentoParaIniciar,
  motivoDeCorte,
} from './seguimiento.reglas';

const PASOS = [
  { orden: 1, dia: 1, canal: 'llamada', texto: 'Llamar' },
  { orden: 2, dia: 3, canal: 'whatsapp', texto: 'Escribir' },
  { orden: 3, dia: 7, canal: 'correo', texto: 'Enviar propuesta' },
];

describe('fechasDePasos', () => {
  // El lunes 19 de octubre de 2026 es lunes; sirve de base limpia.
  it('cuenta los días desde el arranque, no desde el paso anterior', () => {
    const fechas = fechasDePasos(PASOS, '2026-10-19');
    expect(fechas.map((p) => p.vence)).toEqual([
      '2026-10-20', // día 1, martes
      '2026-10-22', // día 3, jueves
      '2026-10-26', // día 7 cae domingo 25 y se mueve al lunes 26
    ]);
  });

  /**
   * Una tarea comercial que vence en fin de semana se mira el lunes ya
   * vencida, en rojo. Si eso pasa con la mitad del plan, el rojo deja de
   * significar que algo va mal.
   */
  it('mueve al lunes lo que cae en sábado o domingo', () => {
    const sabado = fechasDePasos([{ orden: 1, dia: 0, canal: 'llamada', texto: 'x' }], '2026-10-24');
    expect(sabado[0].vence).toBe('2026-10-26');
    expect(sabado[0].movido).toBe(true);

    const domingo = fechasDePasos([{ orden: 1, dia: 0, canal: 'llamada', texto: 'x' }], '2026-10-25');
    expect(domingo[0].vence).toBe('2026-10-26');
  });

  it('no marca como movido lo que ya caía entre semana', () => {
    expect(fechasDePasos(PASOS, '2026-10-19')[0].movido).toBe(false);
  });

  it('ordena por día aunque los pasos vengan desordenados', () => {
    const revueltos = [PASOS[2], PASOS[0], PASOS[1]];
    expect(fechasDePasos(revueltos, '2026-10-19').map((p) => p.orden)).toEqual([1, 2, 3]);
  });

  it('el día 0 es el mismo día del arranque', () => {
    const hoy = fechasDePasos([{ orden: 1, dia: 0, canal: 'llamada', texto: 'x' }], '2026-10-20');
    expect(hoy[0].vence).toBe('2026-10-20');
  });

  it('rechaza una fecha de arranque que no se entiende', () => {
    expect(() => fechasDePasos(PASOS, 'mañana')).toThrow();
  });
});

describe('motivoDeCorte', () => {
  it('corta al ganar y dice por qué', () => {
    expect(motivoDeCorte({ codigo: 'ganada', es_ganada: true, es_perdida: false })).toBe(
      'La venta se ganó',
    );
  });

  it('corta al perder, y no es lo mismo que haber ganado', () => {
    expect(motivoDeCorte({ codigo: 'perdida', es_ganada: false, es_perdida: true })).toBe(
      'La venta se perdió',
    );
  });

  it('no corta mientras la venta sigue viva', () => {
    expect(motivoDeCorte({ codigo: 'propuesta', es_ganada: false, es_perdida: false })).toBeNull();
  });
});

describe('impedimentoParaIniciar', () => {
  const secuencia = { activa: true, marca: null, producto: null };
  const oportunidad = {
    marca: 'friday',
    producto: 'suscripcion',
    archivada: false,
    cerrada: false,
  };

  it('deja arrancar una secuencia sin restricciones', () => {
    expect(impedimentoParaIniciar(secuencia, oportunidad)).toBeNull();
  });

  it('no arranca sobre una venta ya cerrada', () => {
    expect(impedimentoParaIniciar(secuencia, { ...oportunidad, cerrada: true })).toMatch(/cerrada/);
  });

  it('no arranca sobre una archivada', () => {
    expect(impedimentoParaIniciar(secuencia, { ...oportunidad, archivada: true })).toMatch(
      /archivada/,
    );
  });

  it('respeta la marca y el producto de la secuencia', () => {
    expect(
      impedimentoParaIniciar({ ...secuencia, marca: 'ascendra' }, oportunidad),
    ).toMatch(/marca/);
    expect(
      impedimentoParaIniciar({ ...secuencia, producto: 'auditoria' }, oportunidad),
    ).toMatch(/producto/);
  });

  it('una secuencia desactivada no arranca ni a mano', () => {
    expect(impedimentoParaIniciar({ ...secuencia, activa: false }, oportunidad)).toMatch(
      /desactivada/,
    );
  });
});

describe('estaTerminado', () => {
  it('termina cuando todas sus tareas están hechas', () => {
    expect(estaTerminado([{ hecha: true }, { hecha: true }])).toBe(true);
  });

  /**
   * Lo que importa es que falte por hacer, no que haya pasado la fecha: dar
   * por terminado un plan vencido borraría justo el pendiente que importa.
   */
  it('no termina mientras quede algo sin hacer', () => {
    expect(estaTerminado([{ hecha: true }, { hecha: false }])).toBe(false);
  });

  it('sin tareas no hay nada terminado', () => {
    expect(estaTerminado([])).toBe(false);
  });
});
