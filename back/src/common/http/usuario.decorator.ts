import { BadRequestException, ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Quién está haciendo el cambio.
 *
 * En el CRM lo pone la sesión (`CrmAuthGuard` deja la persona en `req.user`), y
 * entonces **la cabecera se ignora**: si mandara ella, cualquiera con cuenta
 * firmaría en nombre de otro cambiando una cabecera. El resto de FRIDAY no
 * tiene todavía pantalla de acceso y sigue firmando con `X-Usuario`. **Sin una
 * de las dos no se escribe**: una columna de auditoría que admite anónimos no
 * audita nada.
 *
 * Vive en `common/` y no dentro de un controlador porque ya lo usan dos módulos
 * (`presencia` y `scraping`), y hacer que uno importe del otro los ataría por
 * un detalle que no es de ninguno de los dos.
 */
export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const valor = String(req.user?.username ?? req.headers['x-usuario'] ?? '').trim();
  if (valor === '') {
    throw new BadRequestException(
      'Falta la cabecera X-Usuario: toda modificación queda firmada por quien la hace.',
    );
  }
  return valor.slice(0, 120);
});
