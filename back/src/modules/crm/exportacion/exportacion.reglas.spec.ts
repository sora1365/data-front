import {
  archivoDe,
  celda,
  contarFilas,
  csv,
  Manifiesto,
  motivoParaOmitir,
  sha256,
  verificar,
  VERSION_FORMATO,
} from './exportacion.reglas';

describe('celda', () => {
  it('nulo sin nada y texto vacío entre comillas', () => {
    expect(celda(null)).toBe('');
    expect(celda('')).toBe('""');
  });

  it('comillas, comas y saltos de línea van protegidos', () => {
    expect(celda('Andina, Cía. Ltda.')).toBe('"Andina, Cía. Ltda."');
    expect(celda('dijo "sí"')).toBe('"dijo ""sí"""');
    expect(celda('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('los espacios de los bordes no se pierden', () => {
    expect(celda(' Quito')).toBe('" Quito"');
    expect(celda('Quito')).toBe('Quito');
  });
});

describe('contarFilas', () => {
  it('no cuenta los saltos de línea que van dentro de un texto', () => {
    const t = csv(['id', 'texto'], [['1', 'uno\ndos\ntres'], ['2', null]]);
    expect(contarFilas(t)).toBe(2);
  });

  it('una tabla vacía tiene cero filas', () => {
    expect(contarFilas(csv(['id'], []))).toBe(0);
  });
});

describe('motivoParaOmitir', () => {
  it('deja fuera las llaves de los enlaces públicos', () => {
    expect(motivoParaOmitir('token', 'uuid')).toMatch(/credencial/);
    expect(motivoParaOmitir('csat_token', 'uuid')).toMatch(/credencial/);
  });

  it('pero no lo que sólo se parece', () => {
    expect(motivoParaOmitir('tokens_entrada', 'integer')).toBeNull();
    expect(motivoParaOmitir('entrada_hash', 'text')).toBeNull();
  });
});

describe('verificar', () => {
  const contenido = Buffer.from(csv(['id', 'nombre'], [['1', 'Ana'], ['2', '']]));
  const manifiesto: Manifiesto = {
    formato: VERSION_FORMATO,
    generado_en: '2026-10-28T00:00:00Z',
    por: 'sora',
    esquema: 'X',
    tablas: [
      { tabla: 'crm.contacto', archivo: archivoDe('crm.contacto'), filas: 2, columnas: ['id', 'nombre'], omitidas: [], sha256: sha256(contenido) },
    ],
    total_filas: 2,
  };

  it('un archivo intacto es válido', () => {
    const r = verificar(manifiesto, new Map([[archivoDe('crm.contacto'), contenido]]));
    expect(r).toEqual({ valido: true, problemas: [], tablas: 1, filas: 2 });
  });

  it('una fila tocada a mano se nota', () => {
    const tocado = Buffer.from(contenido.toString().replace('Ana', 'Ane'));
    const r = verificar(manifiesto, new Map([[archivoDe('crm.contacto'), tocado]]));
    expect(r.valido).toBe(false);
    expect(r.problemas[0]).toMatch(/huella/);
  });

  it('un archivo que falta o que sobra se nota', () => {
    const r = verificar(
      manifiesto,
      new Map([['tablas/crm.otra.csv', Buffer.from('id\r\n')]]),
    );
    expect(r.problemas.join(' ')).toMatch(/Falta tablas\/crm.contacto.csv/);
    expect(r.problemas.join(' ')).toMatch(/crm.otra.csv no está en el manifiesto/);
  });
});
