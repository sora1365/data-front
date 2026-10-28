import { Module } from '@nestjs/common';
import { CampaniasModule } from '../campanias/campanias.module';
import { SoportePublicoController, TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/** Importa `CampaniasModule` por el conector de correo, que es uno solo. */
@Module({
  imports: [CampaniasModule],
  controllers: [TicketsController, SoportePublicoController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
