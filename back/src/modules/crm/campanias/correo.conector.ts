import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';

export interface AdjuntoCorreo {
  nombre: string;
  /** Ruta en disco. Se lee al enviar y no antes: son los mismos para todos. */
  ruta: string;
}

export interface CorreoSaliente {
  para: string;
  asunto: string;
  cuerpo: string;
  de?: string;
  adjuntos?: AdjuntoCorreo[];
}

export interface ResultadoCorreo {
  mensajeId: string;
  simulado: boolean;
}

/**
 * Por dónde salen los correos.
 *
 * Interfaz y no una llamada directa, por lo mismo que en WhatsApp: hay que
 * poder construir y probar antes de tener cuenta en el proveedor, y sobre todo
 * **sin mandarle nada a nadie**. Una campaña mal probada contra el proveedor
 * de verdad no se puede deshacer: los correos ya salieron.
 */
export abstract class CorreoConector {
  abstract enviar(correo: CorreoSaliente): Promise<ResultadoCorreo>;
  abstract get real(): boolean;
}

/**
 * El conector que no manda nada.
 *
 * Registra a quién se habría escrito y devuelve un identificador con el
 * prefijo `simulado-` bien visible, para que nadie confunda una campaña
 * ensayada con una enviada.
 */
@Injectable()
export class CorreoConectorSimulado extends CorreoConector {
  private readonly log = new Logger('Correo (simulado)');
  private contador = 0;

  get real() {
    return false;
  }

  async enviar(correo: CorreoSaliente): Promise<ResultadoCorreo> {
    this.contador += 1;
    const conAdjuntos = correo.adjuntos?.length
      ? ` (+${correo.adjuntos.length} adjunto${correo.adjuntos.length > 1 ? 's' : ''})`
      : '';
    this.log.log(`A ${correo.para}: «${correo.asunto}»${conAdjuntos}`);
    return { mensajeId: `simulado-${Date.now()}-${this.contador}`, simulado: true };
  }
}

/**
 * El conector contra Resend.
 *
 * Se eligió por ser el más directo de arrancar: una clave y un dominio
 * verificado. La interfaz está para que cambiarlo por SendGrid o SES sea
 * escribir otra clase, no tocar las campañas.
 *
 * **El dominio tiene que estar verificado** con SPF y DKIM antes de mandar
 * nada en serio. Sin eso los correos salen pero acaban en spam, que es peor
 * que no mandarlos: gasta la lista sin que nadie los lea.
 */
@Injectable()
export class CorreoConectorResend extends CorreoConector {
  private readonly log = new Logger('Correo');

  constructor(
    private readonly clave: string,
    private readonly remitentePorDefecto: string,
  ) {
    super();
  }

  get real() {
    return true;
  }

  async enviar(correo: CorreoSaliente): Promise<ResultadoCorreo> {
    const respuesta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.clave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: correo.de ?? this.remitentePorDefecto,
        to: [correo.para],
        subject: correo.asunto,
        html: correo.cuerpo,
        // Los adjuntos van en base64 y son los mismos para toda la campaña, así
        // que se leen una vez y se reparten: leerlos por destinatario sería
        // abrir el mismo archivo cuarenta mil veces.
        ...(correo.adjuntos?.length
          ? {
              attachments: correo.adjuntos.map((a) => ({
                filename: a.nombre,
                content: readFileSync(a.ruta).toString('base64'),
              })),
            }
          : {}),
      }),
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      const detalle = datos?.message ?? `${respuesta.status} ${respuesta.statusText}`;
      this.log.error(`No se pudo enviar a ${correo.para}: ${detalle}`);
      throw new Error(detalle);
    }

    if (!datos?.id) throw new Error('El proveedor aceptó el envío pero no devolvió identificador');

    return { mensajeId: datos.id, simulado: false };
  }
}
