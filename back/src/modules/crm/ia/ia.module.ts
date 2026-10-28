import { Logger, Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { IaClaude, IaConector, IaSinConfigurar } from './ia.conector';
import { IaController } from './ia.controller';
import { IaService } from './ia.service';

/**
 * El esfuerzo se puede subir por `CRM_IA_ESFUERZO`, pero no más allá de
 * `high`: resumir una venta no gana nada con los niveles de arriba y cuesta
 * bastante más. La llave y el modelo se leen al arrancar; cambiarlos pide
 * reiniciar el back.
 */
const ESFUERZOS = ['low', 'medium', 'high'] as const;

@Module({
  imports: [TicketsModule],
  controllers: [IaController],
  providers: [
    IaService,
    {
      provide: IaConector,
      useFactory: () => {
        const log = new Logger('IA');
        const clave = process.env.ANTHROPIC_API_KEY?.trim();
        if (!clave) {
          log.warn('Sin ANTHROPIC_API_KEY: la IA comercial está apagada y la pantalla esconde sus botones.');
          return new IaSinConfigurar();
        }
        const modelo = process.env.CRM_IA_MODELO?.trim() || 'claude-opus-5-5';
        const pedido = process.env.CRM_IA_ESFUERZO?.trim() as (typeof ESFUERZOS)[number];
        const esfuerzo = ESFUERZOS.includes(pedido) ? pedido : 'medium';
        log.log(`IA comercial con ${modelo}, esfuerzo ${esfuerzo}.`);
        return new IaClaude(clave, modelo, esfuerzo);
      },
    },
  ],
})
export class IaModule {}
