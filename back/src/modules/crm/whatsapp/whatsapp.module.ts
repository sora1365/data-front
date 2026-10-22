import { Logger, Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import {
  WhatsappConector,
  WhatsappConectorMeta,
  WhatsappConectorSimulado,
} from './whatsapp.conector';
import { WhatsappService } from './whatsapp.service';

/**
 * El único sitio donde se decide si WhatsApp envía de verdad.
 *
 * Con `WHATSAPP_TOKEN` en el entorno habla con Meta; sin él, simula y lo dice
 * en el arranque. Esa decisión está aquí y no repartida en `if`s por el
 * servicio: así el resto del código no tiene forma de comportarse distinto
 * según el entorno, que es como se cuelan los fallos que sólo pasan en
 * producción.
 */
@Module({
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    {
      provide: WhatsappConector,
      useFactory: () => {
        const token = process.env.WHATSAPP_TOKEN?.trim();
        const log = new Logger('WhatsApp');

        if (!token) {
          log.warn(
            'Sin WHATSAPP_TOKEN: los mensajes se registran pero no salen de esta máquina.',
          );
          return new WhatsappConectorSimulado();
        }

        log.log('Conectado a la Cloud API de Meta.');
        return new WhatsappConectorMeta(token);
      },
    },
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
