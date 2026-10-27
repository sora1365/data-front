import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContableGuard } from './contable.guard';
import { Publico } from '../auth/publico.decorator';
import { ContableService } from './contable.service';

/**
 * El API del módulo contable.
 *
 * Todo lo de aquí va con llave (`X-Api-Key`), porque lo que entra reescribe
 * precios y marca ventas como cobradas, y lo que sale lleva RUC, importes y
 * comisiones. Es el único sitio del CRM pensado para otro sistema y no para
 * una persona.
 *
 * Las rutas que consume la propia pantalla del CRM —artículos y perfiles—
 * viven en el otro controlador, sin llave: son sólo lectura y ya están detrás
 * de la misma puerta que el resto del CRM.
 */
@Publico()
@Controller('crm/contable')
@UseGuards(ContableGuard)
export class ContableController {
  constructor(private readonly contable: ContableService) {}

  // ------------------------------------------------------------- lo que entra

  /** El catálogo de inventario, completo. Lo que no venga se desactiva. */
  @Post('inventario')
  @HttpCode(200)
  inventario(@Body() body: any) {
    const lote = Array.isArray(body) ? body : body?.articulos;
    return this.contable.sincronizarInventario(lote);
  }

  /** El costo por hora de cada perfil, o el sueldo del que sale. */
  @Post('nomina')
  @HttpCode(200)
  nomina(@Body() body: any) {
    const lote = Array.isArray(body) ? body : body?.perfiles;
    return this.contable.sincronizarNomina(lote);
  }

  /**
   * Avisos sobre una venta: facturada, cobrada o anulada.
   *
   * Se identifican por `venta` (el id que el CRM entregó) o por `proforma` (el
   * número que el contable tiene a la vista). La `referencia` hace el aviso
   * repetible: mandarlo dos veces no cobra dos veces.
   */
  @Post('cobros')
  @HttpCode(200)
  cobros(@Body() body: any) {
    const lote = Array.isArray(body) ? body : body?.movimientos;
    return this.contable.registrarMovimientos(lote);
  }

  // -------------------------------------------------------------- lo que sale

  @Get('ventas')
  ventas(@Query('desde') desde?: string) {
    return this.contable.ventasPendientes(desde);
  }

  @Get('cotizaciones')
  cotizaciones(@Query('desde') desde?: string) {
    return this.contable.cotizacionesAceptadas(desde);
  }

  @Get('comisiones')
  comisiones(@Query('anio') anio: string, @Query('mes') mes: string) {
    const a = Number(anio);
    const m = Number(mes);
    if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('Hacen falta «anio» y «mes», con el mes del 1 al 12.');
    }
    return this.contable.comisionesDelMes(a, m);
  }

  @Get('ventas/:id/movimientos')
  movimientos(@Param('id', ParseIntPipe) id: number) {
    return this.contable.movimientosDe(id);
  }
}

/**
 * Lo que la pantalla del CRM lee de lo que trajo el contable.
 *
 * Separado del controlador con llave a propósito: si colgara del mismo, la
 * pantalla tendría que llevar la llave del contable dentro del navegador, que
 * es exactamente donde no debe estar.
 */
@Controller('crm/inventario')
export class InventarioController {
  constructor(private readonly contable: ContableService) {}

  @Get()
  articulos(@Query('q') busqueda?: string) {
    return this.contable.articulos(busqueda);
  }

  @Get('perfiles')
  perfiles() {
    return this.contable.perfiles();
  }

  /** Si hay conexión y de cuándo es cada dato que llegó. */
  @Get('estado')
  estado() {
    return this.contable.estado();
  }
}
