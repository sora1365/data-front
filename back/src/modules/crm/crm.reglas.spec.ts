import {
  accionSobreLaVenta,
  CANAL_SISTEMA,
  esCanalDeMano,
  esDireccion,
  estadoAlAbrir,
  estadoTrasEtapa,
  fechaDeInteraccionValida,
  puedeDesgalardonar,
  puedePasarA,
  repartirEnColumnas,
} from './crm.reglas';

const ETAPAS = [
  { codigo: 'contacto' },
  { codigo: 'propuesta' },
  { codigo: 'ganada' },
  { codigo: 'perdida' },
];

const GANADA = { es_ganada: true, es_perdida: false };
const PERDIDA = { es_ganada: false, es_perdida: true };
const EN_CURSO = { es_ganada: false, es_perdida: false };

describe('estadoAlAbrir', () => {
  it('pone en gestión a quien no se estaba gestionando', () => {
    expect(estadoAlAbrir(null)).toBe('en_gestion');
    expect(estadoAlAbrir('en_gestion')).toBe('en_gestion');
  });

  it('no degrada a un cliente por venderle algo más', () => {
    expect(estadoAlAbrir('cliente')).toBeNull();
  });

  it('no toca a quien pidió no ser contactado', () => {
    expect(estadoAlAbrir('no_contactar')).toBeNull();
  });
});

describe('estadoTrasEtapa', () => {
  it('ganar convierte en cliente', () => {
    expect(estadoTrasEtapa(GANADA, 'en_gestion')).toBe('cliente');
    expect(estadoTrasEtapa(GANADA, null)).toBe('cliente');
  });

  it('ganar dos veces no reescribe el estado', () => {
    expect(estadoTrasEtapa(GANADA, 'cliente')).toBeNull();
  });

  /**
   * El caso que importa: perder no devuelve el prospecto a la lista de
   * trabajo. Si lo hiciera, cada venta perdida reabriría el mismo prospecto
   * para las demás unidades.
   */
  it('perder no devuelve a nadie a la lista de trabajo', () => {
    expect(estadoTrasEtapa(PERDIDA, 'en_gestion')).toBeNull();
    expect(estadoTrasEtapa(PERDIDA, 'cliente')).toBeNull();
  });

  it('avanzar de etapa sin cerrar no cambia nada', () => {
    expect(estadoTrasEtapa(EN_CURSO, 'en_gestion')).toBeNull();
  });

  it('«no contactar» no se pisa ni ganando', () => {
    expect(estadoTrasEtapa(GANADA, 'no_contactar')).toBeNull();
  });
});

describe('repartirEnColumnas', () => {
  it('mantiene las etapas vacías como columnas', () => {
    const columnas = repartirEnColumnas(ETAPAS, []);
    expect(columnas.map((c) => c.codigo)).toEqual([
      'contacto',
      'propuesta',
      'ganada',
      'perdida',
    ]);
    expect(columnas.every((c) => c.oportunidades.length === 0)).toBe(true);
  });

  it('suma los montos de cada columna tratando el nulo como cero', () => {
    const columnas = repartirEnColumnas(ETAPAS, [
      { etapa: 'propuesta', monto: '480.00' },
      { etapa: 'propuesta', monto: null },
      { etapa: 'propuesta', monto: 20 },
    ]);
    const propuesta = columnas.find((c) => c.codigo === 'propuesta')!;
    expect(propuesta.oportunidades).toHaveLength(3);
    expect(propuesta.monto).toBe(500);
  });

  it('no pierde una oportunidad cuya etapa ya no existe', () => {
    const columnas = repartirEnColumnas(ETAPAS, [{ etapa: 'etapa_borrada', monto: 10 }]);
    expect(columnas[0].oportunidades).toHaveLength(1);
    expect(columnas.reduce((n, c) => n + c.oportunidades.length, 0)).toBe(1);
  });
});

describe('puedeDesgalardonar', () => {
  it('deja rectificar mientras nadie ha facturado', () => {
    expect(puedeDesgalardonar(null)).toBe(true);
    expect(puedeDesgalardonar('pendiente_facturacion')).toBe(true);
  });

  /**
   * El caso que justifica la regla: con la factura emitida existe un documento
   * con efectos tributarios, y arrastrar la tarjeta a otra columna no puede
   * fingir que no pasó. Se corrige con una nota de crédito en el contable.
   */
  it('no deja deshacer una venta ya facturada ni cobrada', () => {
    expect(puedeDesgalardonar('facturada')).toBe(false);
    expect(puedeDesgalardonar('cobrada')).toBe(false);
  });

  it('una venta anulada ya no bloquea', () => {
    expect(puedeDesgalardonar('anulada')).toBe(true);
  });
});

