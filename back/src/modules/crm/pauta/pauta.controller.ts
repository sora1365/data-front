import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Usuario } from '../../../common/http/usuario.decorator';
import { PLATAFORMAS } from './pauta.reglas';
import { PautaService } from './pauta.service';

/**
 * El informe de gasto se lee en memoria y no se guarda: lo que interesa son
 * las cifras, que quedan en `crm.pauta_gasto` con quién las subió. Dos megas
 * sobran para un año de días con todas las columnas que exporta Meta.
 */
const INFORME = FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } });

@Controller('crm/pauta')
export class PautaController {
  constructor(private readonly pauta: PautaService) {}

  @Get('catalogos')
  catalogos() {
    return { plataformas: PLATAFORMAS };
  }

  @Get('sin-pauta')
  sinPauta() {
    return this.pauta.sinPauta();
  }

  @Get()
  listar(
    @Query('marca') marca?: string,
    @Query('plataforma') plataforma?: string,
    @Query('activas') activas?: string,
  ) {
    return this.pauta.listar({ marca, plataforma, activas: activas === 'true' });
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.pauta.obtener(id);
  }

  @Post()
  crear(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.pauta.crear(body ?? {}, usuario);
  }

  /** Firma obligatoria aunque no se guarde quién: sin ella no se escribe. */
  @Patch(':id')
  editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() _usuario: string,
  ) {
    return this.pauta.editar(id, body ?? {});
  }

  @Post(':id/gasto')
  anotarGasto(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() usuario: string,
  ) {
    return this.pauta.anotarGasto(id, body ?? {}, usuario);
  }

  @Delete(':id/gasto/:dia')
  borrarGasto(
    @Param('id', ParseIntPipe) id: number,
    @Param('dia') dia: string,
    @Usuario() _usuario: string,
  ) {
    return this.pauta.borrarGasto(id, dia);
  }

  @Post(':id/informe')
  @UseInterceptors(INFORME)
  importar(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
    @Usuario() usuario: string,
  ) {
    return this.pauta.importarInforme(id, archivo?.buffer, usuario);
  }
}
