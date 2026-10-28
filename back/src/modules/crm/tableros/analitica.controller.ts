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
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Usuario } from '../../../common/http/usuario.decorator';
import { validarDefinicion } from './analitica.reglas';
import { AnaliticaService, type Filtros } from './analitica.service';

/**
 * Pronóstico, pipeline, productividad, tendencia, alertas y reportes.
 *
 * Comparte prefijo con `TablerosController` porque en la pantalla son el
 * mismo sitio; está aparte porque aquello mira el pasado de un periodo y esto
 * no tiene periodo o lo tiene configurable.
 */
@Controller('crm/tableros')
export class AnaliticaController {
  constructor(private readonly analitica: AnaliticaService) {}

  @Get('pronostico')
  pronostico(@Query() q: Record<string, string>) {
    return this.analitica.pronostico(filtros(q), q.meses ? Number(q.meses) : 3);
  }

  @Get('pipeline')
  pipeline(@Query() q: Record<string, string>) {
    return this.analitica.pipeline(filtros(q));
  }

  @Get('productividad')
  productividad(@Query() q: Record<string, string>) {
    const { desde, hasta } = periodo(q);
    return this.analitica.productividad(desde, hasta, filtros(q));
  }

  @Get('tendencia')
  tendencia(@Query() q: Record<string, string>) {
    return this.analitica.tendencia(filtros(q), q.meses ? Number(q.meses) : 12);
  }

  @Get('alertas')
  alertas(@Query() q: Record<string, string>) {
    return this.analitica.alertas(filtros(q));
  }

  // ----------------------------------------------------------------- equipos

  @Get('equipos')
  equipos() {
    return this.analitica.equipos();
  }

  @Post('equipos')
  @HttpCode(200)
  ponerSupervisor(
    @Body() body: { usuario?: string; supervisor?: string | null },
    @Usuario() _usuario: string,
  ) {
    if (!body?.usuario) throw new BadRequestException('Falta a quién.');
    return this.analitica.ponerSupervisor(body.usuario, body.supervisor || null);
  }

  // ---------------------------------------------------------------- reportes

  @Get('reportes/catalogo')
  catalogo() {
    return this.analitica.catalogo();
  }

  @Post('reportes/ejecutar')
  @HttpCode(200)
  ejecutar(@Body() body: unknown) {
    const { definicion, errores } = validarDefinicion(body);
    if (!definicion) throw new BadRequestException(errores.join(' '));
    return this.analitica.ejecutar(definicion);
  }

  /**
   * El reporte como `.xlsx`.
   *
   * Por POST con la definición en el cuerpo, y no por GET con todo en la URL:
   * así se exporta también lo que todavía no se ha guardado, que es lo normal
   * mientras alguien está probando agrupaciones.
   */
  @Post('reportes/exportar')
  @HttpCode(200)
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async exportar(
    @Body() body: { nombre?: string } & Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { definicion, errores } = validarDefinicion(body);
    if (!definicion) throw new BadRequestException(errores.join(' '));
    const nombre = String(body?.nombre || 'Reporte del CRM');
    const libro = await this.analitica.excel(await this.analitica.ejecutar(definicion), nombre);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte-${definicion.desde ?? 'hoy'}.xlsx"`,
    );
    return libro;
  }

  @Get('reportes')
  reportes() {
    return this.analitica.reportes();
  }

  @Post('reportes')
  @HttpCode(200)
  guardar(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.analitica.guardarReporte(body ?? {}, usuario);
  }

  @Post('reportes/:id/enviar')
  @HttpCode(200)
  enviar(@Param('id', ParseIntPipe) id: number, @Usuario() _usuario: string) {
    return this.analitica.enviarAhora(id);
  }

  @Delete('reportes/:id')
  borrar(@Param('id', ParseIntPipe) id: number, @Usuario() _usuario: string) {
    return this.analitica.borrarReporte(id);
  }
}

function filtros(q: Record<string, string>): Filtros {
  return {
    marca: q.marca || undefined,
    comercial: q.comercial || undefined,
    equipo: q.equipo || undefined,
  };
}

/** El mismo contrato que el resumen: `hasta` exclusivo y obligatorio. */
function periodo(q: Record<string, string>) {
  const { desde, hasta } = q;
  if (!desde || !hasta || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
    throw new BadRequestException('Hacen falta «desde» y «hasta» como fechas.');
  }
  if (Date.parse(hasta) <= Date.parse(desde)) {
    throw new BadRequestException('El periodo termina antes de empezar.');
  }
  return { desde, hasta };
}
