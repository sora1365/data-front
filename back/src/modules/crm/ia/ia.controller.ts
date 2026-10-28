import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { Aplicacion, Entidad, IaService } from './ia.service';

@Controller('crm/ia')
export class IaController {
  constructor(private readonly ia: IaService) {}

  /**
   * Si hay IA en este servidor. La pantalla lo pregunta una vez por sesión y
   * esconde el asistente si no.
   */
  @Get('estado')
  estado() {
    return this.ia.estado();
  }

  @Get('uso')
  uso(@Query('dias') dias?: string) {
    return this.ia.uso(dias ? Number(dias) : undefined);
  }

  /** `{ accion: 'tarea' | 'temperatura' | 'borrador' | 'descartado' }` */
  @Post('analisis/:id/aplicar')
  @HttpCode(200)
  aplicar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { accion?: Aplicacion },
    @Usuario() usuario: string,
  ) {
    return this.ia.aplicar(id, body?.accion as Aplicacion, usuario);
  }

  /** El último análisis de la ficha, sin llamar a la IA. */
  @Get(':entidad/:id')
  ultimo(@Param('entidad') entidad: Entidad, @Param('id', ParseIntPipe) id: number) {
    return this.ia.ultimo(entidad, id);
  }

  @Post(':entidad/:id/analizar')
  @HttpCode(200)
  analizar(
    @Param('entidad') entidad: Entidad,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { forzar?: boolean },
    @Usuario() usuario: string,
  ) {
    return this.ia.analizar(entidad, id, usuario, body?.forzar === true);
  }
}
