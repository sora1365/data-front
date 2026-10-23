import { Module } from '@nestjs/common';
import { SegmentosModule } from '../segmentos/segmentos.module';
import { CampaniasModule } from './campanias/campanias.module';
import { CotizadoresController } from './cotizadores/cotizadores.controller';
import { CotizadoresService } from './cotizadores/cotizadores.service';
import { ProformasController } from './proformas/proformas.controller';
import { ProformasService } from './proformas/proformas.service';
import { CrmController } from './crm.controller';
import { CrmRestController } from './crm-rest.controller';
import { CrmRestService } from './crm-rest.service';
import { CrmCoincidenciasService } from './crm-coincidencias.service';
import { CrmService } from './crm.service';
import { SeguimientoController } from './seguimiento/seguimiento.controller';
import { SeguimientoService } from './seguimiento/seguimiento.service';
import { TablerosController } from './tableros/tableros.controller';
import { TablerosService } from './tableros/tableros.service';
import { ComisionesService } from './tableros/comisiones.service';

/**
 * Importa `SegmentosModule` para reutilizar `marcarEstado`: el estado comercial
 * de un sujeto es uno solo, y escribirlo desde dos sitios distintos es cómo
 * acaban difiriendo la lista de trabajo y el CRM.
 */
@Module({
  imports: [SegmentosModule, CampaniasModule],
  controllers: [CrmController, CrmRestController, TablerosController, SeguimientoController, ProformasController, CotizadoresController],
  providers: [
    CrmService,
    CrmRestService,
    CrmCoincidenciasService,
    TablerosService,
    ComisionesService,
    SeguimientoService,
    ProformasService,
    CotizadoresService,
  ],
  exports: [CrmService],
})
export class CrmModule {}
