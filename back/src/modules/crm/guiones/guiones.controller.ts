import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { GuionesService, type DefinicionDeGuion } from './guiones.service';

@Controller('crm/guiones')
export class GuionesController {
  constructor(private readonly guiones: GuionesService) {}

  @Get()
  listar() {
    return this.guiones.listar();
  }

  /**
   * El guion de esta llamada.
   *
   * Va antes que `:codigo` porque Nest resuelve por orden y el comodín se
   * tragaría «aplicable». Devuelve `null` cuando no hay ninguno que encaje,
   * que es un caso normal: se llama igual, sólo que sin ayuda.
   */
  @Get('aplicable')
  aplicable(@Query('producto') producto?: string, @Query('segmento') segmento?: string) {
    return this.guiones.aplicable(producto, segmento);
  }

  @Get(':codigo')
  obtener(@Param('codigo') codigo: string) {
    return this.guiones.obtener(codigo);
  }

  @Post()
  guardar(@Body() body: DefinicionDeGuion, @Usuario() usuario: string) {
    return this.guiones.guardar(body, usuario);
  }
}
