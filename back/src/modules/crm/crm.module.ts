import { Module } from '@nestjs/common';
import { SegmentosModule } from '../segmentos/segmentos.module';
import { CampaniasModule } from './campanias/campanias.module';
import { ContableController, InventarioController } from './contable/contable.controller';
import { GuionesController } from './guiones/guiones.controller';
import { GuionesService } from './guiones/guiones.service';
import { ListasController } from './listas/listas.controller';
import { ListasService } from './listas/listas.service';
import { PostventaController } from './postventa/postventa.controller';
import { PostventaService } from './postventa/postventa.service';
import { ContableService } from './contable/contable.service';
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
import { AnaliticaController } from './tableros/analitica.controller';
import { AnaliticaService } from './tableros/analitica.service';
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
  controllers: [CrmController, CrmRestController, TablerosController, AnaliticaController, SeguimientoController, ProformasController, CotizadoresController,
    ContableController, InventarioController, PostventaController,
    ListasController, GuionesController],
  providers: [
    CrmService,
    CrmRestService,
    CrmCoincidenciasService,
    TablerosService,
    AnaliticaService,
    ComisionesService,
    SeguimientoService,
    ProformasService,
    CotizadoresService,
    ContableService,
    PostventaService,
    ListasService,
    GuionesService,
  ],
  exports: [CrmService],
})
export class CrmModule {}
