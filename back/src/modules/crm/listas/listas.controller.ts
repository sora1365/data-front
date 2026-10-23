import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { ListasService } from './listas.service';
import { esResultado, RESULTADOS } from './listas.reglas';

const TIPOS_SUJETO = ['compania', 'persona_natural', 'sociedad_no_supervisada'];

@Controller('crm/listas')
export class ListasController {
  constructor(private readonly listas: ListasService) {}

  /**
   * Cómo va cada segmento.
   *
   * Va antes que `:segmento` porque Nest resuelve por orden y el comodín se
   * tragaría «rendimiento» buscando un segmento con ese código.
   */
  @Get('rendimiento')
  rendimiento(@Query('desde') desde?: string) {
    return this.listas.rendimiento(desde);
  }

  @Get('historial/:tipo/:clave')
  historial(@Param('tipo') tipo: string, @Param('clave') clave: string) {
    this.exigirSujeto(tipo);
    return this.listas.historial(tipo, clave);
  }

  @Get(':segmento')
  lista(
    @Param('segmento') segmento: string,
    @Query('producto') producto?: string,
    @Query('limite') limite?: string,
    @Query('conContacto') conContacto?: string,
  ) {
    return this.listas.deSegmento(segmento, {
      producto,
      limite: limite ? Number(limite) : undefined,
      soloConContacto: conContacto === 'true',
    });
  }

  /**
   * Anota lo que pasó con un sujeto.
   *
   * El resultado va contra una lista cerrada y no contra texto libre: «no
   * contesta», «no contestó» y «no atiende» serían tres resultados distintos,
   * y la pregunta de cuánto convierte un segmento dejaría de tener respuesta.
   */
  @Post('gestion')
  @HttpCode(200)
  anotar(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    this.exigirSujeto(body?.tipoSujeto);
    if (!body?.clave) throw new BadRequestException('Falta la clave del sujeto.');
    if (!esResultado(body?.resultado)) {
      throw new BadRequestException(`Resultado inválido. Usa: ${RESULTADOS.join(', ')}`);
    }

    return this.listas.anotar(
      {
        tipoSujeto: body.tipoSujeto,
        clave: String(body.clave),
        resultado: body.resultado,
        segmento: body.segmento,
        producto: body.producto,
        canal: body.canal,
        nota: body.nota,
      },
      usuario,
    );
  }

  /** Abre la oportunidad y anota la gestión de una vez. */
  @Post('abrir')
  @HttpCode(200)
  abrir(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    this.exigirSujeto(body?.tipoSujeto);
    if (!body?.clave) throw new BadRequestException('Falta la clave del sujeto.');

    return this.listas.abrirDesdeLista(
      {
        tipoSujeto: body.tipoSujeto,
        clave: String(body.clave),
        producto: body.producto,
        marca: body.marca,
        segmento: body.segmento,
        monto: body.monto === undefined ? undefined : Number(body.monto),
        nota: body.nota,
      },
      usuario,
    );
  }

  private exigirSujeto(tipo: unknown) {
    if (typeof tipo !== 'string' || !TIPOS_SUJETO.includes(tipo)) {
      throw new BadRequestException(`Tipo de sujeto inválido. Usa: ${TIPOS_SUJETO.join(', ')}`);
    }
  }
}
