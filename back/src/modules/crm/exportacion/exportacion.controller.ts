import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Usuario } from '../../../common/http/usuario.decorator';
import { ExportacionService } from './exportacion.service';

@Controller('crm/exportacion')
export class ExportacionController {
  constructor(private readonly exportacion: ExportacionService) {}

  @Get()
  historial() {
    return this.exportacion.historial();
  }

  /**
   * El ZIP con todo el CRM.
   *
   * Firmado con `X-Usuario` aunque sólo lea: el historial de exportaciones
   * existe para saber quién se llevó los datos, y una lectura anónima lo
   * dejaría con un hueco justo donde importa.
   */
  @Post('descargar')
  @HttpCode(200)
  async descargar(@Usuario() usuario: string, @Res({ passthrough: true }) res: Response) {
    const { archivo, nombre, sha256 } = await this.exportacion.exportar(usuario);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'X-Sha256': sha256,
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Sha256',
    });
    return new StreamableFile(archivo);
  }

  /** Subir un ZIP y decir si está entero y si salió de aquí. */
  @Post('verificar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 500 * 1024 * 1024 } }))
  verificar(@UploadedFile() archivo?: Express.Multer.File) {
    if (!archivo?.buffer) throw new BadRequestException('Falta el archivo.');
    return this.exportacion.verificarZip(archivo.buffer);
  }
}
