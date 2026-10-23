import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * La puerta por la que entra el contable.
 *
 * Es el único sitio del CRM que atiende a otro sistema en vez de a una
 * persona, y lo que entra por aquí reescribe precios, marca ventas como
 * cobradas y mueve comisiones. Una llave compartida no es gran cosa, pero la
 * alternativa mientras no haya autenticación es un endpoint abierto.
 *
 * **Sin llave configurada, la puerta está cerrada**, no abierta. Es la
 * decisión que importa: un guardia que se desactiva solo cuando falta su
 * configuración protege exactamente hasta el día del despliegue en que a
 * alguien se le olvida la variable.
 */
@Injectable()
export class ContableGuard implements CanActivate {
  private readonly logger = new Logger('Contable');

  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<Request>();
    const esperada = process.env.CONTABLE_API_KEY?.trim();

    if (!esperada) {
      this.logger.warn('Llamada al API del contable sin CONTABLE_API_KEY configurada.');
      throw new ServiceUnavailableException(
        'La conexión con el contable no está configurada en este servidor.',
      );
    }

    const recibida = String(
      peticion.header('x-api-key') ?? peticion.header('authorization')?.replace(/^Bearer /i, '') ?? '',
    ).trim();

    if (!recibida || !iguales(recibida, esperada)) {
      this.logger.warn('Llamada al API del contable con llave incorrecta.');
      throw new UnauthorizedException('Llave no válida.');
    }

    return true;
  }
}

/**
 * Comparación de tiempo constante.
 *
 * Comparar con `===` tarda más cuanto más se parecen las cadenas, y eso basta
 * para ir adivinando una llave carácter a carácter. Se comparan los resúmenes
 * para que las dos entradas midan lo mismo: `timingSafeEqual` revienta con
 * longitudes distintas, que es justo el caso de alguien probando.
 */
function iguales(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
