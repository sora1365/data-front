import {
  correoPlausible,
  normalizarCorreo,
  personalizar,
  problemasDeCampania,
  repartirDestinatarios,
  variablesUsadas,
  type EstadoConsentimiento,
} from './campanias.reglas';

const consentimientos = (pares: [string, EstadoConsentimiento][]) => new Map(pares);

describe('correoPlausible', () => {
  it('acepta direcciones normales', () => {
    expect(correoPlausible('ventas@ascendra.ec')).toBe(true);
    expect(correoPlausible('juan.perez+crm@empresa.com.ec')).toBe(true);
  });

  /**
   * Lo que de verdad llega en los datos del padrón. Pasárselo al proveedor
   * sube los rebotes, y la tasa de rebotes decide si el resto llega o cae en
   * spam.
   */
  it('descarta la basura que traen los datos', () => {
    expect(correoPlausible('-')).toBe(false);
    expect(correoPlausible('no tiene')).toBe(false);
    expect(correoPlausible('0999123456')).toBe(false);
    expect(correoPlausible('sin arroba.com')).toBe(false);
    expect(correoPlausible('dos@@arrobas.com')).toBe(false);
    expect(correoPlausible('falta@dominio')).toBe(false);
    expect(correoPlausible('punto@final.')).toBe(false);
    expect(correoPlausible('doble@punto..com')).toBe(false);
    expect(correoPlausible('')).toBe(false);
  });

  it('descarta una terminación de una letra', () => {
    expect(correoPlausible('algo@dominio.e')).toBe(false);
  });
});

describe('normalizarCorreo', () => {
  /**
   * El caso que hace volver a escribir a quien se dio de baja: el mismo correo
   * llega de dos fuentes escrito distinto.
   */
  it('iguala mayúsculas y espacios', () => {
    expect(normalizarCorreo('  Ventas@Empresa.EC ')).toBe('ventas@empresa.ec');
  });
});

describe('repartirDestinatarios', () => {
  it('deja pasar a quien no ha dicho nada', () => {
    const { envian } = repartirDestinatarios(
      [{ correo: 'a@empresa.ec' }],
      consentimientos([]),
    );
    expect(envian).toHaveLength(1);
  });

  it('nunca escribe a quien se dio de baja', () => {
    const { envian, descartados } = repartirDestinatarios(
      [{ correo: 'a@empresa.ec' }],
      consentimientos([['a@empresa.ec', 'revocado']]),
    );
    expect(envian).toHaveLength(0);
    expect(descartados[0].motivo).toBe('se dio de baja');
  });

  it('respeta la baja aunque llegue escrito distinto', () => {
    const { envian } = repartirDestinatarios(
      [{ correo: '  A@Empresa.EC ' }],
      consentimientos([['a@empresa.ec', 'revocado']]),
    );
    expect(envian).toHaveLength(0);
  });

  it('no manda dos veces al mismo', () => {
    const { envian, descartados } = repartirDestinatarios(
      [{ correo: 'a@empresa.ec' }, { correo: 'A@EMPRESA.EC' }],
      consentimientos([]),
    );
    expect(envian).toHaveLength(1);
    expect(descartados[0].motivo).toBe('repetido en la lista');
  });

  it('descarta los correos inservibles', () => {
    const { envian, descartados } = repartirDestinatarios(
      [{ correo: '-' }, { correo: 'bien@empresa.ec' }],
      consentimientos([]),
    );
    expect(envian).toHaveLength(1);
    expect(descartados[0].motivo).toBe('correo no válido');
  });

  /**
   * Con consentimiento expreso exigido, no basta con no haberse dado de baja:
   * hay que haber dicho que sí. Es el modo que hace falta cuando la campaña
   * sale a personas físicas.
   */
  it('puede exigir consentimiento expreso', () => {
    const candidatos = [{ correo: 'si@empresa.ec' }, { correo: 'callado@empresa.ec' }];
    const estados = consentimientos([['si@empresa.ec', 'otorgado' as const]]);

    const normal = repartirDestinatarios(candidatos, estados);
    expect(normal.envian).toHaveLength(2);

    const estricto = repartirDestinatarios(candidatos, estados, {
      exigirConsentimientoExpreso: true,
    });
    expect(estricto.envian).toHaveLength(1);
    expect(estricto.descartados[0].motivo).toBe('sin consentimiento expreso');
  });

  /** Lo primero es una decisión suya; lo segundo, un problema de datos. */
  it('la baja pesa más que el correo mal escrito', () => {
    const { descartados } = repartirDestinatarios(
      [{ correo: 'malo@sinpunto' }],
      consentimientos([['malo@sinpunto', 'revocado']]),
    );
    expect(descartados[0].motivo).toBe('se dio de baja');
  });
});

describe('personalizar', () => {
  it('sustituye por nombre', () => {
    expect(personalizar('Hola {{nombre}}', { nombre: 'Marta' })).toBe('Hola Marta');
  });

  /** «Estimado {{nombre}}» a mil personas es peor que «Estimado» a secas. */
  it('una variable sin valor no imprime el hueco', () => {
    expect(personalizar('Estimado {{nombre}},', {})).toBe('Estimado ,');
    expect(personalizar('Estimado {{nombre}},', { nombre: null })).toBe('Estimado ,');
  });

  it('admite espacios dentro de las llaves', () => {
    expect(personalizar('Hola {{ nombre }}', { nombre: 'Ana' })).toBe('Hola Ana');
  });

  it('deja intacto lo que no es una variable', () => {
    expect(personalizar('Precio: $1.000 {no es variable}', {})).toBe('Precio: $1.000 {no es variable}');
  });
});

describe('variablesUsadas', () => {
  it('lista las distintas', () => {
    expect(variablesUsadas('Hola {{nombre}}, de {{empresa}}. Saludos, {{nombre}}').sort()).toEqual([
      'empresa',
      'nombre',
    ]);
  });
});

describe('problemasDeCampania', () => {
  const buena = {
    asunto: 'Auditoría externa',
    cuerpo: 'Hola {{nombre}}. Para dejar de recibir: {{baja}}',
    remitente: 'ventas@ascendra.ec',
  };

  it('acepta una campaña completa', () => {
    expect(problemasDeCampania(buena)).toEqual([]);
  });

  /**
   * Con el cuerpo vacío se dice que falta el cuerpo y nada más. Añadir que
   * además le falta `{{baja}}` sería repetir el mismo problema con otras
   * palabras, y una lista de avisos redundantes se lee como ruido.
   */
  it('exige asunto y cuerpo, sin repetirse', () => {
    expect(problemasDeCampania({ asunto: '', cuerpo: '' })).toEqual([
      'Falta el asunto.',
      'Falta el cuerpo del mensaje.',
    ]);
  });

  /**
   * Sin enlace de baja el envío es ilegal de facto, y además arruina la
   * reputación del dominio: quien no encuentra cómo salir marca como spam, y
   * eso afecta a todo lo que se mande después desde esa dirección.
   */
  it('exige el enlace de baja', () => {
    const sinBaja = { ...buena, cuerpo: 'Hola {{nombre}}, le escribimos para...' };
    expect(problemasDeCampania(sinBaja)[0]).toContain('{{baja}}');
  });

  it('rechaza un remitente que no es un correo', () => {
    expect(problemasDeCampania({ ...buena, remitente: 'ascendra' })[0]).toContain('remitente');
  });
});
