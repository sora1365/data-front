import { Logger, Module } from '@nestjs/common';
import { SegmentosModule } from '../../segmentos/segmentos.module';
import { CampaniasController } from './campanias.controller';
import { CampaniasService } from './campanias.service';
import {
  CorreoConector,
  CorreoConectorResend,
  CorreoConectorSimulado,
} from './correo.conector';

/**
 * El único sitio donde se decide si los correos salen de verdad.
 *
 * Con `RESEND_API_KEY` se manda; sin ella se simula y se avisa al arrancar.
 * Importa más aquí que en WhatsApp: una campaña mal probada contra el
 * proveedor real no se puede deshacer, porque los correos ya salieron.
 */
@Module({
  imports: [SegmentosModule],
  controllers: [CampaniasController],
  providers: [
    CampaniasService,
    {
      provide: CorreoConector,
      useFactory: () => {
        const clave = process.env.RESEND_API_KEY?.trim();
        const remitente = process.env.CORREO_REMITENTE?.trim();
        const log = new Logger('Correo');

        if (!clave || !remitente) {
          log.warn(
            'Sin RESEND_API_KEY o CORREO_REMITENTE: las campañas se registran pero no se envían.',
          );
          return new CorreoConectorSimulado();
        }

        log.log(`Conectado al proveedor de correo, enviando desde ${remitente}.`);
        return new CorreoConectorResend(clave, remitente);
      },
    },
  ],
  exports: [CampaniasService],
})
export class CampaniasModule {}
