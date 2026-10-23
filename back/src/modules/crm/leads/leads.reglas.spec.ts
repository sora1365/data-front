import {
  campoVisible,
  duplicadoDe,
  elegirComercial,
  esPrimeraRespuesta,
  normalizarRuc,
  origenDe,
  pareceRobot,
  problemasDeFormulario,
  puedePasarLead,
  puntajeDe,
  tasasDelEmbudo,
  validarEnvio,
  type CampoFormulario,
} from './leads.reglas';

const CAMPOS: CampoFormulario[] = [
  { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true },
  { clave: 'correo', etiqueta: 'Correo', tipo: 'correo' },
  { clave: 'telefono', etiqueta: 'Celular', tipo: 'telefono' },
  { clave: 'ruc', etiqueta: 'RUC o cédula', tipo: 'texto' },
  { clave: 'servicio', etiqueta: 'Servicio', tipo: 'seleccion', opciones: ['Auditoría', 'Contabilidad'] },
  {
    clave: 'empleados',
    etiqueta: 'Número de empleados',
    tipo: 'texto',
    obligatorio: true,
    mostrarSi: { campo: 'servicio', valor: 'Contabilidad' },
  },
];

describe('normalizarRuc', () => {
  it('convierte una cédula en el RUC de la persona natural', () => {
    expect(normalizarRuc('0102030405')).toBe('0102030405001');
  });

  /** El cero inicial perdido es el código de provincia: sin él no enlaza con el padrón. */
  it('repone el cero inicial que se pierde en una hoja de cálculo', () => {
    expect(normalizarRuc('101384501001')).toBe('0101384501001');
    expect(normalizarRuc('102030405')).toBe('0102030405001');
  });

  it('acepta el RUC con guiones o espacios', () => {
    expect(normalizarRuc('1790-0123-45001')).toBe('1790012345001');
  });

  it('deja lo extranjero en dígitos, sin adivinar', () => {
    expect(normalizarRuc('20-12345678-9')).toBe('20123456789');
    expect(normalizarRuc('')).toBeNull();
  });
});

