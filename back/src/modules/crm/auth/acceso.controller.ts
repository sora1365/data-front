import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccesoService, Sesion } from './acceso.service';
import { Publico } from './publico.decorator';

type ConSesion = Request & { user: Sesion };

@Controller('crm/auth')
export class AccesoController {
  constructor(private readonly acceso: AccesoService) {}

  @Publico()
  @Post('entrar')
  @HttpCode(200)
  entrar(@Body() body: { usuario?: string; clave?: string }, @Req() req: Request) {
    return this.acceso.entrar(body?.usuario ?? '', body?.clave ?? '', {
      ip: req.ip,
      agente: req.header('user-agent'),
    });
  }

  /** Quién soy. Es lo que pregunta la pantalla al recargar. */
  @Get('yo')
  yo(@Req() req: ConSesion) {
    return req.user;
  }

  @Post('clave')
  @HttpCode(200)
  cambiarClave(@Body() body: { actual?: string; nueva?: string }, @Req() req: ConSesion) {
    return this.acceso.cambiarClave(req.user.username, body?.actual ?? '', body?.nueva ?? '');
  }

  @Post('usuarios')
  alta(@Body() body: any, @Req() req: ConSesion) {
    return this.acceso.alta(req.user, body ?? {});
  }

  @Post('usuarios/:usuario/restablecer')
  @HttpCode(200)
  restablecer(@Param('usuario') usuario: string, @Req() req: ConSesion) {
    return this.acceso.restablecer(req.user, usuario);
  }

  @Get('accesos')
  accesos(@Req() req: ConSesion, @Query('usuario') usuario?: string) {
    return this.acceso.accesos(req.user, usuario);
  }
}
