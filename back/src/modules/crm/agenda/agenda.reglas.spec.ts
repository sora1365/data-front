import {
  conflictos,
  diaLocal,
  diasDeLaSemana,
  diasEntre,
  franjaValida,
  huecosLibres,
  repartirEnColumnas,
  repartirTareasPorDia,
  seSolapan,
} from './agenda.reglas';

const h = (hora: string) => `2026-10-26T${hora}:00-05:00`;
const franja = (desde: string, hasta: string) => ({ inicio: h(desde), fin: h(hasta) });

describe('seSolapan', () => {
  it('detecta dos citas que se pisan', () => {
    expect(seSolapan(franja('09:00', '10:00'), franja('09:30', '10:30'))).toBe(true);
  });

  /**
   * El caso que arruina la función si se usa `<=`: dos reuniones seguidas no
   * se solapan. Un día de visitas son seis citas encadenadas, y avisar de
   * conflicto en cada una deja el aviso sin significado.
   */
  it('dos citas seguidas no se pisan', () => {
    expect(seSolapan(franja('09:00', '10:00'), franja('10:00', '11:00'))).toBe(false);
  });

  it('una cita dentro de otra sí se pisa', () => {
    expect(seSolapan(franja('09:00', '12:00'), franja('10:00', '11:00'))).toBe(true);
  });

  it('dos citas lejanas no se pisan', () => {
    expect(seSolapan(franja('09:00', '10:00'), franja('15:00', '16:00'))).toBe(false);
  });
});

describe('conflictos', () => {
  it('devuelve sólo las que chocan', () => {
    const ocupadas = [franja('08:00', '09:00'), franja('09:30', '10:30'), franja('14:00', '15:00')];
    expect(conflictos(franja('09:00', '11:00'), ocupadas)).toHaveLength(1);
  });

  it('una agenda vacía no da conflictos', () => {
    expect(conflictos(franja('09:00', '10:00'), [])).toEqual([]);
  });
});

describe('huecosLibres', () => {
  const jornada = franja('08:00', '18:00');

  it('un día sin nada es un solo hueco', () => {
    expect(huecosLibres(jornada, [])).toHaveLength(1);
  });

  it('parte la jornada alrededor de lo ocupado', () => {
    const huecos = huecosLibres(jornada, [franja('10:00', '11:00')]);
    expect(huecos).toHaveLength(2);
    expect(new Date(huecos[0].fin).toISOString()).toBe(new Date(h('10:00')).toISOString());
  });

  /**
   * Dos reuniones a la vez es un caso real —alguien acepta dos cosas— y si no
   * se funden antes de restar, aparece un hueco entre ellas que no existe.
   */
  it('funde las ocupadas que se solapan entre sí', () => {
    const huecos = huecosLibres(jornada, [franja('10:00', '12:00'), franja('11:00', '13:00')]);
    expect(huecos).toHaveLength(2);
    expect(new Date(huecos[1].inicio).toISOString()).toBe(new Date(h('13:00')).toISOString());
  });

  it('no le importa el orden en que lleguen', () => {
    const desordenadas = [franja('15:00', '16:00'), franja('09:00', '10:00')];
    expect(huecosLibres(jornada, desordenadas)).toHaveLength(3);
  });

  it('recorta lo que se sale de la jornada', () => {
    const huecos = huecosLibres(jornada, [franja('06:00', '09:00')]);
    expect(huecos).toHaveLength(1);
    expect(new Date(huecos[0].inicio).toISOString()).toBe(new Date(h('09:00')).toISOString());
  });

  it('descarta los huecos más cortos que lo pedido', () => {
    const ocupadas = [franja('09:00', '10:00'), franja('10:15', '18:00')];
    expect(huecosLibres(jornada, ocupadas, 30)).toHaveLength(1); // el de 15 min se cae
  });

  it('un día entero ocupado no deja huecos', () => {
    expect(huecosLibres(jornada, [franja('08:00', '18:00')])).toEqual([]);
  });
});

