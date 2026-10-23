import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { CotizadoresService, type DefinicionDeCotizador } from './cotizadores.service';

@Controller('crm/cotizadores')
export class CotizadoresController {
  constructor(private readonly cotizadores: CotizadoresService) {}

  @Get()
  listar() {
    return this.cotizadores.listar();
  }

  /**
   * Lo cotizado para una oportunidad.
   *
   * Va antes que `:codigo` porque Nest resuelve por orden y el comodín se
   * tragaría «oportunidad» buscando un cotizador con ese código.
   */
  @Get('oportunidad/:id')
  deOportunidad(@Param('id', ParseIntPipe) id: number) {
    return this.cotizadores.deOportunidad(id);
  }

  @Get(':codigo')
  obtener(@Param('codigo') codigo: string) {
    return this.cotizadores.obtener(codigo);
  }

  @Post()
  guardar(@Body() body: DefinicionDeCotizador, @Usuario() usuario: string) {
    return this.cotizadores.guardar(body, usuario);
  }

  /** Calcula sin guardar: es lo que se usa mientras se tantean los números. */
  @Post(':codigo/calcular')
  @HttpCode(200)
  calcular(@Param('codigo') codigo: string, @Body() body: Record<string, any>) {
    return this.cotizadores.calcular(codigo, body?.entradas ?? body ?? {});
  }

  /** Guarda la cotización que se va a ofrecer, con sus números congelados. */
  @Post(':codigo/cotizar')
  @HttpCode(200)
  cotizar(
    @Param('codigo') codigo: string,
    @Body() body: { entradas?: Record<string, unknown>; oportunidad?: number; nota?: string },
    @Usuario() usuario: string,
  ) {
    if (body?.oportunidad !== undefined && Number.isNaN(Number(body.oportunidad))) {
      throw new BadRequestException('La oportunidad no se entiende.');
    }
    return this.cotizadores.guardarCotizacion(
      codigo,
      body?.entradas ?? {},
      usuario,
      body?.oportunidad ? Number(body.oportunidad) : undefined,
      body?.nota,
    );
  }
}
