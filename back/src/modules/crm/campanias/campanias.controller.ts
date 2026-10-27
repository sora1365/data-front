import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { crearMulterConfig } from '../../imports/multer.config';
import type { Response } from 'express';
import { Publico } from '../auth/publico.decorator';
import { Usuario } from '../../../common/http/usuario.decorator';
import { CampaniasService } from './campanias.service';

/**
 * Lo que se puede adjuntar a una campaña.
 *
 * Documentos comerciales, no cualquier cosa: una propuesta, un tarifario, un
 * folleto. Se dejan fuera los ejecutables y los comprimidos, que es lo que
 * hace que un correo entero acabe en spam aunque el resto esté bien.
 *
 * Diez megas por archivo porque los proveedores rechazan correos grandes y el
 * límite de la mayoría de buzones ronda los 25 MB contando todo.
 */
const multerAdjuntos = crearMulterConfig(
  ['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg'],
  10 * 1024 * 1024,
  'Se admiten documentos e imágenes, no ejecutables ni comprimidos.',
);

@Controller('crm/campanias')
export class CampaniasController {
  constructor(private readonly campanias: CampaniasService) {}

  @Get('estado')
  estado() {
    return { conectado: this.campanias.conectado };
  }

  /**
   * Las plantillas, filtradas por producto.
   *
   * Va declarada antes que `:id`, porque Nest resuelve por orden y el comodín
   * se tragaría «plantillas» buscando una campaña con ese id.
   */
  @Get('plantillas')
  plantillas(@Query('producto') producto?: string) {
    return this.campanias.plantillas(producto);
  }

  @Post('plantillas')
  crearPlantilla(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.campanias.crearPlantilla(body ?? {}, usuario);
  }

  @Patch('plantillas/:id')
  editarPlantilla(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
  ) {
    return this.campanias.editarPlantilla(id, body ?? {});
  }

  @Get()
  listar() {
    return this.campanias.listar();
  }

  @Post()
  crear(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.campanias.crear(body ?? {}, usuario);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.campanias.obtener(id);
  }

  @Get(':id/destinatarios')
  destinatarios(@Param('id', ParseIntPipe) id: number, @Query('estado') estado?: string) {
    return this.campanias.destinatarios(id, estado);
  }

  /** Calcula a quién se escribiría, sin mandar nada. */
  @Post(':id/preparar')
  @HttpCode(200)
  preparar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { exigirConsentimientoExpreso?: boolean },
  ) {
    return this.campanias.preparar(id, body ?? {});
  }

  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@Param('id', ParseIntPipe) id: number) {
    return this.campanias.enviar(id);
  }

  // ---------------------------------------------------------------- adjuntos

  @Get(':id/adjuntos')
  adjuntos(@Param('id', ParseIntPipe) id: number) {
    return this.campanias.adjuntos(id);
  }

  @Post(':id/adjuntos')
  @UseInterceptors(FileInterceptor('file', multerAdjuntos))
  agregarAdjunto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File,
    @Usuario() usuario: string,
  ) {
    if (!archivo) throw new BadRequestException('No llegó ningún archivo.');
    return this.campanias.agregarAdjunto(
      id,
      {
        nombre: archivo.originalname,
        ruta: archivo.path,
        tipo: archivo.mimetype,
        tamano: archivo.size,
      },
      usuario,
    );
  }

  @Delete(':id/adjuntos/:adjunto')
  quitarAdjunto(
    @Param('id', ParseIntPipe) id: number,
    @Param('adjunto', ParseIntPipe) adjunto: number,
  ) {
    return this.campanias.quitarAdjunto(id, adjunto);
  }

  // ------------------------------------------------------------ consentimiento

  @Post('consentimiento')
  @HttpCode(200)
  registrar(@Body() body: { correo?: string; estado?: string; origen?: string }) {
    if (!body?.correo) throw new BadRequestException('Falta el correo.');
    const admitidos = ['otorgado', 'sin_declarar', 'revocado'];
    if (!body.estado || !admitidos.includes(body.estado)) {
      throw new BadRequestException(`Estado no válido. Usa: ${admitidos.join(', ')}`);
    }
    return this.campanias.registrarConsentimiento(
      body.correo,
      body.estado as any,
      body.origen ?? 'registrado a mano',
    );
  }

  /**
   * La baja desde el enlace del correo.
   *
   * Sin autenticación a propósito: quien recibe un correo no tiene cuenta en
   * el CRM, y pedirle una para dejar de recibir equivale a no dejarle salir.
   * Devuelve una página y no JSON porque esto lo abre una persona en su
   * navegador, no un programa.
   */
  @Publico()
  @Get('baja/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async baja(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    try {
      const { correo } = await this.campanias.darDeBaja(token);
      return this.pagina(
        'Listo',
        `No volveremos a escribir a <strong>${this.escapar(correo)}</strong>.`,
      );
    } catch {
      res.status(404);
      return this.pagina(
        'Enlace no válido',
        'Puede que ya hayas usado este enlace o que esté incompleto.',
      );
    }
  }

  /**
   * El pixel que marca el correo como abierto.
   *
   * Devuelve un GIF de un píxel transparente, que es la única forma de saber
   * si abrieron un correo. **Falla en silencio a propósito**: muchos clientes
   * bloquean las imágenes, así que un correo sin apertura registrada no
   * significa que nadie lo leyera, y un error aquí no puede romper la imagen.
   */
  @Publico()
  @Get('abierto/:token.gif')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store')
  async abierto(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    try {
      await this.campanias.marcarAbierto(token);
    } catch {
      /* el pixel se devuelve igual */
    }
    return Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    );
  }

  private escapar(texto: string): string {
    return texto.replace(/[<>&"]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
    );
  }

  private pagina(titulo: string, mensaje: string): string {
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titulo}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center;
           min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
    .caja { background: #fff; padding: 2rem; border-radius: 8px; max-width: 28rem;
            border: 1px solid #d4d8e0; text-align: center; }
    h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
    p { margin: 0; color: #475569; font-size: .9rem; }
  </style>
</head>
<body><div class="caja"><h1>${titulo}</h1><p>${mensaje}</p></div></body>
</html>`;
  }
}
