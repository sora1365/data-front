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
} from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { SeguimientoService } from './seguimiento.service';

@Controller('crm/seguimiento')
export class SeguimientoController {
  constructor(private readonly seguimiento: SeguimientoService) {}

  @Get('secuencias')
  secuencias() {
    return this.seguimiento.secuencias();
  }

  /**
   * Los seguimientos en marcha.
   *
   * Antes de contarlos se recogen los que ya no tienen nada pendiente: si no,
   * la lista enseña como vivo un plan cuyas tres tareas están hechas, y el
   * número de «seguimientos activos» deja de querer decir nada.
   */
  @Get()
  async vivos() {
    await this.seguimiento.recogerTerminados();
    return this.seguimiento.vivos();
  }

  @Get('oportunidad/:id')
  deOportunidad(@Param('id', ParseIntPipe) id: number) {
    return this.seguimiento.deOportunidad(id);
  }

  @Post('iniciar')
  @HttpCode(200)
  iniciar(
    @Body() body: { secuencia?: string; oportunidad?: number; arranque?: string },
    @Usuario() usuario: string,
  ) {
    if (!body?.secuencia) throw new BadRequestException('Falta la secuencia.');
    if (!body?.oportunidad) throw new BadRequestException('Falta la oportunidad.');
    if (body.arranque && !/^\d{4}-\d{2}-\d{2}$/.test(body.arranque)) {
      throw new BadRequestException('El arranque se escribe como 2026-10-19.');
    }
    return this.seguimiento.iniciar(
      body.secuencia,
      Number(body.oportunidad),
      usuario,
      body.arranque,
    );
  }

  /**
   * Cortar a mano: el cliente contestó, o ya no hay nada que perseguir.
   *
   * El motivo es obligatorio y se guarda. «Se cortó» sin más no distingue
   * haber cerrado el trato de haberse rendido, y es justo esa diferencia la
   * que se quiere mirar después.
   */
  @Post(':id/cortar')
  @HttpCode(200)
  cortar(@Param('id', ParseIntPipe) id: number, @Body() body: { motivo?: string }) {
    if (!body?.motivo?.trim()) {
      throw new BadRequestException('Di por qué se corta: luego nadie se acuerda.');
    }
    return this.seguimiento.cortar(id, body.motivo.trim());
  }

  /** Para probar el calendario de una secuencia sin crear nada. */
  @Get('secuencias/:codigo/previo')
  previo(@Param('codigo') codigo: string, @Query('arranque') arranque?: string) {
    return this.seguimiento.previo(codigo, arranque);
  }
}
