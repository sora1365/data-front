import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Usuario } from '../../../common/http/usuario.decorator';
import { WhatsappService } from './whatsapp.service';

@Controller('crm/whatsapp')
export class WhatsappController {
  private readonly log = new Logger('WhatsApp');

  constructor(private readonly whatsapp: WhatsappService) {}

  @Get('estado')
  estado() {
    return { conectado: this.whatsapp.conectado };
  }

  @Get('bandeja')
  bandeja(
    @Query('estado') estado?: string,
    @Query('asignada') asignada?: string,
    @Query('canal') canal?: string,
  ) {
    return this.whatsapp.bandeja({
      estado,
      asignada,
      canal: canal ? Number(canal) : undefined,
    });
  }

  @Get('plantillas')
  plantillas() {
    return this.whatsapp.plantillas();
  }

  @Get('conversaciones/:id')
  conversacion(@Param('id', ParseIntPipe) id: number) {
    return this.whatsapp.conversacion(id);
  }

  @Post('conversaciones/:id/mensajes')
  enviar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { texto?: string; plantilla?: string; variables?: string[] },
    @Usuario() usuario: string,
  ) {
    return this.whatsapp.enviar(id, body ?? {}, usuario);
  }

  @Post('conversaciones/:id/leida')
  @HttpCode(200)
  async leida(@Param('id', ParseIntPipe) id: number) {
    await this.whatsapp.marcarLeida(id);
    return { ok: true };
  }

  @Post('conversaciones/:id/asignar')
  @HttpCode(200)
  asignar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { comercial?: string | null },
  ) {
    return this.whatsapp.asignar(id, body?.comercial ?? null);
  }

  // ------------------------------------------------------------------ webhook

  /**
   * La comprobación que hace Meta al registrar el webhook.
   *
   * Llama una vez con un `hub.challenge` y espera recibirlo de vuelta **en
   * crudo**, no envuelto en JSON. Si se devuelve `{"challenge": "..."}` la
   * suscripción no se activa y no hay mensaje de error que lo explique: Meta
   * sólo dice que no pudo verificar.
   */
  @Get('webhook')
  verificar(
    @Query('hub.mode') modo: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!esperado) {
      throw new BadRequestException('Falta WHATSAPP_VERIFY_TOKEN en el servidor.');
    }
    if (modo !== 'subscribe' || token !== esperado) {
      this.log.warn('Intento de verificación del webhook con un token que no coincide.');
      throw new ForbiddenException();
    }
    return challenge;
  }

  /**
   * Lo que Meta envía: mensajes entrantes y acuses de recibo.
   *
   * **Siempre responde 200**, incluso si algo falla por dentro. Meta reintenta
   * lo que no reciba un 200 y, tras varios fallos seguidos, deshabilita la
   * suscripción entera: un mensaje mal formado dejaría al CRM sin recibir nada
   * de nadie. Lo que no se pueda procesar se registra y se sigue.
   */
  @Post('webhook')
  @HttpCode(200)
  async recibir(@Body() cuerpo: any) {
    try {
      for (const entrada of cuerpo?.entry ?? []) {
        for (const cambio of entrada?.changes ?? []) {
          const valor = cambio?.value;
          const phoneNumberId = valor?.metadata?.phone_number_id;
          if (!phoneNumberId) continue;

          for (const mensaje of valor?.messages ?? []) {
            const perfil = valor?.contacts?.find((c: any) => c?.wa_id === mensaje.from);
            await this.whatsapp.recibir({
              phoneNumberId,
              telefono: mensaje.from,
              nombrePerfil: perfil?.profile?.name,
              waId: mensaje.id,
              tipo: mensaje.type,
              texto: mensaje.text?.body ?? mensaje[mensaje.type]?.caption,
              media: mensaje.type !== 'text' ? mensaje[mensaje.type] : undefined,
              // Meta manda la hora en segundos, no en milisegundos. Sin
              // multiplicar, todos los mensajes quedan fechados en 1970 y la
              // ventana de 24 horas sale siempre cerrada.
              ocurridoEn: mensaje.timestamp
                ? new Date(Number(mensaje.timestamp) * 1000)
                : undefined,
            });
          }

          for (const estado of valor?.statuses ?? []) {
            await this.whatsapp.actualizarEstado(
              estado.id,
              this.traducirEstado(estado.status),
              estado.errors?.[0]?.title,
            );
          }
        }
      }
    } catch (e: any) {
      this.log.error(`No se pudo procesar un webhook: ${e?.message ?? e}`);
    }

    return { received: true };
  }

  /** Los estados de Meta vienen en inglés; la tabla los guarda en español. */
  private traducirEstado(estado: string): string {
    return (
      {
        sent: 'enviado',
        delivered: 'entregado',
        read: 'leido',
        failed: 'fallido',
      }[estado] ?? estado
    );
  }
}

/**
 * Comprueba que el webhook viene de Meta.
 *
 * Meta firma cada cuerpo con el App Secret en la cabecera
 * `X-Hub-Signature-256`. Sin comprobarla, cualquiera que descubra la URL puede
 * inventar conversaciones en el CRM, y la URL es pública por definición.
 *
 * Se compara con `timingSafeEqual` y no con `===` porque comparar cadenas
 * secretas carácter a carácter filtra, por el tiempo que tarda, cuántos
 * coinciden.
 *
 * Queda escrita y sin enchufar a propósito: para usarla hace falta el cuerpo
 * **en crudo**, y Nest ya lo ha convertido a objeto cuando llega al
 * controlador. Enchufarla pide configurar `rawBody` en `main.ts`, y eso se
 * hace cuando haya App Secret con el que probarlo.
 */
export function firmaValida(cuerpoCrudo: Buffer, firma: string, appSecret: string): boolean {
  if (!firma?.startsWith('sha256=')) return false;

  const esperada = createHmac('sha256', appSecret).update(cuerpoCrudo).digest('hex');
  const recibida = firma.slice('sha256='.length);

  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recibida));
}
