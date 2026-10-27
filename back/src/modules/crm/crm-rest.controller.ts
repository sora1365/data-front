import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Usuario } from '../../common/http/usuario.decorator';
import { CrmRestService } from './crm-rest.service';
import { CrmCoincidenciasService } from './crm-coincidencias.service';
import { problemaAlEscribirComercial } from './auth/acceso.reglas';
import type { Sesion } from './auth/acceso.service';

/**
 * Los usuarios del CRM (`sales`) son un recurso más de este API, y sin esta
 * comprobación cualquiera se haría administrador con un PUT sobre su ficha.
 */
function vigilarComerciales(
  req: Request & { user?: Sesion },
  recurso: string,
  operacion: 'crear' | 'editar' | 'borrar',
  id?: string,
  cuerpo?: Record<string, any>,
) {
  if (recurso !== 'sales') return;
  const problema = problemaAlEscribirComercial(req.user as Sesion, operacion, id, cuerpo);
  if (problema) throw new ForbiddenException(problema);
}

/**
 * El API que consumen las pantallas del CRM.
 *
 * Vive bajo `/crm/api` y no bajo `/crm` para no mezclarse con los endpoints
 * que ya tenía el módulo —tablero, ventas, enganche con el gestor—, que son
 * de FRIDAY y no de react-admin. Son dos contratos distintos sobre las mismas
 * tablas, y juntarlos haría que cambiar uno rompiera el otro.
 *
 * El total va en la cabecera `Content-Range`, que es donde lo busca
 * react-admin, y se expone con `Access-Control-Expose-Headers` porque el CRM
 * corre en otro puerto: sin eso el navegador se la oculta al JavaScript y
 * todas las listas salen con una sola página.
 */
@Controller('crm/api')
export class CrmRestController {
  constructor(
    private readonly rest: CrmRestService,
    private readonly coincidencias: CrmCoincidenciasService,
  ) {}

  /**
   * Si la empresa que se está escribiendo ya existe.
   *
   * Va declarada **antes** que `:recurso/:id`: Nest resuelve por orden, y el
   * comodín de dos segmentos se tragaría esta ruta y buscaría un recurso
   * llamado «coincidencias».
   */
  @Get('coincidencias/empresa')
  coincidenciasDeEmpresa(
    @Query('nombre') nombre?: string,
    @Query('ruc') ruc?: string,
    @Query('excluir') excluir?: string,
  ) {
    return this.coincidencias.buscar(nombre, ruc, excluir);
  }

  @Get(':recurso')
  async getList(
    @Param('recurso') recurso: string,
    @Query('filter') filter: string,
    @Query('sort') sort: string,
    @Query('range') range: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, total } = await this.rest.getList(recurso, { filter, sort, range });
    const [desde] = range ? JSON.parse(range) : [0];
    const hasta = Number(desde) + data.length - 1;
    res.setHeader('Content-Range', `${recurso} ${desde}-${Math.max(hasta, 0)}/${total}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    return data;
  }

  @Get(':recurso/:id')
  getOne(@Param('recurso') recurso: string, @Param('id') id: string) {
    return this.rest.getOne(recurso, id);
  }

  @Post(':recurso')
  create(
    @Param('recurso') recurso: string,
    @Body() cuerpo: Record<string, any>,
    @Usuario() usuario: string,
    @Req() req: Request,
  ) {
    vigilarComerciales(req, recurso, 'crear');
    return this.rest.create(recurso, cuerpo, usuario);
  }

  @Put(':recurso/:id')
  update(
    @Param('recurso') recurso: string,
    @Param('id') id: string,
    @Body() cuerpo: Record<string, any>,
    @Usuario() usuario: string,
    @Req() req: Request,
  ) {
    vigilarComerciales(req, recurso, 'editar', id, cuerpo);
    return this.rest.update(recurso, id, cuerpo, usuario);
  }

  @Delete(':recurso/:id')
  remove(@Param('recurso') recurso: string, @Param('id') id: string, @Req() req: Request) {
    vigilarComerciales(req, recurso, 'borrar', id);
    return this.rest.remove(recurso, id);
  }
}
