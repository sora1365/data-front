import { Module } from '@nestjs/common';
import { ExportacionController } from './exportacion.controller';
import { ExportacionService } from './exportacion.service';

@Module({
  controllers: [ExportacionController],
  providers: [ExportacionService],
})
export class ExportacionModule {}
