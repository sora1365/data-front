import { ALIAS, FILTRO_FIJO, RECURSOS } from './crm-recursos';

/**
 * Los recursos que pide el CRM.
 *
 * Son los que declara `crm/src/components/atomic-crm/root/CRM.tsx`, más los
 * dos de notas. Están escritos aquí a mano porque los dos proyectos no
 * comparten código, y es justo esa distancia la que hizo falta cubrir: cuando
 * el back llamaba `contactNotes` a lo que el CRM pide como `contact_notes`, el
 * API devolvía 404, react-admin no terminaba de arrancar y **todas** las
 * pantallas mostraban «No encontrado». Un 404 en un recurso secundario se
 * manifestó como si el tablero no existiera.
 */
const RECURSOS_DEL_CRM = [
  'deals',
  'contacts',
  'companies',
  'contact_notes',
  'deal_notes',
  'tasks',
  'sales',
  'tags',
];

describe('recursos del CRM', () => {
  it.each(RECURSOS_DEL_CRM)('el API conoce «%s»', (recurso) => {
    expect(RECURSOS[recurso]).toBeDefined();
  });

  it('no declara recursos que nadie pide', () => {
    expect(Object.keys(RECURSOS).sort()).toEqual([...RECURSOS_DEL_CRM].sort());
  });
});

describe('definición de cada recurso', () => {
  const entradas = Object.entries(RECURSOS);

  it.each(entradas)('«%s» ordena por una columna que existe', (_, def) => {
    expect(def.columnas).toContain(def.orden);
  });

  it.each(entradas)('«%s» sólo deja escribir columnas que existen', (_, def) => {
    for (const campo of def.escribibles) {
      expect(def.columnas).toContain(campo);
    }
  });

  it.each(entradas)('«%s» busca por columnas que existen', (_, def) => {
    for (const campo of def.busqueda ?? []) {
      expect(def.columnas).toContain(campo);
    }
  });

  it.each(entradas)('«%s» expone un id', (_, def) => {
    expect(def.columnas).toContain('id');
  });

  /**
   * El alias del SELECT a medida y el que usa el WHERE tienen que ser el
   * mismo. Si divergen, la consulta falla con «missing FROM-clause entry», y
   * sólo al filtrar: la lista sin filtros funcionaría y el fallo aparecería el
   * día que alguien escriba en la caja de buscar.
   */
  it.each(entradas.filter(([, def]) => def.select))(
    '«%s» usa su alias en el SELECT a medida',
    (recurso, def) => {
      const alias = ALIAS[recurso] ?? 't';
      expect(def.select).toContain(`${alias}.`);
    },
  );

  it('las dos vistas de notas salen de la misma tabla y se distinguen por filtro', () => {
    expect(RECURSOS.contact_notes.tabla).toBe(RECURSOS.deal_notes.tabla);
    expect(FILTRO_FIJO.contact_notes).toBeDefined();
    expect(FILTRO_FIJO.deal_notes).toBeDefined();
    expect(FILTRO_FIJO.contact_notes).not.toBe(FILTRO_FIJO.deal_notes);
  });

  /**
   * Las empresas son los 7,1 millones de sujetos de FRIDAY: se leen y no se
   * tocan. Si alguien les añadiera columnas escribibles, el CRM empezaría a
   * guardar nombres y RUC a mano sobre una vista materializada que se
   * reconstruye entera en cada importación.
   */
  it('las empresas son de sólo lectura', () => {
    expect(RECURSOS.companies.soloLectura).toBe(true);
    expect(RECURSOS.companies.escribibles).toHaveLength(0);
  });

  it('todas las tablas del CRM viven en su esquema', () => {
    for (const [recurso, def] of entradas) {
      if (recurso === 'companies') continue; // el perfil es del gestor comercial
      expect(def.tabla.startsWith('crm.')).toBe(true);
    }
  });
});
