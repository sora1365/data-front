import { Module } from '@nestjs/common';
import { DuplicadosController } from './duplicados.controller';
import { DuplicadosService } from './duplicados.service';

@Module({
  controllers: [DuplicadosController],
  providers: [DuplicadosService],
})
export class DuplicadosModule {}
