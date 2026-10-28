import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Usuario } from '../../../common/http/usuario.decorator';
import { pareceRobot } from '../leads/leads.reglas';
import { paginaCsat, paginaMensaje, paginaSoporte } from './tickets.html';
import { DatosTicket, TicketsService, Vista } from './tickets.service';

const enlaceBase = () => (process.env.URL_PUBLICA || 'http://localhost:3001').replace(/\/+$/, '');

@Controller('crm/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // ------------------------------------------------- lo que abre el cliente
  // Van antes que `:id` para que el comodín no se las trague.

  @Get('csat/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async verCsat(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    try {
      const t = await this.tickets.csatPorToken(token);
      return t.csat_en
        ? paginaMensaje('Ya contestaste', `Gracias por tu respuesta de ${t.csat_puntaje}/5.`)
        : paginaCsat(t, `/crm/tickets/csat/${token}`);
    } catch {
      res.status(404);
      return paginaMensaje('Enlace no válido', 'Puede que el enlace esté incompleto.');
    }
  }

  @Post('csat/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async responderCsat(
    @Param('token') token: string,
    @Body() body: { puntaje?: string; comentario?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.tickets.responderCsat(token, Number(body?.puntaje), body?.comentario);
      return paginaMensaje('Gracias', 'Tu respuesta le llega a quien te atendió.');
    } catch (err: any) {
      res.status(400);
      return paginaMensaje('No se pudo guardar', escapar(err?.message ?? 'Vuelve a intentarlo.'));
    }
  }

  // ---------------------------------------------------------- lo de dentro

  @Get('catalogos')
  catalogos() {
    return this.tickets.catalogos();
  }

  @Get('resumen')
  resumen(@Query('dias') dias?: string) {
    return this.tickets.resumen(dias ? Number(dias) : undefined);
  }

  /** `?vista=abiertos|vencidos|mios|esperando|terminados|todos&q=&empresa=&usuario=` */
  @Get()
  listar(
    @Query('vista') vista?: Vista,
    @Query('q') q?: string,
    @Query('empresa') empresa?: string,
    @Query('usuario') usuario?: string,
  ) {
    return this.tickets.listar({ vista, q, usuario, empresa: empresa ? Number(empresa) : undefined });
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.obtener(id);
  }

  @Post()
  crear(@Body() body: DatosTicket & { canal?: string }, @Usuario() usuario: string) {
    // Desde la pantalla sólo se elige entre «manual» y «teléfono»: los otros
    // canales los pone el sistema al recibir, y dejar teclearlos haría que el
    // conteo por canal dijera que entró por WhatsApp algo que no.
    const canal = body?.canal === 'telefono' ? 'telefono' : 'manual';
    return this.tickets.crear(body ?? {}, usuario, canal);
  }

  @Post('desde-whatsapp/:conversacion')
  desdeWhatsapp(
    @Param('conversacion', ParseIntPipe) conversacion: number,
    @Body() body: DatosTicket,
    @Usuario() usuario: string,
  ) {
    return this.tickets.desdeWhatsapp(conversacion, usuario, body ?? {});
  }

  @Patch(':id')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: DatosTicket, @Usuario() usuario: string) {
    return this.tickets.actualizar(id, body ?? {}, usuario);
  }

  @Post(':id/estado')
  @HttpCode(200)
  estado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado?: string; nota?: string },
    @Usuario() usuario: string,
  ) {
    return this.tickets.cambiarEstado(id, body?.estado ?? '', usuario, body?.nota);
  }

  /** `{ tipo: 'respuesta' | 'nota' | 'cliente', texto }` */
  @Post(':id/eventos')
  @HttpCode(200)
  anotar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { tipo?: string; texto?: string },
    @Usuario() usuario: string,
  ) {
    const tipo = body?.tipo === 'nota' || body?.tipo === 'cliente' ? body.tipo : 'respuesta';
    return this.tickets.anotarEn(id, tipo, body?.texto ?? '', usuario);
  }

  @Post(':id/csat')
  @HttpCode(200)
  enviarCsat(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.tickets.enviarCsat(id, enlaceBase(), usuario);
  }
}

/**
 * El formulario público de soporte: `/crm/publico/soporte`.
 *
 * Contesta lo mismo a una persona y a un robot —«recibido»—, como el de
 * leads: si el robot supiera que lo detectamos, aprendería a no dejarse.
 */
@Controller('crm/publico/soporte')
export class SoportePublicoController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  pagina() {
    return paginaSoporte('/crm/publico/soporte');
  }

  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async enviar(@Body() body: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    if (pareceRobot(body ?? {})) {
      return paginaMensaje('Recibido', 'Te escribiremos al correo que dejaste.');
    }
    try {
      const { id } = await this.tickets.desdeFormulario({
        asunto: body.asunto,
        descripcion: body.descripcion,
        tipo: body.tipo,
        ruc: body.ruc,
        solicitante_nombre: body.nombre,
        solicitante_correo: body.correo,
        solicitante_telefono: body.telefono,
      });
      return paginaMensaje(
        'Recibido',
        `Tu número de solicitud es <strong>#${id}</strong>. Te escribiremos al correo que dejaste.`,
      );
    } catch (err: any) {
      res.status(400);
      return paginaMensaje('Falta algo', escapar(err?.message ?? 'Revisa los datos y vuelve a intentarlo.'));
    }
  }
}

function escapar(texto: unknown): string {
  return String(texto ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
