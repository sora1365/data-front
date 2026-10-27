import { BadRequestException, ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Quién está haciendo el cambio.
 *
 * El proyecto todavía no tiene autenticación —están las dependencias de JWT,
 * pero ningún guard—, así que el usuario viaja en una cabecera. **Sin ella no
 * se escribe**: una columna de auditoría que admite anónimos no audita nada, y
 * el día que exista un guard este decorador es el único sitio que cambia.
 *
 * Vive en `common/` y no dentro de un controlador porque ya lo usan dos módulos
 * (`presencia` y `scraping`), y hacer que uno importe del otro los ataría por
 * un detalle que no es de ninguno de los dos.
 */
export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const valor = String(req.headers['x-usuario'] ?? req.user?.username ?? '').trim();
  if (valor === '') {
    throw new BadRequestException(
      'Falta la cabecera X-Usuario: toda modificación queda firmada por quien la hace.',
    );
  }
  return valor.slice(0, 120);
});
