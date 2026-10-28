import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { fechasDePasos } from '../seguimiento/seguimiento.reglas';
import { TicketsService } from '../tickets/tickets.service';
import { IaConector } from './ia.conector';
import {
  contextoLead,
  contextoOportunidad,
  contextoTicket,
  Empresa,
  envolver,
  huella,
} from './ia.contexto';
import {
  acotar,
  AnalisisOportunidad,
  AnalisisTicket,
  CalificacionLead,
  CONSIGNA_LEAD,
  CONSIGNA_OPORTUNIDAD,
  CONSIGNA_TICKET,
} from './ia.esquemas';

export type Entidad = 'oportunidad' | 'lead' | 'ticket';
export const ENTIDADES: Entidad[] = ['oportunidad', 'lead', 'ticket'];
export type Aplicacion = 'tarea' | 'temperatura' | 'borrador' | 'descartado';

const PLANES: Record<Entidad, { consigna: string; esquema: z.ZodType }> = {
  oportunidad: { consigna: CONSIGNA_OPORTUNIDAD, esquema: AnalisisOportunidad },
  lead: { consigna: CONSIGNA_LEAD, esquema: CalificacionLead },
  ticket: { consigna: CONSIGNA_TICKET, esquema: AnalisisTicket },
};

/** El día de hoy en Ecuador, que es contra lo que cuentan los plazos. */
const hoyEnEcuador = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(
    new Date(),
  );

@Injectable()
export class IaService {
  private readonly log = new Logger('IA');

  constructor(
    private readonly dataSource: DataSource,
    private readonly ia: IaConector,
    private readonly tickets: TicketsService,
  ) {}

  estado() {
    return { disponible: this.ia.disponible, modelo: this.ia.modelo || null };
  }

  /** El último análisis de una ficha, sin llamar a nadie. */
  async ultimo(entidad: Entidad, id: number) {
    this.validar(entidad);
    const [fila] = await this.dataSource.query(
      `SELECT * FROM crm.ia_analisis WHERE entidad = $1 AND entidad_id = $2
        ORDER BY creado_en DESC LIMIT 1`,
      [entidad, id],
    );
    return fila ?? null;
  }

