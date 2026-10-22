import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Usuario } from '../../common/http/usuario.decorator';
import { AbrirOportunidad, CrmService, RegistrarInteraccion } from './crm.service';
import {
  CANALES,
  CANAL_SISTEMA,
  DIRECCIONES,
  esCanalDeMano,
  esDireccion,
} from './crm.reglas';

const TIPOS_SUJETO = ['compania', 'persona_natural', 'sociedad_no_supervisada'];

/**
 * API del CRM.
 *
 * Toda escritura va firmada con `X-Usuario`, igual que presencia y scraping: lo
 * que se anota de un cliente sin saber quién lo anotó no sirve para nada el día
 * que haya que preguntarle.
 */
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('catalogos')
  catalogos() {
    return this.crm.catalogos();
  }

  @Get('tablero')
  tablero(
    @Query('comercial') comercial?: string,
    @Query('marca') marca?: string,
    @Query('producto') producto?: string,
  ) {
    return this.crm.tablero({ comercial, marca, producto });
  }

  @Get('oportunidades/:id')
  oportunidad(@Param('id', ParseIntPipe) id: number) {
    return this.crm.oportunidad(id);
  }

  @Post('oportunidades')
  abrir(@Body() body: Partial<AbrirOportunidad>, @Usuario() usuario: string) {
    this.exigirSujeto(body.tipoSujeto, body.clave);
    if (!body.producto) {
      throw new BadRequestException('Falta el producto que se le ofrece.');
    }
    if (!body.marca) {
      throw new BadRequestException('Falta la marca con la que se vende.');
    }
    return this.crm.abrir(body as AbrirOportunidad, usuario);
  }

  @Patch('oportunidades/:id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<AbrirOportunidad>) {
    return this.crm.editar(id, body);
  }

  @Post('oportunidades/:id/etapa')
  @HttpCode(200)
  moverEtapa(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { etapa?: string; indice?: number },
    @Usuario() usuario: string,
  ) {
    if (!body?.etapa) throw new BadRequestException('Falta la etapa de destino.');
    return this.crm.moverEtapa(id, body.etapa, body.indice ?? null, usuario);
  }

  @Post('oportunidades/:id/archivar')
  @HttpCode(200)
  archivar(@Param('id', ParseIntPipe) id: number) {
    return this.crm.archivar(id);
  }

  /**
   * Anota una conversación en el historial de la venta.
   *
   * El canal y la dirección se validan contra la lista blanca de
   * `crm.reglas.ts` y no contra lo que acepte la tabla. La columna `canal` es
   * `text` libre a propósito —WhatsApp y correo van a entrar desde la
   * integración, y cada canal nuevo no debería ser una migración—, así que si
   * esto no los cerrara, «llamada», «Llamada» y «tel» serían tres canales
   * distintos y la pregunta de por dónde entran las ventas no tendría
   * respuesta.
   */
  @Post('oportunidades/:id/interaccion')
  interaccion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<RegistrarInteraccion>,
    @Usuario() usuario: string,
  ) {
    if (!esCanalDeMano(body?.canal)) {
      throw new BadRequestException(
        `Canal inválido. Usa: ${CANALES.join(', ')}. «${CANAL_SISTEMA}» lo escribe solo el sistema al mover una tarjeta.`,
      );
    }
    if (!esDireccion(body?.direccion)) {
      throw new BadRequestException(
        `Falta si la conversación fue entrante o saliente. Usa: ${DIRECCIONES.join(', ')}.`,
      );
    }
    return this.crm.registrarInteraccion(id, body as RegistrarInteraccion, usuario);
  }

  @Get('sujeto/:tipo/:clave')
  porSujeto(@Param('tipo') tipo: string, @Param('clave') clave: string) {
    this.exigirSujeto(tipo, clave);
    return this.crm.porSujeto(tipo, clave);
  }

  /** Qué ofrecerle a este sujeto, según el gestor comercial. */
  @Get('sugerencias/:tipo/:clave')
  sugerencias(@Param('tipo') tipo: string, @Param('clave') clave: string) {
    this.exigirSujeto(tipo, clave);
    return this.crm.sugerencias(tipo, clave);
  }

  // ------------------------------------------------ ventas: el módulo contable
  //
  // Estos cuatro endpoints son para el módulo contable, no para la pantalla del
  // CRM. Él pregunta qué hay pendiente de facturar y marca lo que va emitiendo;
  // el CRM no necesita saber nada de facturación.

  @Get('ventas')
  ventas(@Query('estado') estado?: string, @Query('marca') marca?: string) {
    return this.crm.ventas({ estado, marca });
  }

  @Post('ventas/:id/facturar')
  @HttpCode(200)
  facturar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { documento?: string; fecha?: string },
    @Usuario() usuario: string,
  ) {
    if (!body?.documento) {
      throw new BadRequestException(
        'Falta el número del documento emitido: una venta facturada sin documento no se puede casar con nada.',
      );
    }
    return this.crm.marcarVenta(id, 'facturada', usuario, body);
  }

  @Post('ventas/:id/cobrar')
  @HttpCode(200)
  cobrar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fecha?: string },
    @Usuario() usuario: string,
  ) {
    return this.crm.marcarVenta(id, 'cobrada', usuario, body ?? {});
  }

  @Post('ventas/:id/anular')
  @HttpCode(200)
  anular(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { nota?: string },
    @Usuario() usuario: string,
  ) {
    return this.crm.marcarVenta(id, 'anulada', usuario, body ?? {});
  }

  /**
   * El tipo de sujeto se valida contra la misma lista que usa la capa
   * comercial. Un tipo inventado no daría error: devolvería cero filas, que es
   * mucho peor porque parece una respuesta.
   */
  private exigirSujeto(tipo?: string, clave?: string) {
    if (!tipo || !TIPOS_SUJETO.includes(tipo)) {
      throw new BadRequestException(`Tipo de sujeto inválido. Usa: ${TIPOS_SUJETO.join(', ')}`);
    }
    if (!clave) throw new BadRequestException('Falta la clave del sujeto.');
  }
}
