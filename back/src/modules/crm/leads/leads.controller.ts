import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { CANALES_LEAD, ESTADOS_LEAD, TIPOS_CAMPO } from './leads.reglas';
import { LeadsService } from './leads.service';

@Controller('crm')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  // ------------------------------------------------------------------ leads

  /**
   * Las listas cerradas, para que los desplegables salgan de la misma lista
   * con la que el servidor valida y no de una copia en la pantalla.
   */
  @Get('leads/catalogos')
  async catalogos() {
    return {
      productos: await this.leads.productos(),
      estados: ESTADOS_LEAD,
      canales: CANALES_LEAD,
      tiposCampo: TIPOS_CAMPO,
      ...this.leads.plantillaDeFormulario(),
      urlPublica: this.leads.urlPublica,
    };
  }

  @Get('leads/embudo')
  embudo(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('marca') marca?: string,
  ) {
    return this.leads.embudo({ desde, hasta, marca });
  }

  @Get('leads')
  listar(
    @Query('estado') estado?: string,
    @Query('asignado') asignado?: string,
    @Query('formulario') formulario?: string,
    @Query('canal') canal?: string,
    @Query('q') q?: string,
  ) {
    return this.leads.listar({
      estado,
      asignado,
      formulario: formulario ? Number(formulario) : undefined,
      canal,
      q,
    });
  }

  @Get('leads/:id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.leads.obtener(id);
  }

  @Post('leads')
  crear(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.leads.crearManual(body ?? {}, usuario);
  }

  @Post('leads/:id/estado')
  @HttpCode(200)
  estado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado?: string; motivo?: string },
    @Usuario() usuario: string,
  ) {
    return this.leads.cambiarEstado(id, body?.estado ?? '', body?.motivo ?? null, usuario);
  }

  @Post('leads/:id/asignar')
  @HttpCode(200)
  asignar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { comercial?: string | null },
    @Usuario() usuario: string,
  ) {
    return this.leads.asignar(id, body?.comercial ?? null, usuario);
  }

  @Post('leads/:id/interaccion')
  anotar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() usuario: string,
  ) {
    return this.leads.anotar(id, body ?? {}, usuario);
  }

  @Post('leads/:id/convertir')
  convertir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() usuario: string,
  ) {
    return this.leads.convertir(id, body ?? {}, usuario);
  }

  // ------------------------------------------------------------ formularios

  @Get('formularios')
  formularios() {
    return this.leads.formularios();
  }

  @Get('formularios/:id')
  formulario(@Param('id', ParseIntPipe) id: number) {
    return this.leads.formulario(id);
  }

  @Post('formularios')
  crearFormulario(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.leads.crearFormulario(body ?? {}, usuario);
  }

  /** Firma obligatoria aunque no se guarde quién: sin ella no se escribe. */
  @Patch('formularios/:id')
  editarFormulario(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() _usuario: string,
  ) {
    return this.leads.editarFormulario(id, body ?? {});
  }
}
