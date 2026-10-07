import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { promises as fs } from 'node:fs';
import { crearMulterConfig } from './multer.config';
import {
  OPERATION_KINDS,
  OperationKind,
  OperationsService,
} from './operations.service';

const multerConfigOperations = crearMulterConfig(
  ['.xlsx', '.txt', '.csv'],
  800 * 1024 * 1024,
);
const EXTENSIONES: Record<OperationKind, string[]> = {
  'auditar-fuentes': ['.xlsx'],
  balances: ['.txt'],
  catalogo: ['.txt', '.csv'],
  ciiu: ['.xlsx'],
  coeficientes: ['.xlsx'],
};
const TAMANO_MAXIMO: Record<OperationKind, number> = {
  'auditar-fuentes': 64 * 1024 * 1024,
  balances: 800 * 1024 * 1024,
  catalogo: 32 * 1024 * 1024,
  ciiu: 32 * 1024 * 1024,
  coeficientes: 64 * 1024 * 1024,
};

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post(':tipo/preview')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', multerConfigOperations))
  async preview(
    @Param('tipo') tipo: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException(
        'No se recibió ningún archivo en el campo "file".',
      );
    let kind: OperationKind;
    try {
      kind = this.tipo(tipo);
    } catch (err) {
      await fs.unlink(file.path).catch(() => undefined);
      throw err;
    }
    const extension = file.originalname
      .toLowerCase()
      .slice(file.originalname.lastIndexOf('.'));
    if (!EXTENSIONES[kind].includes(extension)) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        `Para ${kind} se acepta ${EXTENSIONES[kind].join(' o ')}.`,
      );
    }
    if (file.size > TAMANO_MAXIMO[kind]) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        `El archivo excede el máximo permitido para ${kind} (${Math.round(TAMANO_MAXIMO[kind] / 1024 / 1024)} MB).`,
      );
    }
    const result = await this.operations.crearPreview(kind, file);
    return {
      previewId: result.id,
      status: result.status,
      statusUrl: `/operations/previews/${result.id}`,
    };
  }

  @Get('previews/:id')
  async estado(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.operations.obtener(id);
    return {
      previewId: p.id,
      kind: p.kind,
      status: p.status,
      filename: p.originalFilename,
      report: p.report,
      errorMessage: p.errorMessage,
      expiresAt: p.expiresAt,
      importJobId: p.importJobId,
    };
  }

  @Post('previews/:id/execute')
  ejecutar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { modo?: string },
  ) {
    return this.operations.ejecutar(id, body?.modo);
  }

  @Delete('previews/:id')
  cancelar(@Param('id', ParseUUIDPipe) id: string) {
    return this.operations.cancelar(id);
  }

  private tipo(value: string): OperationKind {
    if ((OPERATION_KINDS as readonly string[]).includes(value))
      return value as OperationKind;
    throw new BadRequestException(
      `Operación desconocida. Valores válidos: ${OPERATION_KINDS.join(', ')}.`,
    );
  }
}
