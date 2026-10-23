import {
  esResultado,
  estadoParaElGestor,
  listaDeHoy,
  siguienteIntento,
} from './listas.reglas';

const HOY = '2026-10-23';

describe('siguienteIntento', () => {
  it('quien no contesta vuelve en dos días', () => {
    expect(siguienteIntento('no_contesta', HOY, 1)).toBe('2026-10-25');
  });

  /**
   * Llamar siete veces en una semana no consigue nada que no consiga llamar
   * tres veces en un mes, y quema el contacto.
   */
  it('cada intento seguido aleja el siguiente', () => {
    expect(siguienteIntento('no_contesta', HOY, 2)).toBe('2026-10-27');
    expect(siguienteIntento('no_contesta', HOY, 5)).toBe('2026-11-02');
  });

  it('la espera no pasa de un mes', () => {
    expect(siguienteIntento('no_contesta', HOY, 50)).toBe('2026-11-22');
  });

  it('a quien no le interesa se le deja descansar medio año', () => {
    expect(siguienteIntento('no_interesa', HOY)).toBe('2027-04-21');
  });

  it('quien pide que no lo llamen no vuelve nunca', () => {
    expect(siguienteIntento('no_contactar', HOY)).toBeNull();
  });

  it('quien ya tiene oportunidad se trabaja desde el tablero', () => {
    expect(siguienteIntento('oportunidad', HOY)).toBeNull();
  });

  it('el que pidió que le vuelvan a llamar vuelve en una semana', () => {
    expect(siguienteIntento('volver_a_llamar', HOY)).toBe('2026-10-30');
  });
});

describe('esResultado', () => {
  it('acepta los de la lista y rechaza lo demás', () => {
    expect(esResultado('no_contesta')).toBe(true);
    expect(esResultado('ocupado')).toBe(false);
    expect(esResultado(undefined)).toBe(false);
  });
});

describe('listaDeHoy', () => {
  const m = (clave: string, extra: Record<string, unknown> = {}) => ({
    tipo_sujeto: 'compania',
    clave,
    nombre: `Empresa ${clave}`,
    telefono: '0999999999',
    ...extra,
  });

  it('deja fuera a quien todavía no toca', () => {
    const lista = listaDeHoy([m('1', { reintentar_en: '2026-11-01' }), m('2')], HOY);
    expect(lista.map((x) => x.clave)).toEqual(['2']);
  });

  it('incluye a quien ya tocaba', () => {
    const lista = listaDeHoy([m('1', { reintentar_en: '2026-10-20' })], HOY);
    expect(lista).toHaveLength(1);
  });

  it('el mismo día en que toca, toca', () => {
    expect(listaDeHoy([m('1', { reintentar_en: HOY })], HOY)).toHaveLength(1);
  });

  /**
   * Es lo que hace la lista segura de usar: si el segmento vuelve a
   * calcularse e incluye a alguien que pidió no ser llamado, la lista no lo
   * enseña aunque el segmento sí lo tenga.
   */
  it('nunca enseña a quien pidió no ser contactado', () => {
    const lista = listaDeHoy([m('1', { estado_comercial: 'no_contactar' })], HOY);
    expect(lista).toEqual([]);
  });

  it('deja fuera a quien ya tiene oportunidad abierta', () => {
    expect(listaDeHoy([m('1', { oportunidad_abierta: true })], HOY)).toEqual([]);
  });

  /**
   * Lo contrario de lo que pasa solo: volver sobre los conocidos y no tocar
   * nunca el final del segmento.
   */
  it('primero los que nunca se han llamado', () => {
    const lista = listaDeHoy(
      [
        m('viejo', { ultimo_resultado: 'no_contesta', reintentar_en: '2026-10-01' }),
        m('nuevo'),
      ],
      HOY,
    );
    expect(lista.map((x) => x.clave)).toEqual(['nuevo', 'viejo']);
  });

  it('entre los ya intentados, el que lleva más esperando', () => {
    const lista = listaDeHoy(
      [
        m('b', { ultimo_resultado: 'no_contesta', reintentar_en: '2026-10-20' }),
        m('a', { ultimo_resultado: 'no_contesta', reintentar_en: '2026-10-05' }),
      ],
      HOY,
    );
    expect(lista.map((x) => x.clave)).toEqual(['a', 'b']);
  });

  it('puede dejar fuera a quien no tiene ni teléfono ni correo', () => {
    const sinNada = m('1', { telefono: null, correo: null });
    expect(listaDeHoy([sinNada], HOY)).toHaveLength(1);
    expect(listaDeHoy([sinNada], HOY, { soloConContacto: true })).toHaveLength(0);
  });
});

describe('estadoParaElGestor', () => {
  it('haber hablado deja al sujeto en gestión', () => {
    expect(estadoParaElGestor('contactado')).toBe('en_gestion');
    expect(estadoParaElGestor('oportunidad')).toBe('en_gestion');
  });

  it('quien pide no ser llamado se marca como tal', () => {
    expect(estadoParaElGestor('no_contactar')).toBe('no_contactar');
  });

  /**
   * No es lo mismo «ahora no» que «no me vuelvas a llamar»: confundirlos
   * borra del mercado a medio segmento por una conversación de treinta
   * segundos.
   */
  it('que no le interese no es pedir que no lo llamen', () => {
    expect(estadoParaElGestor('no_interesa')).toBeNull();
  });

  it('llamar sin respuesta no cambia lo que ese sujeto es', () => {
    expect(estadoParaElGestor('no_contesta')).toBeNull();
  });
});
