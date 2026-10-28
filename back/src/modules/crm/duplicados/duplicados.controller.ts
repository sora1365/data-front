import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { DuplicadosService, Tipo } from './duplicados.service';

@Controller('crm/duplicados')
export class DuplicadosController {
  constructor(private readonly duplicados: DuplicadosService) {}

  /** Los posibles duplicados de contactos y de empresas. */
  @Get()
  buscar() {
    return this.duplicados.buscar();
  }

  @Get('fusiones')
  historial() {
    return this.duplicados.historial();
  }

  /** `{ ganador, perdedor }`: el perdedor desaparece y lo suyo pasa al ganador. */
  @Post(':tipo/fusionar')
  @HttpCode(200)
  fusionar(
    @Param('tipo') tipo: Tipo,
    @Body() body: { ganador?: number; perdedor?: number },
    @Usuario() usuario: string,
  ) {
    return this.duplicados.fusionar(tipo, Number(body?.ganador), Number(body?.perdedor), usuario);
  }

  /** `{ a, b }`: no son la misma; no volver a proponerlos. */
  @Post(':tipo/no-son')
  @HttpCode(200)
  noSon(@Param('tipo') tipo: Tipo, @Body() body: { a?: number; b?: number }, @Usuario() usuario: string) {
    return this.duplicados.noSon(tipo, Number(body?.a), Number(body?.b), usuario);
  }
}
