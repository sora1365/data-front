import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { esRutaDelCrm, permitidaConClaveProvisional } from './acceso.reglas';
import { AccesoService } from './acceso.service';
import { ES_PUBLICO } from './publico.decorator';

/**
 * La puerta del CRM.
 *
 * Global, pero sólo para `/crm`: el resto de FRIDAY no tiene todavía pantalla
 * de acceso y sigue firmando con `X-Usuario`.
 *
 * **Cierra por defecto.** Lo que no lleva `@Publico()` pide sesión, así que una
 * ruta nueva que se olvide de decir nada queda protegida. Al revés —abrir
 * todo y proteger lo que se marque— el olvido es un endpoint con el RUC y los
 * precios de todos los clientes a la vista.
 *
 * Deja la sesión en `req.user`, que es de donde la lee `@Usuario()`. Con
 * sesión, la cabecera `X-Usuario` se ignora: si no, cualquiera con una cuenta
 * firmaría en nombre de otro cambiando una cabecera.
 */
@Injectable()
export class CrmAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly acceso: AccesoService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const req = contexto.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (!esRutaDelCrm(req.path)) return true;

    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) return true;

    const cabecera = req.header('authorization') ?? '';
    const token = cabecera.replace(/^Bearer\s+/i, '').trim();
    if (!token || token === cabecera) {
      throw new UnauthorizedException('Hace falta entrar al CRM.');
    }

    const sesion = await this.acceso.verificar(token);
    if (sesion.debeCambiarClave && !permitidaConClaveProvisional(req.path)) {
      throw new ForbiddenException('Antes de seguir tienes que cambiar la clave provisional.');
    }
    req.user = sesion;
    return true;
  }
}
