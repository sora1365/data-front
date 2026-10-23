import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { ComisionesService } from './comisiones.service';
import { TablerosService } from './tableros.service';

@Controller('crm/tableros')
export class TablerosController {
  constructor(
    private readonly tableros: TablerosService,
    private readonly comisiones: ComisionesService,
  ) {}

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

  // ----------------------------------------------------- metas y comisiones

  /**
   * El cuadro del mes: meta, cobrado, cumplimiento y comisión.
   *
   * El mes va suelto y no como rango porque una meta es mensual. Aceptar «del
   * 10 al 25» obligaría a repartir la meta por días, que es una cuenta que
   * nadie quiere defender delante de quien cobra.
   */
  @Get('metas')
  metas(@Query('anio') anio: string, @Query('mes') mes: string) {
    const a = Number(anio);
    const m = Number(mes);
    if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('Hacen falta «anio» y «mes», con el mes del 1 al 12.');
    }
    return this.comisiones.delMes(a, m);
  }

  /** Las metas tal como están puestas, para editarlas. */
  @Get('metas/puestas')
  puestas(@Query('anio') anio: string, @Query('mes') mes: string) {
    const a = Number(anio);
    const m = Number(mes);
    if (!Number.isInteger(a) || !Number.isInteger(m)) {
      throw new BadRequestException('Hacen falta «anio» y «mes».');
    }
    return this.comisiones.metas(a, m);
  }

  @Post('metas')
  ponerMeta(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    if (!body?.comercial) throw new BadRequestException('Falta de quién es la meta.');
    return this.comisiones.ponerMeta(
      {
        comercial: body.comercial,
        anio: Number(body.anio),
        mes: Number(body.mes),
        monto: Number(body.monto),
        marca: body.marca,
        nota: body.nota,
      },
      usuario,
    );
  }

  @Get('comisiones/reglas')
  reglas() {
    return this.comisiones.reglas();
  }

  @Post('comisiones/reglas')
  ponerRegla(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    if (!body?.codigo || !body?.nombre) {
      throw new BadRequestException('La regla necesita código y nombre.');
    }
    return this.comisiones.ponerRegla(
      {
        codigo: body.codigo,
        nombre: body.nombre,
        porcentaje: Number(body.porcentaje),
        producto: body.producto,
        marca: body.marca,
        desdeCumplimiento: body.desdeCumplimiento ? Number(body.desdeCumplimiento) : 0,
        activa: body.activa ?? true,
      },
      usuario,
    );
  }
}