describe('puedePasarA', () => {
  it('sigue el camino normal de la venta', () => {
    expect(puedePasarA('pendiente_facturacion', 'facturada')).toBe(true);
    expect(puedePasarA('facturada', 'cobrada')).toBe(true);
  });

  it('no deja cobrar lo que nadie facturó', () => {
    expect(puedePasarA('pendiente_facturacion', 'cobrada')).toBe(false);
  });

  it('no deja volver atrás', () => {
    expect(puedePasarA('facturada', 'pendiente_facturacion')).toBe(false);
    expect(puedePasarA('cobrada', 'facturada')).toBe(false);
  });

  it('lo anulado y lo cobrado son finales', () => {
    expect(puedePasarA('anulada', 'facturada')).toBe(false);
    expect(puedePasarA('cobrada', 'anulada')).toBe(false);
  });

  it('anular se puede antes de cobrar', () => {
    expect(puedePasarA('pendiente_facturacion', 'anulada')).toBe(true);
    expect(puedePasarA('facturada', 'anulada')).toBe(true);
  });
});

describe('esCanalDeMano', () => {
  it('acepta los canales por los que habla una persona', () => {
    expect(esCanalDeMano('llamada')).toBe(true);
    expect(esCanalDeMano('whatsapp')).toBe(true);
    expect(esCanalDeMano('visita')).toBe(true);
  });

  /**
   * La razón de que esta lista sea cerrada: si se aceptara texto libre, estas
   * cuatro serían cuatro canales distintos en el informe.
   */
  it('rechaza las variantes de grafía del mismo canal', () => {
    expect(esCanalDeMano('Llamada')).toBe(false);
    expect(esCanalDeMano('LLAMADA')).toBe(false);
    expect(esCanalDeMano('tel')).toBe(false);
    expect(esCanalDeMano('telefónica')).toBe(false);
  });

  it('no deja escribir a mano el canal del sistema', () => {
    expect(esCanalDeMano(CANAL_SISTEMA)).toBe(false);
  });

  it('no se cae con lo que no es texto', () => {
    expect(esCanalDeMano(undefined)).toBe(false);
    expect(esCanalDeMano(null)).toBe(false);
    expect(esCanalDeMano(7)).toBe(false);
    expect(esCanalDeMano(['llamada'])).toBe(false);
  });
});

describe('esDireccion', () => {
  it('sólo entrante o saliente', () => {
    expect(esDireccion('entrante')).toBe(true);
    expect(esDireccion('saliente')).toBe(true);
    expect(esDireccion('')).toBe(false);
    expect(esDireccion('ambas')).toBe(false);
    expect(esDireccion(undefined)).toBe(false);
  });
});

describe('fechaDeInteraccionValida', () => {
  const ahora = new Date('2026-10-22T15:00:00Z');

  it('deja anotar hacia atrás: se llama el viernes y se apunta el lunes', () => {
    expect(fechaDeInteraccionValida(new Date('2026-10-16T09:00:00Z'), ahora)).toBe(true);
    expect(fechaDeInteraccionValida(new Date('2020-01-01T00:00:00Z'), ahora)).toBe(true);
  });

  it('acepta el momento exacto', () => {
    expect(fechaDeInteraccionValida(new Date(ahora), ahora)).toBe(true);
  });

  it('no deja anotar una conversación que todavía no ha pasado', () => {
    expect(fechaDeInteraccionValida(new Date('2026-10-23T09:00:00Z'), ahora)).toBe(false);
  });

  /** El reloj del navegador manda la fecha y el del servidor la juzga. */
  it('tolera el desfase entre los dos relojes', () => {
    expect(fechaDeInteraccionValida(new Date('2026-10-22T15:00:30Z'), ahora)).toBe(true);
    expect(fechaDeInteraccionValida(new Date('2026-10-22T15:05:00Z'), ahora)).toBe(false);
  });
});

describe('accionSobreLaVenta', () => {
  it('ganar registra la venta', () => {
    expect(accionSobreLaVenta(null, true)).toBe('registrar');
  });

  /**
   * El fallo que esto cierra: deshacer un «ganada» puesto por error dejaba
   * viva la venta, que el contable seguía teniendo pendiente de facturar y que
   * el cuadro de comisiones seguía contando como dinero en camino.
   */
  it('sacarla de ganada anula la venta pendiente', () => {
    expect(accionSobreLaVenta('pendiente_facturacion', false)).toBe('anular');
  });

  it('no vuelve a anular una ya anulada', () => {
    expect(accionSobreLaVenta('anulada', false)).toBe('nada');
  });

  it('sin venta no hay nada que anular', () => {
    expect(accionSobreLaVenta(null, false)).toBe('nada');
  });

  /**
   * No llegan hasta aquí porque `puedeDesgalardonar` corta antes el
   * movimiento; si llegaran, existe un documento con efectos tributarios y
   * anularlo es cosa del contable.
   */
  it('no toca una venta facturada ni una cobrada', () => {
    expect(accionSobreLaVenta('facturada', false)).toBe('nada');
    expect(accionSobreLaVenta('cobrada', false)).toBe('nada');
  });
});
