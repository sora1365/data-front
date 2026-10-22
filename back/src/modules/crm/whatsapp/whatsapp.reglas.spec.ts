import {
  VENTANA_MS,
  estadoVentana,
  normalizarTelefono,
  puedeEnviar,
  rellenarPlantilla,
  variablesDePlantilla,
} from './whatsapp.reglas';

const AHORA = new Date('2026-10-22T12:00:00Z');
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 60 * 60 * 1000);

describe('ventana de 24 horas', () => {
  it('está abierta si el cliente escribió hace menos de un día', () => {
    expect(estadoVentana(haceHoras(3), AHORA).abierta).toBe(true);
  });

  it('está cerrada pasadas las 24 horas', () => {
    expect(estadoVentana(haceHoras(25), AHORA).abierta).toBe(false);
  });

  /** El minuto 23:59 todavía cuenta: la ventana se cierra, no se redondea. */
  it('sigue abierta justo antes de cumplirse', () => {
    const casi = new Date(AHORA.getTime() - VENTANA_MS + 60_000);
    expect(estadoVentana(casi, AHORA).abierta).toBe(true);
  });

  it('está cerrada si el cliente nunca escribió', () => {
    expect(estadoVentana(null, AHORA)).toEqual({ abierta: false, restanteMs: 0 });
  });

  it('una fecha ilegible no abre la ventana', () => {
    expect(estadoVentana('cualquier cosa', AHORA).abierta).toBe(false);
  });

  it('dice cuánto queda, para poder avisar antes de que cierre', () => {
    const { restanteMs } = estadoVentana(haceHoras(20), AHORA);
    expect(Math.round(restanteMs / 3_600_000)).toBe(4);
  });
});

describe('puedeEnviar', () => {
  it('deja escribir libremente dentro de la ventana', () => {
    expect(puedeEnviar('libre', haceHoras(2), AHORA).permitido).toBe(true);
  });

  it('no deja escribir libremente fuera de la ventana', () => {
    const r = puedeEnviar('libre', haceHoras(30), AHORA);
    expect(r.permitido).toBe(false);
    expect(r.motivo).toContain('plantilla');
  });

  /**
   * El motivo cambia según el caso porque la acción es distinta: a quien nunca
   * escribió hay que abrirle conversación; a quien escribió anteayer hay que
   * retomarla. Las dos con plantilla, pero no es lo mismo de cara a quien lo lee.
   */
  it('distingue al que nunca escribió del que escribió hace mucho', () => {
    expect(puedeEnviar('libre', null, AHORA).motivo).toContain('todavía no ha escrito');
    expect(puedeEnviar('libre', haceHoras(30), AHORA).motivo).toContain('más de 24 horas');
  });

  it('una plantilla se puede enviar siempre: es para lo que existe', () => {
    expect(puedeEnviar('plantilla', null, AHORA).permitido).toBe(true);
    expect(puedeEnviar('plantilla', haceHoras(500), AHORA).permitido).toBe(true);
  });
});

describe('normalizarTelefono', () => {
  it('convierte el formato nacional al internacional', () => {
    expect(normalizarTelefono('0992154545')).toBe('593992154545');
  });

  it('quita los signos de lo que la gente teclea', () => {
    expect(normalizarTelefono('+593 99 215 4545')).toBe('593992154545');
    expect(normalizarTelefono('(099) 215-4545')).toBe('593992154545');
  });

  /**
   * El caso que pierde mensajes en silencio: pegar el código de país delante
   * del número nacional sin quitar el cero. `5930992154545` no existe, Meta lo
   * acepta y el mensaje no llega a nadie.
   */
  it('no deja el cero nacional detrás del código de país', () => {
    expect(normalizarTelefono('5930992154545')).toBe('593992154545');
  });

  it('acepta el celular sin cero', () => {
    expect(normalizarTelefono('992154545')).toBe('593992154545');
  });

  it('respeta un número extranjero', () => {
    expect(normalizarTelefono('+1 415 555 2671')).toBe('14155552671');
  });

  it('un valor vacío no inventa un número', () => {
    expect(normalizarTelefono('')).toBe('');
    expect(normalizarTelefono('sin dígitos')).toBe('');
  });
});

describe('plantillas', () => {
  it('cuenta las variables distintas, no las apariciones', () => {
    expect(variablesDePlantilla('Hola {{1}}, te escribe {{2}}. Un saludo, {{2}}.')).toBe(2);
  });

  it('una plantilla sin variables no pide ninguna', () => {
    expect(variablesDePlantilla('Gracias por escribirnos.')).toBe(0);
  });

  it('rellena por posición', () => {
    expect(rellenarPlantilla('Hola {{1}}, soy {{2}}', ['Ana', 'Sora'])).toBe('Hola Ana, soy Sora');
  });

  it('una variable sin valor se queda vacía y no imprime el hueco', () => {
    expect(rellenarPlantilla('Hola {{1}}, soy {{2}}', ['Ana'])).toBe('Hola Ana, soy ');
  });
});