describe('repartirEnColumnas', () => {
  it('las citas encadenadas comparten columna', () => {
    const r = repartirEnColumnas([franja('09:00', '10:00'), franja('10:00', '11:00')]);
    expect(r.every((x) => x.columna === 0)).toBe(true);
    expect(r[0].columnas).toBe(1);
  });

  it('las que se pisan van en columnas distintas', () => {
    const r = repartirEnColumnas([franja('09:00', '11:00'), franja('10:00', '12:00')]);
    expect(r[0].columna).not.toBe(r[1].columna);
    expect(r[0].columnas).toBe(2);
  });

  it('reutiliza una columna cuando queda libre', () => {
    const r = repartirEnColumnas([
      franja('09:00', '11:00'),
      franja('10:00', '12:00'),
      franja('12:30', '13:00'),
    ]);
    expect(r[2].columna).toBe(0);
    expect(r[0].columnas).toBe(2);
  });
});

describe('franjaValida', () => {
  it('acepta una cita normal', () => {
    expect(franjaValida(h('09:00'), h('10:00'))).toBeNull();
  });

  it('acepta un instante sin duración', () => {
    expect(franjaValida(h('09:00'), h('09:00'))).toBeNull();
  });

  it('rechaza terminar antes de empezar', () => {
    expect(franjaValida(h('10:00'), h('09:00'))).toContain('antes de empezar');
  });

  it('rechaza fechas ilegibles', () => {
    expect(franjaValida('ayer', h('09:00'))).toContain('no son válidas');
  });

  /** Casi siempre es un error de año al teclear, no una reunión de dos años. */
  it('rechaza una duración absurda', () => {
    expect(franjaValida('2026-01-01T09:00:00Z', '2028-01-01T10:00:00Z')).toContain('más de un año');
  });
});

describe('tareas en la agenda', () => {
  const SEMANA = diasDeLaSemana('2026-10-19'); // lunes 19 a domingo 25
  const HOY = '2026-10-22';

  const tarea = (id: number, vence: string, hecha = false) => ({ id, vence, hecha });

  it('pone cada tarea en el día en que vence', () => {
    const porDia = repartirTareasPorDia([tarea(1, '2026-10-23')], SEMANA, HOY);
    expect(porDia.get('2026-10-23')!.map((t) => t.id)).toEqual([1]);
    expect(porDia.get('2026-10-22')).toEqual([]);
  });

  /**
   * Es la regla que justifica toda la función. Dejar lo vencido en su día es
   * cómo se pierde una tarea: la semana siguiente nadie vuelve a mirar el
   * jueves anterior.
   */
  it('arrastra a hoy lo pendiente que ya venció, contando el retraso', () => {
    const porDia = repartirTareasPorDia([tarea(1, '2026-10-19')], SEMANA, HOY);
    expect(porDia.get('2026-10-19')).toEqual([]);
    const hoy = porDia.get(HOY)!;
    expect(hoy).toHaveLength(1);
    expect(hoy[0].vencida).toBe(true);
    expect(hoy[0].diasDeRetraso).toBe(3);
  });

  it('deja la tarea terminada en el día en que vencía', () => {
    const porDia = repartirTareasPorDia([tarea(1, '2026-10-19', true)], SEMANA, HOY);
    expect(porDia.get('2026-10-19')!.map((t) => t.id)).toEqual([1]);
    expect(porDia.get(HOY)).toEqual([]);
  });

  /**
   * Mirando otra semana, lo vencido no se pinta: ponerlo en el lunes de una
   * semana cualquiera diría que vence ese día, que es falso.
   */
  it('no arrastra nada a una semana que no contiene hoy', () => {
    const otra = diasDeLaSemana('2026-11-02');
    const porDia = repartirTareasPorDia([tarea(1, '2026-10-19')], otra, HOY);
    expect([...porDia.values()].flat()).toEqual([]);
  });

  it('cuenta los días de retraso aunque haya cambio de horario en medio', () => {
    // En el hemisferio norte el horario cambia el 25 de octubre de 2026.
    expect(diasEntre('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('la semana son siete días consecutivos desde el lunes', () => {
    expect(SEMANA).toHaveLength(7);
    expect(SEMANA[0]).toBe('2026-10-19');
    expect(SEMANA[6]).toBe('2026-10-25');
  });
});

describe('diaLocal', () => {
  /**
   * El fallo que esto cierra: a las siete de la tarde en Ecuador ya es el día
   * siguiente en UTC, así que `toISOString()` adelanta «hoy» cada tarde.
   */
  it('usa el día del reloj local, no el de UTC', () => {
    expect(diaLocal(new Date(2026, 9, 22, 19, 30))).toBe('2026-10-22');
  });

  it('rellena mes y día a dos cifras', () => {
    expect(diaLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
