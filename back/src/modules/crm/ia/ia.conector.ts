import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';

export interface PeticionIa<T extends z.ZodType> {
  consigna: string;
  datos: string;
  esquema: T;
}

export interface RespuestaIa<T> {
  resultado: T;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
}

/**
 * Lo que el CRM necesita de un modelo: un texto de entrada y una respuesta con
 * forma fija. Detrás de una interfaz, como el correo y WhatsApp, para que el
 * resto del CRM no sepa con quién habla.
 */
export abstract class IaConector {
  abstract get disponible(): boolean;
  abstract get modelo(): string;
  abstract analizar<T extends z.ZodType>(p: PeticionIa<T>): Promise<RespuestaIa<z.infer<T>>>;
}

/**
 * Sin `ANTHROPIC_API_KEY`.
 *
 * A diferencia del correo, aquí no hay modo simulado: un correo simulado se
 * registra y no sale, y nadie se engaña; un análisis inventado se leería como
 * si lo hubiera hecho la IA. Así que responde que no hay IA, con 503, y la
 * pantalla esconde los botones.
 */
export class IaSinConfigurar extends IaConector {
  get disponible() {
    return false;
  }
  get modelo() {
    return '';
  }
  async analizar(): Promise<never> {
    throw new ServiceUnavailableException(
      'La IA no está configurada en este servidor (falta ANTHROPIC_API_KEY).',
    );
  }
}

/**
 * Claude, por el SDK oficial.
 *
 * - Salida estructurada (`output_config.format`): la respuesta llega validada
 *   contra el esquema o no llega.
 * - El esfuerzo se fija explícito: el valor por defecto del modelo cambia
 *   entre versiones, y un análisis comercial no necesita el máximo.
 * - `fallbacks: "default"`: si los filtros de seguridad rechazan una petición
 *   legítima —pasa con textos que hablan de impuestos y fraude, por ejemplo—,
 *   el propio API la reintenta con el modelo que corresponde en vez de
 *   devolver un rechazo.
 */
export class IaClaude extends IaConector {
  private readonly cliente: Anthropic;
  private readonly log = new Logger('IA');

  constructor(
    clave: string,
    readonly modelo: string,
    private readonly esfuerzo: 'low' | 'medium' | 'high',
  ) {
    super();
    // Un análisis tarda segundos; si tarda dos minutos algo va mal, y quien
    // espera delante de la ficha merece un error antes que una rueda girando.
    this.cliente = new Anthropic({ apiKey: clave, timeout: 120_000, maxRetries: 2 });
  }

  get disponible() {
    return true;
  }

  async analizar<T extends z.ZodType>(p: PeticionIa<T>): Promise<RespuestaIa<z.infer<T>>> {
    const inicio = Date.now();
    let respuesta;
    try {
      respuesta = await this.cliente.beta.messages.parse({
        model: this.modelo,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: p.consigna,
        messages: [{ role: 'user', content: p.datos }],
        output_config: {
          effort: this.esfuerzo,
          format: betaZodOutputFormat(p.esquema),
        },
      });
    } catch (e) {
      throw this.traducir(e);
    }

    if (respuesta.stop_reason === 'refusal') {
      this.log.warn(`Rechazo del modelo: ${respuesta.stop_details?.category ?? 'sin categoría'}`);
      throw new UnprocessableEntityException(
        'La IA no quiso analizar este registro. Puede pasar con textos que hablan de fraude o evasión; revísalo a mano.',
      );
    }
    if (respuesta.stop_reason === 'max_tokens') {
      throw new BadGatewayException('La IA devolvió una respuesta incompleta. Vuelve a intentarlo.');
    }
    if (!respuesta.parsed_output) {
      // Pasa si el modelo se sale de una lista cerrada («templado» en vez de
      // frío, tibio o caliente): se descarta antes de guardarla.
      throw new BadGatewayException('La IA devolvió una respuesta que no encaja con lo esperado. Vuelve a intentarlo.');
    }

    return {
      resultado: respuesta.parsed_output as z.infer<T>,
      // El que respondió de verdad: con una reserva por rechazo puede no ser
      // el que se pidió, y la auditoría tiene que decir cuál fue.
      modelo: respuesta.model,
      tokensEntrada: respuesta.usage.input_tokens,
      tokensSalida: respuesta.usage.output_tokens,
      ms: Date.now() - inicio,
    };
  }

  /** Los errores del API, en lo que la pantalla puede decirle a una persona. */
  private traducir(e: unknown): HttpException {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      this.log.error(`El API rechazó la llave: ${e.message}`);
      return new ServiceUnavailableException('La llave de la IA no es válida o no tiene permiso.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      return new HttpException(
        'La IA está saturada en este momento. Prueba en un minuto.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (e instanceof Anthropic.BadRequestError) {
      this.log.error(`Petición rechazada por el API: ${e.message}`);
      return new BadGatewayException('La IA rechazó la petición. Está en el registro del servidor.');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return new ServiceUnavailableException('No se pudo conectar con la IA. Revisa la conexión del servidor.');
    }
    if (e instanceof Anthropic.APIError) {
      this.log.error(`Error del API (${e.status}): ${e.message}`);
      return new BadGatewayException('La IA falló. Vuelve a intentarlo en un momento.');
    }
    this.log.error(`Error inesperado al llamar a la IA: ${String(e)}`);
    return new BadGatewayException('La IA falló. Vuelve a intentarlo en un momento.');
  }
}
