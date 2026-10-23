import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SegmentosService } from '../../segmentos/segmentos.service';
import { diaLocal } from '../agenda/agenda.reglas';
import { CrmService } from '../crm.service';
import {
  estadoParaElGestor,
  listaDeHoy,
  siguienteIntento,
  type Resultado,
} from './listas.reglas';

export interface Gestion {
  tipoSujeto: string;
  clave: string;
  resultado: Resultado;
  segmento?: string | null;
  producto?: string | null;
  canal?: string | null;
  nota?: string | null;
}

@Injectable()
export class ListasService {
  private readonly logger = new Logger('Listas');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly segmentos: SegmentosService,
    private readonly crm: CrmService,
  ) {}

  /**
   * La lista de trabajo de un segmento.
   *
   * Los miembros los da el gestor comercial —es su segmento y su consulta— y
   * el CRM les añade lo que sabe: si ya se llamó, cuándo toca volver y si ya
   * hay una oportunidad abierta. Reutilizar su servicio y no copiar la
   * consulta es lo que evita que el día que cambien las condiciones de un
   * segmento, la lista de trabajo siga sacando a los de antes.
   */
  async deSegmento(
    segmento: string,
    opciones: { producto?: string; limite?: number; soloConContacto?: boolean } = {},
  ) {
    const limite = Math.min(opciones.limite ?? 50, 200);

    // Se piden más de los que se van a enseñar porque la mayoría se cae en el
    // filtro de «hoy no toca»: pedir justo 50 devolvería una lista de 6 el
    // segundo día de trabajar un segmento.
    const miembros = await this.segmentos.miembros(segmento, {
      limit: limite * 6,
      offset: 0,
      incluirGestionados: true,
    });

    const filas: any[] = Array.isArray(miembros) ? miembros : (miembros as any)?.datos ?? [];
    if (filas.length === 0) return { segmento, producto: opciones.producto ?? null, miembros: [] };

    const claves = filas.map((f) => `${f.tipo_sujeto}:${f.clave}`);

    const [gestiones, oportunidades] = await Promise.all([
      this.dataSource.query(
        `SELECT tipo_sujeto, clave, ultimo_resultado, intentos, ultima_en,
                to_char(reintentar_en, 'YYYY-MM-DD') AS reintentar_en
           FROM crm.gestion_estado
          WHERE tipo_sujeto || ':' || clave = ANY($1)`,
        [claves],
      ),
      this.dataSource.query(
        `SELECT emp.tipo_sujeto, emp.clave, o.id, o.name, e.es_ganada, e.es_perdida
           FROM crm.oportunidad o
           JOIN crm.empresa emp ON emp.id = o.company_id
           JOIN crm.etapa e ON e.codigo = o.etapa
          WHERE o.archivada_en IS NULL
            AND emp.tipo_sujeto || ':' || emp.clave = ANY($1)`,
        [claves],
      ),
    ]);

    const porClave = (lista: any[]) =>
      new Map(lista.map((x) => [`${x.tipo_sujeto}:${x.clave}`, x]));
    const gestionDe = porClave(gestiones);
    const abiertas = new Map<string, any>();
    for (const o of oportunidades) {
      if (o.es_ganada || o.es_perdida) continue;
      abiertas.set(`${o.tipo_sujeto}:${o.clave}`, o);
    }

    const enriquecidos = filas.map((f) => {
      const llave = `${f.tipo_sujeto}:${f.clave}`;
      const gestion = gestionDe.get(llave);
      const abierta = abiertas.get(llave);
      return {
        tipo_sujeto: f.tipo_sujeto,
        clave: f.clave,
        nombre: f.nombre,
        ruc: f.ruc,
        provincia: f.provincia,
        canton: f.canton,
        actividad: f.actividad,
        telefono: f.telefono,
        correo: f.correo,
        sitio_web: f.sitio_web,
        ingresos_ult: f.ingresos_ult,
        estado_comercial: f.estado_comercial,
        ultimo_resultado: gestion?.ultimo_resultado ?? null,
        ultima_en: gestion?.ultima_en ?? null,
        intentos: gestion?.intentos ?? 0,
        reintentar_en: gestion?.reintentar_en ?? null,
        oportunidad_abierta: Boolean(abierta),
        oportunidad: abierta?.id ?? null,
      };
    });

    return {
      segmento,
      producto: opciones.producto ?? null,
      total: filas.length,
      miembros: listaDeHoy(enriquecidos, diaLocal(), {
        soloConContacto: opciones.soloConContacto,
      }).slice(0, limite),
    };
  }

  /**
   * Anota lo que pasó con un sujeto y decide cuándo vuelve.
   *
   * Lo que se devuelve al gestor es sólo el estado comercial, y sólo cuando
   * cambia algo de verdad: haber llamado sin respuesta no cambia lo que ese
   * sujeto es. La devolución va por `marcarEstado`, el mismo método que usa el
   * resto del CRM, porque el estado comercial de un sujeto es uno solo.
   */
  async anotar(gestion: Gestion, usuario: string) {
    const hoy = diaLocal();

    const previa = (
      await this.dataSource.query(
        `SELECT ultimo_resultado, intentos FROM crm.gestion_estado
          WHERE tipo_sujeto = $1 AND clave = $2`,
        [gestion.tipoSujeto, gestion.clave],
      )
    )[0];

    // Los intentos seguidos sólo cuentan mientras sea el mismo «no contesta»:
    // si la última vez sí se habló, la cuenta vuelve a empezar.
    const seguidos =
      gestion.resultado === 'no_contesta' && previa?.ultimo_resultado === 'no_contesta'
        ? Number(previa.intentos ?? 1) + 1
        : 1;

    const vuelve = siguienteIntento(gestion.resultado, hoy, seguidos);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO crm.gestion
           (tipo_sujeto, clave, segmento, producto, resultado, canal, nota, reintentar_en, autor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9)`,
        [
          gestion.tipoSujeto,
          gestion.clave,
          gestion.segmento ?? null,
          gestion.producto ?? null,
          gestion.resultado,
          gestion.canal ?? null,
          gestion.nota ?? null,
          vuelve,
          usuario,
        ],
      );

      await manager.query(
        `INSERT INTO crm.gestion_estado
           (tipo_sujeto, clave, ultima_en, ultimo_resultado, reintentar_en, intentos)
         VALUES ($1,$2, now(), $3, $4::date, $5)
         ON CONFLICT (tipo_sujeto, clave) DO UPDATE SET
           ultima_en = now(), ultimo_resultado = EXCLUDED.ultimo_resultado,
           reintentar_en = EXCLUDED.reintentar_en, intentos = EXCLUDED.intentos`,
        [gestion.tipoSujeto, gestion.clave, gestion.resultado, vuelve, seguidos],
      );
    });

    const estado = estadoParaElGestor(gestion.resultado);
    if (estado) {
      try {
        await this.segmentos.marcarEstado(
          gestion.tipoSujeto,
          gestion.clave,
          estado,
          gestion.nota ?? `Desde la lista de trabajo (${gestion.resultado})`,
        );
      } catch (e) {
        // La gestión ya está guardada y es lo que no se puede perder. Que el
        // gestor no acepte el estado no puede tirar la anotación de quien
        // acaba de colgar el teléfono.
        this.logger.error(
          `No se pudo devolver el estado «${estado}» de ${gestion.tipoSujeto}:${gestion.clave}`,
          e as Error,
        );
      }
    }

    return { reintentar_en: vuelve, intentos: seguidos, estado_devuelto: estado };
  }

  /**
   * Abre la oportunidad desde la lista y anota la gestión de una vez.
   *
   * Son dos cosas que siempre pasan juntas: nadie abre una oportunidad desde
   * una lista de trabajo sin haber hablado con alguien. Dejarlas separadas
   * obliga a hacer dos clics para una sola cosa, y el segundo se olvida.
   */
  async abrirDesdeLista(
    datos: {
      tipoSujeto: string;
      clave: string;
      producto: string;
      marca: string;
      segmento?: string;
      monto?: number;
      nota?: string;
    },
    usuario: string,
  ) {
    if (!datos?.producto) throw new BadRequestException('Falta el producto que se le ofrece.');
    if (!datos?.marca) throw new BadRequestException('Falta la marca con la que se vende.');

    const oportunidad = await this.crm.abrir(
      {
        tipoSujeto: datos.tipoSujeto,
        clave: datos.clave,
        producto: datos.producto,
        marca: datos.marca,
        monto: datos.monto,
        origenSegmento: datos.segmento,
      } as any,
      usuario,
    );

    await this.anotar(
      {
        tipoSujeto: datos.tipoSujeto,
        clave: datos.clave,
        resultado: 'oportunidad',
        segmento: datos.segmento,
        producto: datos.producto,
        nota: datos.nota,
      },
      usuario,
    );

    await this.dataSource.query(
      `UPDATE crm.gestion SET oportunidad = $1
        WHERE id = (SELECT max(id) FROM crm.gestion WHERE tipo_sujeto = $2 AND clave = $3)`,
      [oportunidad.id, datos.tipoSujeto, datos.clave],
    );

    return oportunidad;
  }

  /** Lo que se intentó con un sujeto, de lo último a lo primero. */
  historial(tipoSujeto: string, clave: string) {
    return this.dataSource.query(
      `SELECT g.id, g.resultado, g.canal, g.nota, g.ocurrido_en, g.autor,
              to_char(g.reintentar_en, 'YYYY-MM-DD') AS reintentar_en,
              g.segmento, g.producto, g.oportunidad, s.nombre AS segmento_nombre
         FROM crm.gestion g
         LEFT JOIN segmento s ON s.codigo = g.segmento
        WHERE g.tipo_sujeto = $1 AND g.clave = $2
        ORDER BY g.ocurrido_en DESC`,
      [tipoSujeto, clave],
    );
  }

  /**
   * Cómo va el trabajo de cada segmento.
   *
   * Contesta la pregunta que justifica tener listas: de lo que se llamó de
   * este segmento, cuánto acabó en oportunidad. Es el embudo de antes del
   * embudo.
   */
  rendimiento(desde?: string) {
    const params: any[] = [];
    let filtro = '';
    if (desde) {
      params.push(desde);
      filtro = `WHERE g.ocurrido_en >= $1`;
    }

    return this.dataSource.query(
      `SELECT g.segmento, s.nombre AS segmento_nombre,
              count(*)::int AS gestiones,
              count(DISTINCT g.tipo_sujeto || ':' || g.clave)::int AS sujetos,
              count(*) FILTER (WHERE g.resultado = 'oportunidad')::int AS oportunidades,
              count(*) FILTER (WHERE g.resultado = 'no_interesa')::int AS no_interesa,
              count(*) FILTER (WHERE g.resultado = 'no_contesta')::int AS no_contesta,
              count(*) FILTER (WHERE g.resultado = 'no_contactar')::int AS no_contactar
         FROM crm.gestion g
         LEFT JOIN segmento s ON s.codigo = g.segmento
         ${filtro}
        GROUP BY g.segmento, s.nombre
        ORDER BY gestiones DESC`,
      params,
    );
  }
}
