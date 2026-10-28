import { alCambiarEstado, csat, csatValido, prioridadInicial, puedePasar, Reloj, sla, slaQueManda } from './tickets.reglas';

const H = 3_600_000;
const creado = new Date('2026-10-27T10:00:00Z');
const tras = (horas: number) => new Date(creado.getTime() + horas * H);

const base = {
  creado_en: creado,
  horas_respuesta: 4,
  horas_resolucion: 24,
  pausado_seg: 0,
  en_espera_desde: null,
  primera_respuesta_en: null,
  resuelto_en: null,
};

describe('prioridadInicial', () => {
  it('quejas y reclamos nacen en alta; lo demás en media', () => {
    expect(prioridadInicial('queja')).toBe('alta');
    expect(prioridadInicial('reclamo')).toBe('alta');
    expect(prioridadInicial('consulta')).toBe('media');
  });

  it('respeta la que se pide si es válida', () => {
    expect(prioridadInicial('queja', 'baja')).toBe('baja');
    expect(prioridadInicial('consulta', 'inventada')).toBe('media');
  });
});

describe('puedePasar', () => {
  it('sigue el recorrido normal', () => {
    expect(puedePasar('abierto', 'en_curso')).toBe(true);
    expect(puedePasar('en_curso', 'esperando_cliente')).toBe(true);
    expect(puedePasar('resuelto', 'cerrado')).toBe(true);
  });

  it('reabrir vuelve a en curso, y cerrado es final', () => {
    expect(puedePasar('resuelto', 'en_curso')).toBe(true);
    expect(puedePasar('cerrado', 'en_curso')).toBe(false);
    expect(puedePasar('cerrado', 'abierto')).toBe(false);
  });
});

describe('alCambiarEstado', () => {
  const reloj: Reloj = {
    estado: 'en_curso',
    pausado_seg: 0,
    en_espera_desde: null,
    resuelto_en: null,
    cerrado_en: null,
    reabierto: 0,
  };

  it('esperar al cliente acumula la pausa al salir', () => {
    const espera = alCambiarEstado(reloj, 'esperando_cliente', tras(2));
    expect(espera.en_espera_desde).toEqual(tras(2));
    const vuelta = alCambiarEstado({ ...reloj, ...espera } as Reloj, 'en_curso', tras(5));
    expect(vuelta.pausado_seg).toBe(3 * 3600);
    expect(vuelta.en_espera_desde).toBeNull();
  });

  it('resolver desde la espera también cuenta lo esperado', () => {
    const r = alCambiarEstado({ ...reloj, estado: 'esperando_cliente', en_espera_desde: tras(1) }, 'resuelto', tras(2));
    expect(r.pausado_seg).toBe(3600);
    expect(r.resuelto_en).toEqual(tras(2));
  });

  it('reabrir borra la resolución y cuenta la reapertura', () => {
    const r = alCambiarEstado({ ...reloj, estado: 'resuelto', resuelto_en: tras(3) }, 'en_curso', tras(4));
    expect(r.resuelto_en).toBeNull();
    expect(r.reabierto).toBe(1);
  });

  it('cerrar sin resolver deja fecha de resolución', () => {
    const r = alCambiarEstado({ ...reloj, estado: 'resuelto', resuelto_en: tras(3) }, 'cerrado', tras(9));
    expect(r.resuelto_en).toBeUndefined();
    expect(r.cerrado_en).toEqual(tras(9));
  });
});

describe('sla', () => {
  it('en plazo al principio, por vencer al final, incumplido después', () => {
    expect(sla(base, tras(1)).respuesta.estado).toBe('en_plazo');
    expect(sla(base, tras(3.5)).respuesta.estado).toBe('por_vencer');
    expect(sla(base, tras(5)).respuesta.estado).toBe('incumplido');
  });

  it('cumplido o incumplido según cuándo se hizo, sin importar el ahora', () => {
    expect(sla({ ...base, primera_respuesta_en: tras(3) }, tras(100)).respuesta.estado).toBe('cumplido');
    expect(sla({ ...base, primera_respuesta_en: tras(5) }, tras(100)).respuesta.estado).toBe('incumplido');
  });

  it('la pausa alarga la resolución pero no la primera respuesta', () => {
    const t = { ...base, pausado_seg: 10 * 3600, primera_respuesta_en: tras(1) };
    expect(sla(t, tras(20)).resolucion.estado).toBe('en_plazo');
    expect(sla(t, tras(30)).resolucion.estado).toBe('por_vencer');
    expect(sla(t, tras(35)).resolucion.estado).toBe('incumplido');
  });

  it('esperando al cliente el reloj no corre', () => {
    const t = { ...base, primera_respuesta_en: tras(1), en_espera_desde: tras(2) };
    // A las 100 h, con espera desde la hora 2, sólo han corrido 2 h de 24.
    expect(sla(t, tras(100)).resolucion.estado).toBe('en_plazo');
  });

  it('el que manda es el peor de lo pendiente', () => {
    expect(slaQueManda(sla(base, tras(5)))).toBe('incumplido');
    const hecho = { ...base, primera_respuesta_en: tras(1), resuelto_en: tras(2) };
    expect(slaQueManda(sla(hecho, tras(50)))).toBe('cumplido');
    const respondidoTarde = { ...base, primera_respuesta_en: tras(6) };
    // La respuesta tardía ya pasó; lo que manda es la resolución pendiente.
    expect(slaQueManda(sla(respondidoTarde, tras(7)))).toBe('en_plazo');
  });
});

describe('csat', () => {
  it('sólo admite enteros del 1 al 5', () => {
    expect(csatValido(5)).toBe(true);
    expect(csatValido(0)).toBe(false);
    expect(csatValido(4.5)).toBe(false);
  });

  it('se publica como porcentaje de satisfechos, y sin respuestas no es cero', () => {
    expect(csat([])).toEqual({ respuestas: 0, satisfechos: null, promedio: null });
    expect(csat([5, 4, 1, 2])).toEqual({ respuestas: 4, satisfechos: 50, promedio: 3 });
  });
});
