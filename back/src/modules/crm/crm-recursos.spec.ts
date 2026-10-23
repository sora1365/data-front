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
  // No es un recurso de Atomic: es la ventana al padrón de FRIDAY desde la que
  // se crea una empresa sin teclear sus datos.
  'padron',
  'productos',
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
   * El padrón es del gestor comercial y se lee desde el CRM, nunca al revés.
   * Si alguien le añadiera columnas escribibles, el CRM empezaría a corregir a
   * mano una vista materializada que se reconstruye entera en cada
   * importación, y el cambio duraría hasta la siguiente carga.
   */
  it('el padrón es de sólo lectura', () => {
    expect(RECURSOS.padron.soloLectura).toBe(true);
    expect(RECURSOS.padron.escribibles).toHaveLength(0);
  });

  /**
   * Las empresas, en cambio, sí se editan: son del CRM. Dejaron de ser el
   * padrón para que quepan los clientes que no están en él —extranjeros,
   * recién creados, una cartera subida desde un Excel— y para que el CRM
   * sirva a una empresa que no sea de Ecuador.
   */
  it('las empresas se pueden crear y editar', () => {
    expect(RECURSOS.companies.soloLectura).toBeFalsy();
    expect(RECURSOS.companies.escribibles).toContain('name');
    // El enlace con el padrón es opcional, pero tiene que poder escribirse:
    // es lo que convierte un sujeto en ficha del CRM.
    expect(RECURSOS.companies.escribibles).toContain('tipo_sujeto');
    expect(RECURSOS.companies.escribibles).toContain('clave');
  });

  /**
   * Lo que es del CRM vive en su esquema; lo que se lee del gestor comercial,
   * no. Esa lista de excepciones es la frontera entre los dos módulos: si
   * crece, es que el CRM está leyendo cosas del otro lado que quizá debería
   * pedirle por su API en vez de consultar directamente.
   */
  const DEL_GESTOR_COMERCIAL = ['padron', 'productos'];

  it('todas las tablas propias del CRM viven en su esquema', () => {
    for (const [recurso, def] of entradas) {
      if (DEL_GESTOR_COMERCIAL.includes(recurso)) continue;
      expect(def.tabla.startsWith('crm.')).toBe(true);
    }
  });

  it('lo que se lee del gestor comercial es de sólo lectura', () => {
    for (const recurso of DEL_GESTOR_COMERCIAL) {
      expect(RECURSOS[recurso].soloLectura).toBe(true);
    }
  });
});
