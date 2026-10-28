import { IaSinConfigurar } from './ia.conector';
import { contextoLead, contextoOportunidad, contextoTicket, envolver, huella, sinContacto } from './ia.contexto';
import { acotar, CalificacionLead } from './ia.esquemas';

describe('lo que no viaja a la IA', () => {
  it('quita correos y teléfonos de un texto libre', () => {
    const t = sinContacto('Escríbeme a ana.perez@empresa.com.ec o al 0991234567, o al +593 2 234 5678');
    expect(t).not.toMatch(/ana\.perez|0991234567|234 5678/);
    expect(t).toContain('[correo]');
    expect(t).toContain('[teléfono]');
  });

  it('no confunde un RUC con un teléfono', () => {
    expect(sinContacto('RUC 2390012345001 y 0101384501001')).toBe('RUC 2390012345001 y 0101384501001');
    expect(sinContacto('cel 099 123 4567')).toBe('cel [teléfono]');
  });

  it('el lead manda si dejó teléfono, no cuál', () => {
    const texto = envolver(
      '2026-10-28',
      contextoLead({
        lead: {
          nombre: 'Ana',
          correo: 'ana@x.com',
          telefono: '0991234567',
          estado: 'nuevo',
          recibido_en: '2026-10-27',
          datos: { correo: 'ana@x.com', 'Teléfono de contacto': '0991234567', empleados: '25' },
        },
        empresa: null,
        interacciones: [],
        catalogo: [{ codigo: 'contabilidad_mes', nombre: 'Contabilidad mensual' }],
      }),
    );
    expect(texto).not.toMatch(/ana@x\.com|0991234567/);
    expect(texto).toContain('Dejó teléfono: sí');
    expect(texto).toContain('empleados: 25');
    expect(texto).toContain('contabilidad_mes');
  });

  it('la empresa va con actividad y balances, y los contactos con nombre y cargo', () => {
    const texto = contextoOportunidad({
      oportunidad: { name: 'Auditoría 2026', etapa: 'propuesta', creada_en: '2026-10-01' },
      empresa: { name: 'ACME', perfil: { actividad: 'Comercio', ingresos_ult: 1_000_000, anio_ult: 2025 } },
      contactos: [{ first_name: 'Luis', last_name: 'Mora', title: 'Gerente' }],
      interacciones: [],
      notas: [],
      tareas: [],
      proformas: [],
    });
    expect(texto).toContain('Actividad (CIIU): Comercio');
    expect(texto).toContain('Ingresos 2025: 1000000');
    expect(texto).toContain('Luis Mora (Gerente)');
  });
});

describe('cómo se le cuenta una ficha', () => {
  it('va dentro de <datos>, con la fecha de hoy fuera', () => {
    const t = envolver('2026-10-28', 'algo');
    expect(t.startsWith('Hoy es 2026-10-28.')).toBe(true);
    expect(t).toMatch(/<datos>\nalgo\n<\/datos>$/);
  });

  it('con mucho historial se quedan los más recientes y se avisa', () => {
    const interacciones = Array.from({ length: 45 }, (_, i) => ({
      canal: 'llamada',
      texto: `llamada ${i}`,
      ocurrido_en: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    }));
    const texto = contextoOportunidad({
      oportunidad: { etapa: 'contacto', creada_en: '2026-01-01' },
      empresa: null,
      contactos: [],
      interacciones,
      notas: [],
      tareas: [],
      proformas: [],
    });
    expect(texto).toContain('(5 anteriores omitidos)');
    expect(texto).toContain('llamada 44');
    expect(texto).not.toContain('llamada 4:');
  });

  it('en el ticket distingue respuesta, nota interna y cliente', () => {
    const texto = contextoTicket({
      ticket: { id: 7, asunto: 'x', tipo: 'queja', prioridad: 'alta', estado: 'en_curso', canal: 'whatsapp', creado_en: '2026-10-27' },
      eventos: [
        { tipo: 'cliente', texto: 'No me llega', en: '2026-10-27', autor: 'cliente' },
        { tipo: 'respuesta', texto: 'Lo revisamos', en: '2026-10-27', autor: 'sora', interna: false },
        { tipo: 'nota', texto: 'Era el SRI', en: '2026-10-27', autor: 'sora', interna: true },
        { tipo: 'estado', texto: 'De abierto a en curso', en: '2026-10-27', autor: 'sora', interna: true },
      ],
      anteriores: 2,
    });
    expect(texto).toContain('cliente: No me llega');
    expect(texto).toContain('respuesta al cliente (sora): Lo revisamos');
    expect(texto).toContain('nota interna (sora): Era el SRI');
    expect(texto).toContain('estado (sora): De abierto a en curso');
  });

  it('la huella cambia con los datos y con el modelo', () => {
    const a = huella('c', 'd', 'm1');
    expect(huella('c', 'd', 'm1')).toBe(a);
    expect(huella('c', 'd2', 'm1')).not.toBe(a);
    expect(huella('c', 'd', 'm2')).not.toBe(a);
  });
});

describe('acotar', () => {
  it('mantiene probabilidad y días dentro de lo razonable', () => {
    const r = acotar({ probabilidad: 140, siguiente_paso: { en_dias: -3 } } as any);
    expect(r.probabilidad).toBe(100);
    expect((r.siguiente_paso as any).en_dias).toBe(0);
  });

  it('el esquema de lead acepta una respuesta bien formada', () => {
    const ok = CalificacionLead.safeParse({
      temperatura: 'caliente',
      probabilidad: 70,
      intencion: 'Quiere externalizar la contabilidad',
      producto_sugerido: 'contabilidad_mes',
      razones: ['Pidió precio'],
      faltan: [],
      preguntas: ['¿Cuántas facturas al mes?'],
      siguiente_paso: { accion: 'Llamar', canal: 'llamada', en_dias: 0, por_que: 'Está caliente', mensaje_sugerido: '' },
    });
    expect(ok.success).toBe(true);
    expect(CalificacionLead.safeParse({ temperatura: 'templado' }).success).toBe(false);
  });
});

describe('sin llave', () => {
  it('no inventa: responde que no hay IA', async () => {
    const ia = new IaSinConfigurar();
    expect(ia.disponible).toBe(false);
    await expect(ia.analizar()).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
