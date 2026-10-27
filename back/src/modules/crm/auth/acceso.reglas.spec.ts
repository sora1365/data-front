import {
  BLOQUEO_MINUTOS,
  bloqueadoHasta,
  cifrarClave,
  claveCorrecta,
  claveProvisional,
  esRutaDelCrm,
  INTENTOS_MAXIMOS,
  permitidaConClaveProvisional,
  problemaAlEscribirComercial,
  problemaDeClave,
  secretoValido,
} from './acceso.reglas';

describe('claves', () => {
  it('comprueba la clave cifrada y rechaza otra', () => {
    const guardado = cifrarClave('una frase bastante larga');
    expect(claveCorrecta('una frase bastante larga', guardado)).toBe(true);
    expect(claveCorrecta('una frase bastante larg', guardado)).toBe(false);
  });

  it('dos cifrados de la misma clave no coinciden (llevan sal)', () => {
    expect(cifrarClave('misma clave larga')).not.toBe(cifrarClave('misma clave larga'));
  });

  it('sin hash o con un hash raro no deja entrar', () => {
    expect(claveCorrecta('loquesea1234', null)).toBe(false);
    expect(claveCorrecta('loquesea1234', 'texto-plano')).toBe(false);
  });

  it('pide largo y que no contenga el usuario', () => {
    expect(problemaDeClave('corta', 'ana')).toMatch(/al menos/);
    expect(problemaDeClave('soyAna-del-equipo', 'ana')).toMatch(/usuario/);
    expect(problemaDeClave('caballo grapa batería', 'ana')).toBeNull();
  });

  it('la provisional es legible y cumple las reglas', () => {
    const c = claveProvisional();
    expect(c).toMatch(/^[a-zA-Z2-9]{7}-[a-zA-Z2-9]{7}$/);
    expect(c).not.toMatch(/[01OlI]/);
    expect(problemaDeClave(c, 'ana')).toBeNull();
  });
});

describe('bloqueadoHasta', () => {
  const ahora = new Date('2026-10-26T12:00:00Z');
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
  const fallos = (n: number, desde = 1) =>
    Array.from({ length: n }, (_, i) => ({ exito: false, en: hace(desde + i) }));

  it('no bloquea por debajo del máximo', () => {
    expect(bloqueadoHasta(fallos(INTENTOS_MAXIMOS - 1), ahora)).toBeNull();
  });

  it('bloquea al llegar al máximo, contando desde el último fallo', () => {
    const hasta = bloqueadoHasta(fallos(INTENTOS_MAXIMOS), ahora);
    expect(hasta?.getTime()).toBe(hace(1).getTime() + BLOQUEO_MINUTOS * 60_000);
  });

  it('el bloqueo se levanta solo', () => {
    expect(bloqueadoHasta(fallos(INTENTOS_MAXIMOS, BLOQUEO_MINUTOS + 1), ahora)).toBeNull();
  });

  it('una entrada buena borra los fallos anteriores', () => {
    const intentos = [...fallos(2), { exito: true, en: hace(10) }, ...fallos(5, 11)];
    expect(bloqueadoHasta(intentos, ahora)).toBeNull();
  });
});

describe('secretoValido', () => {
  it('rechaza el de ejemplo, uno corto o ninguno', () => {
    expect(secretoValido(undefined)).toBeNull();
    expect(secretoValido('corto')).toBeNull();
    expect(secretoValido('your-secret-key-change-this-in-production-please')).toBeNull();
  });

  it('acepta uno largo de verdad', () => {
    const s = 'k8Jq2vZ0xYw3Lr7NtPm4Hs6Fd1Gb9Ce5';
    expect(secretoValido(`  ${s}  `)).toBe(s);
  });
});

describe('rutas', () => {
  it('sólo vigila el CRM', () => {
    expect(esRutaDelCrm('/crm/api/deals')).toBe(true);
    expect(esRutaDelCrm('/crm')).toBe(true);
    expect(esRutaDelCrm('/crmx')).toBe(false);
    expect(esRutaDelCrm('/segmentos')).toBe(false);
  });

  it('con clave provisional sólo se puede ir a cambiarla', () => {
    expect(permitidaConClaveProvisional('/crm/auth/clave')).toBe(true);
    expect(permitidaConClaveProvisional('/crm/api/deals')).toBe(false);
  });
});

describe('problemaAlEscribirComercial', () => {
  const ana = { username: 'ana', administrador: false };
  const jefa = { username: 'jefa', administrador: true };

  it('cada uno cambia su nombre y su correo', () => {
    expect(problemaAlEscribirComercial(ana, 'editar', 'ana', { first_name: 'Ana' })).toBeNull();
  });

  it('la ficha entera con los permisos sin cambiar se acepta', () => {
    const ficha = { id: 'ana', first_name: 'Ana', administrator: false, disabled: false };
    expect(problemaAlEscribirComercial(ana, 'editar', 'ana', ficha)).toBeNull();
  });

  it('nadie se hace administrador a sí mismo', () => {
    expect(problemaAlEscribirComercial(ana, 'editar', 'ana', { administrator: true })).toMatch(
      /administrador/,
    );
  });

  it('un comercial no toca la ficha de otro ni da altas', () => {
    expect(problemaAlEscribirComercial(ana, 'editar', 'luis', { first_name: 'x' })).not.toBeNull();
    expect(problemaAlEscribirComercial(ana, 'crear')).not.toBeNull();
    expect(problemaAlEscribirComercial(ana, 'borrar', 'luis')).not.toBeNull();
  });

  it('un administrador gestiona a los demás, pero no se quita el permiso', () => {
    expect(problemaAlEscribirComercial(jefa, 'editar', 'ana', { disabled: true })).toBeNull();
    expect(problemaAlEscribirComercial(jefa, 'editar', 'jefa', { administrator: false })).toMatch(
      /ti mismo/,
    );
    expect(problemaAlEscribirComercial(jefa, 'editar', 'jefa', { disabled: true })).toMatch(
      /ti mismo/,
    );
  });
});
