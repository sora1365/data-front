import { Module } from '@nestjs/common';
import { CampaniasModule } from '../campanias/campanias.module';
import { CrmModule } from '../crm.module';
import { LeadsPublicoController } from './leads-publico.controller';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Captación de leads: formularios públicos, bandeja y embudo.
 *
 * Importa `CrmModule` para convertir con `CrmService.abrir` —la regla de una
 * oportunidad abierta por cliente y producto vive ahí y en ningún otro sitio—
 * y `CampaniasModule` para guardar el consentimiento en el mismo registro que
 * consultan las campañas.
 */
@Module({
  imports: [CrmModule, CampaniasModule],
  controllers: [LeadsController, LeadsPublicoController],
  providers: [LeadsService],
})
export class LeadsModule {}