  /**
   * Analizar una ficha.
   *
   * Si lo que se le mandaría es igual que la última vez, devuelve aquel
   * análisis en lugar de pagar otro: abrir la misma ficha diez veces no son
   * diez análisis. `forzar` lo salta, para cuando alguien quiere otra opinión
   * sobre los mismos datos.
   */
  async analizar(
    entidad: Entidad,
    id: number,
    usuario: string,
    forzar = false,
  ) {
    this.validar(entidad);
    if (!this.ia.disponible) {
      throw new ServiceUnavailableException(
        'La IA no está configurada en este servidor (falta ANTHROPIC_API_KEY).',
      );
    }
    const plan = PLANES[entidad];
    const hoy = hoyEnEcuador();
    const datos = envolver(hoy, await this.contexto(entidad, id));
    const firma = huella(plan.consigna, datos, this.ia.modelo);

    if (!forzar) {
      const previo = await this.ultimo(entidad, id);
      // La fecha va dentro de los datos, así que un análisis de ayer nunca
      // coincide: «lleva tres días sin contacto» tiene que recalcularse.
      if (previo?.entrada_hash === firma)
        return { ...previo, reutilizado: true };
    }

    const r = await this.ia.analizar({
      consigna: plan.consigna,
      datos,
      esquema: plan.esquema,
    });
    const resultado = acotar(r.resultado as any);
    const [fila] = await this.dataSource.query(
      `INSERT INTO crm.ia_analisis
         (entidad, entidad_id, resultado, entrada_hash, modelo, tokens_entrada, tokens_salida, ms, pedido_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        entidad,
        id,
        JSON.stringify(resultado),
        firma,
        r.modelo,
        r.tokensEntrada,
        r.tokensSalida,
        r.ms,
        usuario,
      ],
    );
    this.log.log(
      `${entidad} ${id}: ${r.tokensEntrada}+${r.tokensSalida} tokens en ${r.ms} ms (${r.modelo}), pedido por ${usuario}`,
    );
    return { ...fila, reutilizado: false };
  }

  /**
   * Lo que una persona decide hacer con una propuesta.
   *
   * - `tarea`: crea la tarea del siguiente paso, del comercial que lleva la
   *   venta, con la fecha movida al lunes si cae en fin de semana —la misma
   *   regla que las secuencias—.
   * - `temperatura`: pone al lead la temperatura que propuso la IA.
   * - `borrador` / `descartado`: sólo se anota, para saber qué se usa.
   *
   * Una propuesta se aplica una vez. Dos clics seguidos no crean dos tareas.
   */
  async aplicar(analisisId: number, accion: Aplicacion, usuario: string) {
    return this.dataSource.transaction(async (m) => {
      // Bloqueada mientras se aplica: el segundo clic espera y encuentra la
      // propuesta ya usada.
      const [a] = await m.query(
        `SELECT * FROM crm.ia_analisis WHERE id = $1 FOR UPDATE`,
        [analisisId],
      );
      if (!a)
        throw new NotFoundException(`No existe el análisis ${analisisId}`);
      if (a.aplicado) {
        throw new ConflictException(
          `Esta propuesta ya se usó (${a.aplicado}, por ${a.aplicado_por}).`,
        );
      }
      const r = a.resultado;
      let creado: Record<string, unknown> = {};

      if (accion === 'tarea') {
        if (a.entidad === 'ticket')
          throw new BadRequestException(
            'Los tickets se siguen desde su ficha, no con tareas.',
          );
        const paso = r.siguiente_paso;
        if (!paso?.accion)
          throw new BadRequestException(
            'Este análisis no trae un siguiente paso.',
          );
        const destino = await this.destinoDeTarea(
          a.entidad,
          Number(a.entidad_id),
          usuario,
        );
        const [{ vence }] = fechasDePasos(
          [
            {
              orden: 1,
              dia: paso.en_dias ?? 0,
              canal: paso.canal,
              texto: paso.accion,
            },
          ],
          hoyEnEcuador(),
        );
        const texto = paso.mensaje_sugerido
          ? `${paso.accion}\n\n${paso.mensaje_sugerido}`
          : paso.accion;
        const [t] = await m.query(
          `INSERT INTO crm.tarea (deal_id, contact_id, text, type, due_date, sales_id)
         VALUES ($1,$2,$3,$4,$5::date,$6) RETURNING id`,
          [
            destino.deal_id,
            destino.contact_id,
            texto,
            paso.canal,
            vence,
            destino.sales_id,
          ],
        );
        creado = { tarea: Number(t.id), vence };
      } else if (accion === 'temperatura') {
        if (a.entidad !== 'lead')
          throw new BadRequestException('La temperatura es de los leads.');
        await m.query(
          `UPDATE crm.lead SET temperatura = $2, actualizado_en = now() WHERE id = $1`,
          [a.entidad_id, r.temperatura],
        );
        creado = { temperatura: r.temperatura };
      } else if (accion !== 'borrador' && accion !== 'descartado') {
        throw new BadRequestException(
          'Acción no válida. Usa: tarea, temperatura, borrador o descartado.',
        );
      }

      await m.query(
        `UPDATE crm.ia_analisis SET aplicado = $2, aplicado_por = $3, aplicado_en = now() WHERE id = $1`,
        [analisisId, accion, usuario],
      );
      return { ...creado, aplicado: accion };
    });
  }

  /**
   * Cuánto se ha usado la IA y en qué, para que el costo no sea una sorpresa
   * a fin de mes. Los tokens se enseñan tal cual: el precio por token cambia y
   * multiplicarlo aquí sería escribir una tarifa que mañana está vieja.
   */
  async uso(dias = 30) {
    const filas = await this.dataSource.query(
      `SELECT entidad, count(*)::int AS analisis,
              sum(tokens_entrada)::int AS tokens_entrada, sum(tokens_salida)::int AS tokens_salida,
              count(*) FILTER (WHERE aplicado IS NOT NULL AND aplicado <> 'descartado')::int AS usados
         FROM crm.ia_analisis
        WHERE creado_en >= now() - make_interval(days => $1)
        GROUP BY entidad`,
      [dias],
    );
    return { dias, ...this.estado(), porEntidad: filas };
  }

  // ------------------------------------------------------------- contexto

  private async contexto(entidad: Entidad, id: number): Promise<string> {
    if (entidad === 'ticket') {
      const t = await this.tickets.obtener(id);
      return contextoTicket({
        ticket: t,
        eventos: t.eventos,
        anteriores: t.anteriores.length,
      });
    }
    if (entidad === 'lead') return this.contextoDeLead(id);
    return this.contextoDeOportunidad(id);
  }

  private async contextoDeOportunidad(id: number) {
    const [o] = await this.dataSource.query(
      `SELECT o.*, p.nombre AS producto_nombre, e.nombre AS etapa_nombre,
              (SELECT max(ocurrido_en) FROM crm.oportunidad_etapa h WHERE h.oportunidad = o.id) AS ultima_etapa_en
         FROM crm.oportunidad o
         LEFT JOIN producto p ON p.codigo = o.producto
         LEFT JOIN crm.etapa e ON e.codigo = o.etapa
        WHERE o.id = $1`,
      [id],
    );
    if (!o) throw new NotFoundException(`No existe la oportunidad ${id}`);
    const [empresa, contactos, interacciones, notas, tareas, proformas] =
      await Promise.all([
        this.empresa(o.company_id),
        this.dataSource.query(
          `SELECT first_name, last_name, title FROM crm.contacto
          WHERE id = ANY($1::bigint[]) OR ($2::bigint IS NOT NULL AND company_id = $2)
          ORDER BY principal DESC, id LIMIT 15`,
          [o.contact_ids ?? [], o.company_id ?? null],
        ),
        this.dataSource.query(
          `SELECT canal, direccion, resultado, texto, ocurrido_en, autor FROM crm.interaccion
          WHERE oportunidad = $1 ORDER BY ocurrido_en`,
          [id],
        ),
        this.dataSource.query(
          `SELECT text, date, sales_id FROM crm.nota WHERE deal_id = $1 ORDER BY date`,
          [id],
        ),
        this.dataSource.query(
          `SELECT text, type, due_date, done_date FROM crm.tarea WHERE deal_id = $1 ORDER BY due_date LIMIT 30`,
          [id],
        ),
        this.dataSource.query(
          `SELECT id, numero, estado, total, valida_hasta, motivo FROM crm.proforma
          WHERE oportunidad = $1 ORDER BY creada_en`,
          [id],
        ),
      ]);
    return contextoOportunidad({
      oportunidad: o,
      empresa,
      contactos,
      interacciones,
      notas,
      tareas,
      proformas,
    });
  }

  private async contextoDeLead(id: number) {
    const [l] = await this.dataSource.query(
      `SELECT * FROM crm.lead WHERE id = $1`,
      [id],
    );
    if (!l) throw new NotFoundException(`No existe el lead ${id}`);
    let empresa: Empresa | null = l.empresa_id
      ? await this.empresa(l.empresa_id)
      : null;
    // Un lead sin empresa del CRM pero con un sujeto del padrón enlazado
    // también trae lo que FRIDAY sabe de él: es justo cuando más ayuda.
    if (!empresa && l.tipo_sujeto && l.clave) {
      const perfil = await this.perfil(l.tipo_sujeto, l.clave);
      empresa = perfil ? { perfil } : null;
    }
    const [interacciones, catalogo] = await Promise.all([
      this.dataSource.query(
        `SELECT canal, direccion, resultado, texto, ocurrido_en, autor FROM crm.interaccion
          WHERE lead = $1 ORDER BY ocurrido_en`,
        [id],
      ),
      this.dataSource.query(
        `SELECT codigo, nombre, descripcion FROM producto WHERE activo ORDER BY nombre`,
      ),
    ]);
    return contextoLead({ lead: l, empresa, interacciones, catalogo });
  }

  private async empresa(id: number | null): Promise<Empresa | null> {
    if (!id) return null;
    const [e] = await this.dataSource.query(
      `SELECT name, tax_identifier, sector, city, tipo_sujeto, clave FROM crm.empresa WHERE id = $1`,
      [id],
    );
    if (!e) return null;
    return {
      ...e,
      perfil:
        e.tipo_sujeto && e.clave
          ? await this.perfil(e.tipo_sujeto, e.clave)
          : null,
    };
  }

  private async perfil(tipo: string, clave: string) {
    const [p] = await this.dataSource.query(
      `SELECT * FROM perfil_comercial WHERE tipo_sujeto = $1 AND clave = $2`,
      [tipo, clave],
    );
    if (!p) return null;
    // Lo de contacto del padrón tampoco viaja.
    const { telefono, correo, representante, ...resto } = p;
    return resto;
  }

  private async destinoDeTarea(entidad: string, id: number, usuario: string) {
    if (entidad === 'oportunidad') {
      const [o] = await this.dataSource.query(
        `SELECT comercial FROM crm.oportunidad WHERE id = $1`,
        [id],
      );
      if (!o) throw new NotFoundException(`No existe la oportunidad ${id}`);
      return {
        deal_id: id,
        contact_id: null,
        sales_id: o.comercial ?? usuario,
      };
    }
    const [l] = await this.dataSource.query(
      `SELECT oportunidad_id, contacto_id, asignado_a FROM crm.lead WHERE id = $1`,
      [id],
    );
    if (!l) throw new NotFoundException(`No existe el lead ${id}`);
    // Una tarea cuelga de una venta o de un contacto. Un lead que todavía no
    // es ninguna de las dos cosas se sigue desde la bandeja de leads.
    if (!l.oportunidad_id && !l.contacto_id) {
      throw new BadRequestException(
        'Este lead todavía no tiene contacto ni oportunidad. Conviértelo o atiéndelo desde la bandeja de leads.',
      );
    }
    return {
      deal_id: l.oportunidad_id,
      contact_id: l.contacto_id,
      sales_id: l.asignado_a ?? usuario,
    };
  }

  private validar(entidad: string): asserts entidad is Entidad {
    if (!ENTIDADES.includes(entidad as Entidad)) {
      throw new BadRequestException(
        `Se puede analizar: ${ENTIDADES.join(', ')}.`,
      );
    }
  }
}
