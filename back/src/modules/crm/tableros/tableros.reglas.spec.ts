import { conResto, embudo, tasaDeCierre } from './tableros.reglas';

const ETAPAS = [
  { codigo: 'contacto', nombre: 'Por contactar', orden: 1, es_ganada: false, es_perdida: false },
  { codigo: 'conversando', nombre: 'En conversación', orden: 2, es_ganada: false, es_perdida: false },
  { codigo: 'propuesta', nombre: 'Propuesta', orden: 3, es_ganada: false, es_perdida: false },
  { codigo: 'ganada', nombre: 'Ganada', orden: 4, es_ganada: true, es_perdida: false },
  { codigo: 'perdida', nombre: 'Perdida', orden: 5, es_ganada: false, es_perdida: true },
];

const paso = (oportunidad: number, hasta: string) => ({
  oportunidad,
  hasta,
  ocurrido_en: '2026-10-01T10:00:00Z',
});

describe('embudo', () => {
  it('deja fuera del recorrido las etapas terminales', () => {
    const tramos = embudo(ETAPAS, [paso(1, 'contacto')]);
    expect(tramos.map((t) => t.codigo)).toEqual(['contacto', 'conversando', 'propuesta']);
  });

  it('cuenta en cada etapa las que llegaron hasta ahí o más lejos', () => {
    const tramos = embudo(ETAPAS, [
      paso(1, 'contacto'),
      paso(2, 'contacto'),
      paso(2, 'conversando'),
      paso(3, 'contacto'),
      paso(3, 'conversando'),
      paso(3, 'propuesta'),
    ]);
    expect(tramos.map((t) => t.llegaron)).toEqual([3, 2, 1]);
  });

  /**
   * La regla que distingue un embudo de una lista de anécdotas: quien salta
   * de «por contactar» a «propuesta» pasó por conversación, y contarlo sólo
   * donde se registró enseñaría un agujero que no existe.
   */
  it('cuenta las etapas que se saltaron por el camino', () => {
    const tramos = embudo(ETAPAS, [paso(1, 'contacto'), paso(1, 'propuesta')]);
    expect(tramos.map((t) => t.llegaron)).toEqual([1, 1, 1]);
  });

  it('una venta ganada recorrió el embudo entero', () => {
    const tramos = embudo(ETAPAS, [paso(1, 'contacto'), paso(1, 'ganada')]);
    expect(tramos.map((t) => t.llegaron)).toEqual([1, 1, 1]);
  });

  it('una venta ganada no está atascada en la última etapa', () => {
    const tramos = embudo(ETAPAS, [paso(1, 'contacto'), paso(1, 'ganada')]);
    expect(tramos[2].atascadas).toBe(0);
  });

  it('la perdida se queda donde llegó, no avanza por perderse', () => {
    const tramos = embudo(ETAPAS, [paso(1, 'contacto'), paso(1, 'perdida')]);
    expect(tramos.map((t) => t.llegaron)).toEqual([1, 0, 0]);
  });

  it('la conversión de cada tramo es contra el tramo anterior', () => {
    const tramos = embudo(ETAPAS, [
      paso(1, 'contacto'),
      paso(2, 'contacto'),
      paso(3, 'contacto'),
      paso(4, 'contacto'),
      paso(3, 'conversando'),
      paso(4, 'conversando'),
      paso(4, 'propuesta'),
    ]);
    expect(tramos[0].conversion).toBeNull();
    expect(tramos[1].conversion).toBe(50);
    expect(tramos[2].conversion).toBe(50);
  });

  it('sin movimientos no inventa nada', () => {
    const tramos = embudo(ETAPAS, []);
    expect(tramos.map((t) => t.llegaron)).toEqual([0, 0, 0]);
    expect(tramos.every((t) => t.conversion === null || t.conversion === 0)).toBe(true);
  });
});

describe('tasaDeCierre', () => {
  it('mide sobre lo cerrado y no sobre todo lo abierto', () => {
    expect(tasaDeCierre(3, 1)).toBe(75);
  });

  it('sin nada cerrado no hay tasa, que no es lo mismo que cero', () => {
    expect(tasaDeCierre(0, 0)).toBeNull();
  });
});

describe('conResto', () => {
  const fila = (etiqueta: string, monto: number) => ({ etiqueta, monto, cuenta: 1 });

  it('deja la tabla como está si cabe entera', () => {
    const filas = [fila('a', 2), fila('b', 1)];
    expect(conResto(filas, 8)).toHaveLength(2);
  });

  it('agrupa la cola en «otros» sin perder el total', () => {
    const filas = [fila('a', 10), fila('b', 5), fila('c', 3), fila('d', 2)];
    const recortadas = conResto(filas, 2);
    expect(recortadas.map((f) => f.etiqueta)).toEqual(['a', 'b', 'Otros (2)']);
    const total = recortadas.reduce((s, f) => s + Number(f.monto), 0);
    expect(total).toBe(20);
  });
});
