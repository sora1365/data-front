import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TablerosService } from './tableros.service';

@Controller('crm/tableros')
export class TablerosController {
  constructor(private readonly tableros: TablerosService) {}

  /**
   * Los números del periodo.
   *
   * `desde` y `hasta` son obligatorios y `hasta` es exclusivo: con un rango
   * cerrado, «hasta el 30 de septiembre» deja fuera todo lo de ese día después
   * de medianoche, y el mes sale corto sin que se note.
   */
  @Get()
  resumen(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('marca') marca?: string,
    @Query('comercial') comercial?: string,
  ) {
    if (!desde || !hasta) {
      throw new BadRequestException('Hacen falta «desde» y «hasta».');
    }
    if (Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
      throw new BadRequestException('Las fechas no se entienden.');
    }
    if (Date.parse(hasta) <= Date.parse(desde)) {
      throw new BadRequestException('El periodo termina antes de empezar.');
    }
    return this.tableros.resumen({ desde, hasta, marca, comercial });
  }
}
