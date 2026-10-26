import { cruzadasPara, ordenarClientes, valeLaPena } from './cruzada.reglas';

const CATALOGO = [
  { codigo: 'contabilidad_mes', nombre: 'Contabilidad mensual', marca: 'ascendra', marca_nombre: 'ASCENDRA' },
  { codigo: 'auditoria_externa', nombre: 'Auditoría externa', marca: 'ascendra', marca_nombre: 'ASCENDRA' },
  { codigo: 'friday_suscripcion', nombre: 'Suscripción FRIDAY', marca: 'friday', marca_nombre: 'FRIDAY' },
  { codigo: 'marca_registro', nombre: 'Registro de marca', marca: null, marca_nombre: null },
];

const HOY = '2026-10-26';
const nada = { comprados: [], enCurso: [], rechazados: {} };

describe('cruzadasPara', () => {
  it('no ofrece lo que ya compró', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, comprados: ['contabilidad_mes'] }, { hoy: HOY });
    expect(s.map((x) => x.codigo)).not.toContain('contabilidad_mes');
  });

  /**
   * Una oportunidad abierta es alguien trabajándolo; ofrecerlo otra vez es
   * llamar dos veces por lo mismo.
   */
  it('no ofrece lo que ya se está trabajando', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, enCurso: ['auditoria_externa'] }, { hoy: HOY });
    expect(s.map((x) => x.codigo)).not.toContain('auditoria_externa');
  });

  it('no ofrece lo rechazado hasta que pase su plazo', () => {
    const s = cruzadasPara(
      CATALOGO,
      { ...nada, rechazados: { auditoria_externa: '2026-12-01' } },
      { hoy: HOY },
    );
    expect(s.map((x) => x.codigo)).not.toContain('auditoria_externa');
  });

  it('vuelve a ofrecerlo cuando el plazo pasó', () => {
    const s = cruzadasPara(
      CATALOGO,
      { ...nada, rechazados: { auditoria_externa: '2026-10-01' } },
      { hoy: HOY },
    );
    expect(s.map((x) => x.codigo)).toContain('auditoria_externa');
  });

  it('lo que pidió no volver a oír no vuelve nunca', () => {
    const s = cruzadasPara(
      CATALOGO,
      { ...nada, rechazados: { auditoria_externa: null } },
      { hoy: HOY },
    );
    expect(s.map((x) => x.codigo)).not.toContain('auditoria_externa');
  });

  /**
   * El orden es el que convierte: lo que el gestor propone para esa empresa,
   * luego lo de la marca que ya le vende, y al final lo demás.
   */
  it('pone primero lo que el gestor propone para esa empresa', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, comprados: ['contabilidad_mes'] }, {
      sugeridosPorElGestor: ['friday_suscripcion'],
      marcasDelCliente: ['ascendra'],
      hoy: HOY,
    });
    expect(s[0].codigo).toBe('friday_suscripcion');
    expect(s[0].motivo).toMatch(/gestor/);
  });

  it('después, lo de la marca que ya le vende', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, comprados: ['contabilidad_mes'] }, {
      marcasDelCliente: ['ascendra'],
      hoy: HOY,
    });
    expect(s[0].codigo).toBe('auditoria_externa');
    expect(s[0].motivo).toMatch(/ASCENDRA/);
    expect(s[0].otraMarca).toBe(false);
  });

  it('marca lo que es de otra marca, que es la venta cruzada de verdad', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, comprados: ['contabilidad_mes'] }, {
      marcasDelCliente: ['ascendra'],
      hoy: HOY,
    });
    const friday = s.find((x) => x.codigo === 'friday_suscripcion');
    expect(friday?.otraMarca).toBe(true);
  });

  it('cada sugerencia dice por qué, para que no sea una lista mágica', () => {
    const s = cruzadasPara(CATALOGO, nada, { hoy: HOY });
    expect(s.every((x) => x.motivo.length > 0)).toBe(true);
  });

  it('a un cliente que lo tiene todo no se le ofrece nada', () => {
    const s = cruzadasPara(CATALOGO, { ...nada, comprados: CATALOGO.map((p) => p.codigo) }, {
      hoy: HOY,
    });
    expect(s).toEqual([]);
    expect(valeLaPena(s)).toBe(false);
  });
});

describe('ordenarClientes', () => {
  const cliente = (facturado: number, cuantas: number) => ({
    facturado,
    sugerencias: Array.from({ length: cuantas }, (_, i) => ({ codigo: String(i) })) as any,
  });

  /**
   * No porque los demás no importen: la siguiente venta a quien ya gasta diez
   * mil es más probable y más grande que la de quien gastó cien.
   */
  it('primero quien más compra', () => {
    const lista = ordenarClientes([cliente(100, 3), cliente(10000, 1)]);
    expect(lista[0].facturado).toBe(10000);
  });

  it('entre iguales, el que tiene más huecos', () => {
    const lista = ordenarClientes([cliente(500, 1), cliente(500, 4)]);
    expect(lista[0].sugerencias).toHaveLength(4);
  });
});
