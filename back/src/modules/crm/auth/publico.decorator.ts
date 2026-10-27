import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'crm:publico';

/**
 * Una ruta del CRM que no pide sesión.
 *
 * Son las que abre alguien que no tiene cuenta —el cliente que acepta una
 * proforma, quien se da de baja de un correo, el formulario de una web— o
 * otro sistema con su propia puerta (Meta, el contable). Cada una tiene que
 * llevarlo escrito: el guardia cierra por defecto, y una ruta nueva que se
 * olvide de declararlo queda protegida, no abierta.
 */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