describe('problemasDeFormulario', () => {
  it('acepta un formulario bien definido', () => {
    expect(problemasDeFormulario(CAMPOS)).toEqual([]);
  });

  it('exige correo o teléfono: sin ellos el lead no se puede contactar', () => {
    expect(problemasDeFormulario([{ clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto' }])).toContain(
      'El formulario necesita al menos un campo «correo» o «telefono».',
    );
  });

  it('rechaza claves repetidas, inválidas o reservadas por el sistema', () => {
    const problemas = problemasDeFormulario([
      { clave: 'correo', etiqueta: 'Correo', tipo: 'correo' },
      { clave: 'correo', etiqueta: 'Otro correo', tipo: 'correo' },
      { clave: 'Teléfono', etiqueta: 'Tel', tipo: 'telefono' },
      { clave: 'utm_source', etiqueta: 'Fuente', tipo: 'texto' },
    ]);
    expect(problemas.join(' ')).toMatch(/repetida/);
    expect(problemas.join(' ')).toMatch(/minúsculas/);
    expect(problemas.join(' ')).toMatch(/la usa el sistema/);
  });

  it('rechaza una condición que apunta a un campo que no existe', () => {
    const problemas = problemasDeFormulario([
      { clave: 'correo', etiqueta: 'Correo', tipo: 'correo' },
      { clave: 'x', etiqueta: 'X', tipo: 'texto', mostrarSi: { campo: 'nada', valor: 'a' } },
    ]);
    expect(problemas.join(' ')).toMatch(/no está en el formulario/);
  });

  it('exige opciones en una selección', () => {
    expect(
      problemasDeFormulario([
        { clave: 'correo', etiqueta: 'Correo', tipo: 'correo' },
        { clave: 'plan', etiqueta: 'Plan', tipo: 'seleccion' },
      ]).join(' '),
    ).toMatch(/necesita opciones/);
  });
});

describe('validarEnvio', () => {
  it('limpia y normaliza un envío correcto', () => {
    const { errores, envio } = validarEnvio(CAMPOS, {
      nombre: '  Ana Pérez ',
      correo: 'Ana@Empresa.EC',
      telefono: '099 123 4567',
      ruc: '0102030405',
      servicio: 'Auditoría',
      consentimiento: 'on',
    });
    expect(errores).toEqual([]);
    expect(envio).toMatchObject({
      nombre: 'Ana Pérez',
      correoNorm: 'ana@empresa.ec',
      telefonoNorm: '593991234567',
      ruc: '0102030405001',
      consentimiento: true,
      datos: { Servicio: 'Auditoría' },
    });
  });

  it('exige los obligatorios y avisa de los formatos', () => {
    const { errores } = validarEnvio(CAMPOS, { correo: 'no-es-correo', telefono: '12' });
    expect(errores).toEqual(
      expect.arrayContaining([
        'Falta «Nombre».',
        '«Correo» no parece un correo válido.',
        '«Celular» no parece un teléfono válido.',
      ]),
    );
  });

  it('no acepta una opción que no está en la lista', () => {
    const { errores } = validarEnvio(CAMPOS, { nombre: 'A', correo: 'a@b.ec', servicio: 'Otra' });
    expect(errores).toEqual(['«Servicio»: esa opción no está en la lista.']);
  });

  /** Lo oculto no se exige ni se guarda: si cambió de opción, lo escrito ya no aplica. */
  it('aplica los campos condicionales', () => {
    const sinMostrar = validarEnvio(CAMPOS, {
      nombre: 'A',
      correo: 'a@b.ec',
      servicio: 'Auditoría',
      empleados: '40',
    });
    expect(sinMostrar.errores).toEqual([]);
    expect(sinMostrar.envio!.datos).not.toHaveProperty('Número de empleados');

    const mostrado = validarEnvio(CAMPOS, { nombre: 'A', correo: 'a@b.ec', servicio: 'Contabilidad' });
    expect(mostrado.errores).toEqual(['Falta «Número de empleados».']);
  });

  it('reconoce la opción aunque la tilde llegue descompuesta', () => {
    const { errores } = validarEnvio(CAMPOS, {
      nombre: 'A',
      correo: 'a@b.ec',
      servicio: 'Auditoría'.normalize('NFD'),
    });
    expect(errores).toEqual([]);
  });

  it('pide al menos un medio de contacto aunque ninguno sea obligatorio', () => {
    expect(validarEnvio(CAMPOS, { nombre: 'A' }).errores).toEqual([
      'Deja al menos un correo o un teléfono para poder contactarte.',
    ]);
  });

  /** El endpoint es público: lo que no está en el formulario no entra al jsonb. */
  it('ignora lo que llega y no está en el formulario', () => {
    const { envio } = validarEnvio(CAMPOS, { nombre: 'A', correo: 'a@b.ec', inventado: 'x'.repeat(10000) });
    expect(envio!.datos).toEqual({});
  });

  it('recorta lo que llega demasiado largo', () => {
    const { envio } = validarEnvio(CAMPOS, { nombre: 'x'.repeat(2000), correo: 'a@b.ec' });
    expect(envio!.nombre).toHaveLength(500);
  });
});

describe('campoVisible', () => {
  it('muestra un campo sin condición y oculta el condicional hasta que se cumple', () => {
    expect(campoVisible(CAMPOS[0], {})).toBe(true);
    expect(campoVisible(CAMPOS[5], { servicio: 'Auditoría' })).toBe(false);
    expect(campoVisible(CAMPOS[5], { servicio: 'Contabilidad' })).toBe(true);
  });
});

describe('pareceRobot', () => {
  const ahora = 1_000_000_000;

  it('delata al que rellena el campo trampa', () => {
    expect(pareceRobot({ sitio_web_hp: 'http://spam' }, ahora)).toBe(true);
  });

  it('delata al que envía en menos de dos segundos', () => {
    expect(pareceRobot({ abierto_en: String(ahora - 500) }, ahora)).toBe(true);
  });

  it('deja pasar a una persona, y a quien no tiene JavaScript', () => {
    expect(pareceRobot({ abierto_en: String(ahora - 30_000) }, ahora)).toBe(false);
    expect(pareceRobot({ abierto_en: '' }, ahora)).toBe(false);
  });
});

describe('origenDe', () => {
  it('toma los utm', () => {
    expect(
      origenDe({ utm_source: 'Facebook', utm_medium: 'CPC', utm_campaign: 'Marzo 2026' }),
    ).toMatchObject({ fuente: 'facebook', medio: 'cpc', campania: 'Marzo 2026' });
  });

  /** Sin utm pero con página, el origen es ese dominio, no «sin origen». */
  it('sin utm, usa el dominio de la página', () => {
    expect(origenDe({ pagina: 'https://www.ascendra.ec/servicios?x=1' }).fuente).toBe('ascendra.ec');
  });

  it('no falla con una página que no es URL', () => {
    expect(origenDe({ pagina: 'basura' }).fuente).toBeNull();
  });
});

describe('duplicadoDe', () => {
  const vivos = [
    { id: 2, correo_norm: 'ana@b.ec', telefono_norm: null, recibido_en: '2026-10-02' },
    { id: 1, correo_norm: null, telefono_norm: '593991234567', recibido_en: '2026-10-01' },
  ];

  it('reconoce a la misma persona por el correo o por el teléfono', () => {
    expect(duplicadoDe({ correoNorm: 'ana@b.ec', telefonoNorm: null }, vivos)?.id).toBe(2);
    expect(duplicadoDe({ correoNorm: 'otro@b.ec', telefonoNorm: '593991234567' }, vivos)?.id).toBe(1);
  });

  /** El más antiguo es el que alguien ya puede estar trabajando. */
  it('si coincide con varios, gana el más antiguo', () => {
    expect(duplicadoDe({ correoNorm: 'ana@b.ec', telefonoNorm: '593991234567' }, vivos)?.id).toBe(1);
  });

  it('no confunde dos vacíos con una coincidencia', () => {
    expect(duplicadoDe({ correoNorm: null, telefonoNorm: '593000000000' }, vivos)).toBeNull();
  });
});

describe('elegirComercial', () => {
  const activos = new Set(['ana', 'luis', 'eva']);

  it('le da el lead primero a quien no ha recibido ninguno', () => {
    expect(elegirComercial(['ana', 'luis'], activos, new Map([['ana', '2026-10-01']]))).toBe('luis');
  });

  it('después, a quien hace más tiempo que no recibe', () => {
    expect(
      elegirComercial(
        ['ana', 'luis'],
        activos,
        new Map([
          ['ana', '2026-10-05'],
          ['luis', '2026-10-03'],
        ]),
      ),
    ).toBe('luis');
  });

  it('en empate decide el orden de la lista', () => {
    expect(elegirComercial(['eva', 'ana'], activos, new Map())).toBe('eva');
  });

  it('salta a quien ya no está activo y no asigna si no queda nadie', () => {
    expect(elegirComercial(['pedro', 'ana'], activos, new Map())).toBe('ana');
    expect(elegirComercial(['pedro'], activos, new Map())).toBeNull();
    expect(elegirComercial([], activos, new Map())).toBeNull();
  });
});

describe('transiciones de estado', () => {
  it('un lead sólo se convierte creando su oportunidad', () => {
    for (const desde of ['nuevo', 'contactado', 'calificado', 'descartado'] as const) {
      expect(puedePasarLead(desde, 'convertido')).toBe(false);
    }
  });

  it('un descartado se puede recuperar; un convertido no se mueve', () => {
    expect(puedePasarLead('descartado', 'contactado')).toBe(true);
    expect(puedePasarLead('convertido', 'nuevo')).toBe(false);
  });

  it('la primera respuesta es salir de «nuevo» por primera vez', () => {
    expect(esPrimeraRespuesta('nuevo', null)).toBe(true);
    expect(esPrimeraRespuesta('nuevo', '2026-10-01')).toBe(false);
    expect(esPrimeraRespuesta('contactado', null)).toBe(false);
  });
});

describe('puntajeDe', () => {
  it('premia los datos completos y volver a escribir', () => {
    const solo = puntajeDe({ correo: 'a@b.ec' });
    const completo = puntajeDe({
      correo: 'a@b.ec',
      telefono: '0991234567',
      empresa: 'X',
      ruc: '0102030405001',
      enPadron: true,
      mensaje: 'Necesito una auditoría para este año',
      consentimiento: true,
      envios: 2,
    });
    expect(solo).toBeLessThan(completo);
    expect(completo).toBe(100);
  });
});

describe('tasasDelEmbudo', () => {
  it('calcula envío, abandono y conversión', () => {
    expect(
      tasasDelEmbudo({ vistas: 200, recibidos: 50, atendidos: 40, calificados: 20, convertidos: 5 }),
    ).toEqual({ envio: 25, abandono: 75, atencion: 80, calificacion: 40, conversion: 10 });
  });

  /** Envíos por JSON no pasan por la página que cuenta visitas. */
  it('no da abandono cuando hay más leads que visitas', () => {
    const t = tasasDelEmbudo({ vistas: 1, recibidos: 4, atendidos: 2, calificados: 1, convertidos: 1 });
    expect(t.envio).toBeNull();
    expect(t.abandono).toBeNull();
    expect(t.conversion).toBe(25);
  });

  it('sin denominador no inventa un cero', () => {
    expect(
      tasasDelEmbudo({ vistas: 0, recibidos: 0, atendidos: 0, calificados: 0, convertidos: 0 }),
    ).toEqual({ envio: null, abandono: null, atencion: null, calificacion: null, conversion: null });
  });
});
