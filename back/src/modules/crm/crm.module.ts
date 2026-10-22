import { Module } from '@nestjs/common';
import { SegmentosModule } from '../segmentos/segmentos.module';
import { CrmController } from './crm.controller';
import { CrmRestController } from './crm-rest.controller';
import { CrmRestService } from './crm-rest.service';
import { CrmService } from './crm.service';

/**
 * Importa `SegmentosModule` para reutilizar `marcarEstado`: el estado comercial
 * de un sujeto es uno solo, y escribirlo desde dos sitios distintos es cómo
 * acaban difiriendo la lista de trabajo y el CRM.
 */
@Module({
  imports: [SegmentosModule],
  controllers: [CrmController, CrmRestController],
  providers: [CrmService, CrmRestService],
  exports: [CrmService],
})
export class CrmModule {}
