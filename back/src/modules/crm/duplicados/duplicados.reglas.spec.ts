import {
  agrupar,
  claveDeCorreo,
  claveDeEmpresa,
  claveDeNombre,
  claveDePar,
  claveDeRuc,
  claveDeTelefono,
  rellenar,
  unir,
} from './duplicados.reglas';

describe('claves', () => {
  it('el mismo celular escrito de tres formas', () => {
    expect(claveDeTelefono('0991234567')).toBe('991234567');
    expect(claveDeTelefono('+593 99 123 4567')).toBe('991234567');
    expect(claveDeTelefono('593991234567')).toBe('991234567');
    expect(claveDeTelefono('105')).toBeNull();
  });

  it('correos en minúsculas, y lo que no es correo no cuenta', () => {
    expect(claveDeCorreo(' Ana@Empresa.COM ')).toBe('ana@empresa.com');
    expect(claveDeCorreo('ana')).toBeNull();
  });

  it('nombres sin acentos, y un nombre solo no basta', () => {
    expect(claveDeNombre('José', 'Pérez  Mora')).toBe('jose perez mora');
    expect(claveDeNombre('Juan', '')).toBeNull();
  });

  it('la misma empresa con distinta forma societaria', () => {
    const acme = claveDeEmpresa('ACME S.A.');
    expect(acme).toBe('acme');
    expect(claveDeEmpresa('Acme SA')).toBe(acme);
    expect(claveDeEmpresa('ACME, Sociedad Anónima')).toBe(acme);
    expect(claveDeEmpresa('Comercial Andina Cía. Ltda.')).toBe(claveDeEmpresa('COMERCIAL ANDINA CIA LTDA'));
    expect(claveDeEmpresa('" DONDECOCO " S.A.S.')).toBe('dondecoco');
  });

  it('sólo se quita la forma societaria del final', () => {
    expect(claveDeEmpresa('Sociedad Agrícola del Sur')).toBe('sociedad agricola del sur');
    expect(claveDeEmpresa('SA Consultores')).toBe('sa consultores');
  });

  it('el RUC por sus cifras', () => {
    expect(claveDeRuc('1790012345001')).toBe('1790012345001');
    expect(claveDeRuc('179-001-2345-001')).toBe('1790012345001');
    expect(claveDeRuc('123')).toBeNull();
  });
});

describe('agrupar', () => {
  const contactos = [
    { id: 1, correo: 'ana@x.com', tel: '0991234567' },
    { id: 2, correo: 'ANA@x.com', tel: '+593991234567' },
    { id: 3, correo: 'otro@x.com', tel: null },
  ];
  const claves = (c: (typeof contactos)[number]) => [
    { motivo: 'correo' as const, clave: claveDeCorreo(c.correo) },
    { motivo: 'telefono' as const, clave: claveDeTelefono(c.tel) },
  ];

  it('junta los motivos de un mismo par', () => {
    expect(agrupar(contactos, claves)).toEqual([{ a: 1, b: 2, motivos: ['correo', 'telefono'] }]);
  });

  it('respeta los pares marcados como distintos', () => {
    expect(agrupar(contactos, claves, new Set([claveDePar(2, 1)]))).toEqual([]);
  });

  it('una clave compartida por muchos es genérica y no junta a nadie', () => {
    const oficina = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, correo: 'info@x.com', tel: null }));
    expect(agrupar(oficina, claves)).toEqual([]);
  });

  it('los más parecidos primero', () => {
    const empresas = [
      { id: 1, nombre: 'Acme SA', ruc: null },
      { id: 2, nombre: 'ACME S.A.', ruc: null },
      { id: 3, nombre: 'Beta', ruc: '1790012345001' },
      { id: 4, nombre: 'Beta Cía Ltda', ruc: '1790012345001' },
    ];
    const pares = agrupar(empresas, (e) => [
      { motivo: 'ruc', clave: claveDeRuc(e.ruc) },
      { motivo: 'nombre', clave: claveDeEmpresa(e.nombre) },
    ]);
    expect(pares.map((p) => `${p.a}-${p.b}`)).toEqual(['3-4', '1-2']);
    expect(pares[0].motivos.sort()).toEqual(['nombre', 'ruc']);
  });
});

describe('juntar', () => {
  it('rellena los huecos del ganador sin pisar lo que tiene', () => {
    expect(
      rellenar({ title: 'Gerente', city: null }, { title: 'Contador', city: 'Quito' }, ['title', 'city']),
    ).toEqual({ city: 'Quito' });
  });

  it('une listas sin repetir y con lo del ganador primero', () => {
    expect(
      unir([{ email: 'a@x.com' }], [{ email: 'A@x.com' }, { email: 'b@x.com' }], (x) => claveDeCorreo(x.email)),
    ).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
  });
});
