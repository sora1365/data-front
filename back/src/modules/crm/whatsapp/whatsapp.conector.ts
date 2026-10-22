import { Injectable, Logger } from '@nestjs/common';

export interface MensajeSaliente {
  /** Número del destinatario, ya normalizado. */
  para: string;
  /** El número desde el que se escribe, tal como lo identifica Meta. */
  phoneNumberId: string;
  texto?: string;
  plantilla?: { nombre: string; idioma: string; variables: string[] };
}

export interface ResultadoEnvio {
  /** El identificador que asigna Meta, o uno simulado. */
  waId: string;
  /** `true` cuando lo mandó el conector simulado y no salió de aquí. */
  simulado: boolean;
}

/**
 * Por dónde salen los mensajes.
 *
 * Es una interfaz y no una llamada directa a Meta porque hay dos cosas que no
 * se pueden hacer contra su API: desarrollar antes de que terminen la
 * verificación del negocio —que tarda días— y probar sin gastar dinero, porque
 * cada conversación se cobra.
 *
 * El resto del CRM no sabe cuál está enchufado: guarda el mensaje, pide
 * enviarlo y recibe un identificador. La diferencia entre simular y enviar de
 * verdad es qué implementación está registrada, y eso se decide en un solo
 * sitio (`whatsapp.module.ts`) según haya credenciales o no.
 */
export abstract class WhatsappConector {
  abstract enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvio>;
  /** Si este conector habla con Meta de verdad. */
  abstract get real(): boolean;
}

/**
 * El conector que no envía nada.
 *
 * Registra lo que se habría mandado y devuelve un identificador inventado, con
 * el prefijo `simulado-` bien visible: un id que parezca de Meta llevaría a
 * creer que un mensaje salió cuando no salió de esta máquina.
 */
@Injectable()
export class WhatsappConectorSimulado extends WhatsappConector {
  private readonly log = new Logger('WhatsApp (simulado)');
  private contador = 0;

  get real() {
    return false;
  }

  async enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    this.contador += 1;
    const detalle = mensaje.plantilla
      ? `plantilla «${mensaje.plantilla.nombre}»`
      : `«${(mensaje.texto ?? '').slice(0, 60)}»`;
    this.log.log(`A ${mensaje.para}: ${detalle}`);
    return { waId: `simulado-${Date.now()}-${this.contador}`, simulado: true };
  }
}

/**
 * El conector contra la Cloud API de Meta.
 *
 * Necesita, por cada número: su `phone_number_id` y un token permanente de
 * usuario de sistema con `whatsapp_business_messaging`. El token del panel de
 * desarrollador caduca en horas y sirve sólo para la primera prueba.
 */
@Injectable()
export class WhatsappConectorMeta extends WhatsappConector {
  private readonly log = new Logger('WhatsApp');
  private readonly version = process.env.WHATSAPP_API_VERSION ?? 'v21.0';

  constructor(private readonly token: string) {
    super();
  }

  get real() {
    return true;
  }

  async enviar(mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    const cuerpo: Record<string, any> = {
      messaging_product: 'whatsapp',
      to: mensaje.para,
    };

    if (mensaje.plantilla) {
      cuerpo.type = 'template';
      cuerpo.template = {
        name: mensaje.plantilla.nombre,
        language: { code: mensaje.plantilla.idioma },
        // Meta espera los valores por posición, en el orden de `{{1}}`,
        // `{{2}}`… y rechaza el envío entero si falta uno.
        components: mensaje.plantilla.variables.length
          ? [
              {
                type: 'body',
                parameters: mensaje.plantilla.variables.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      };
    } else {
      cuerpo.type = 'text';
      // Sin esto, Meta no genera la vista previa de los enlaces y un mensaje
      // con una propuesta se ve como una URL cruda.
      cuerpo.text = { preview_url: true, body: mensaje.texto ?? '' };
    }

    const respuesta = await fetch(
      `https://graph.facebook.com/${this.version}/${mensaje.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpo),
      },
    );

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      // El error de Meta explica qué pasó («fuera de la ventana», «plantilla no
      // aprobada»); el código HTTP solo no sirve para avisar a nadie.
      const detalle = datos?.error?.message ?? `${respuesta.status} ${respuesta.statusText}`;
      this.log.error(`No se pudo enviar a ${mensaje.para}: ${detalle}`);
      throw new Error(detalle);
    }

    const waId = datos?.messages?.[0]?.id;
    if (!waId) throw new Error('Meta aceptó el envío pero no devolvió identificador');

    return { waId, simulado: false };
  }
}
