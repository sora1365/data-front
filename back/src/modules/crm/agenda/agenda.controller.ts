import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Usuario } from '../../../common/http/usuario.decorator';
import { AgendaService, DatosEvento } from './agenda.service';

@Controller('crm/agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('calendarios')
  calendarios(@Usuario() usuario: string) {
    return this.agenda.calendarios(usuario);
  }

  @Post('calendarios')
  crearCalendario(
    @Body() body: { nombre?: string; descripcion?: string; color?: string; marca?: string },
    @Usuario() usuario: string,
  ) {
    if (!body?.nombre?.trim()) throw new BadRequestException('El calendario necesita un nombre.');
    return this.agenda.crearCalendario(body as any, usuario);
  }

  @Get('calendarios/:id/miembros')
  miembros(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.agenda.miembros(id, usuario);
  }

  @Post('calendarios/:id/compartir')
  @HttpCode(200)
  compartir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { usuario?: string; puedeEditar?: boolean },
    @Usuario() usuario: string,
  ) {
    if (!body?.usuario) throw new BadRequestException('Falta con quién compartirlo.');
    return this.agenda.compartir(id, body.usuario, body.puedeEditar ?? false, usuario);
  }

  /**
   * Los eventos de un rango.
   *
   * `desde` y `hasta` son obligatorios: sin ellos habría que devolver la
   * agenda entera, y una pantalla de calendario siempre sabe qué semana está
   * mirando.
   */
  @Get('eventos')
  eventos(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('calendarios') calendarios: string,
    @Usuario() usuario: string,
  ) {
    if (!desde || !hasta) {
      throw new BadRequestException('Hacen falta «desde» y «hasta».');
    }
    const ids = calendarios
      ? calendarios.split(',').map(Number).filter((n) => !Number.isNaN(n))
      : undefined;
    return this.agenda.eventos(usuario, desde, hasta, ids);
  }

  @Post('eventos')
  crearEvento(@Body() body: Partial<DatosEvento>, @Usuario() usuario: string) {
    if (!body?.calendario) throw new BadRequestException('Falta el calendario.');
    if (!body?.titulo?.trim()) throw new BadRequestException('El evento necesita un título.');
    if (!body?.inicio || !body?.fin) throw new BadRequestException('Faltan las fechas.');
    return this.agenda.crearEvento(body as DatosEvento, usuario);
  }

  @Get('eventos/:id')
  evento(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.agenda.evento(id, usuario);
  }

  @Patch('eventos/:id')
  editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<DatosEvento> & { resultado?: string; asistio?: boolean },
    @Usuario() usuario: string,
  ) {
    return this.agenda.editarEvento(id, body ?? {}, usuario);
  }

  @Delete('eventos/:id')
  borrar(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.agenda.borrarEvento(id, usuario);
  }

  @Post('eventos/:id/responder')
  @HttpCode(200)
  responder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado?: string },
    @Usuario() usuario: string,
  ) {
    if (!body?.estado) throw new BadRequestException('Falta la respuesta.');
    return this.agenda.responder(id, body.estado, usuario);
  }

  /**
   * Las tareas de la semana que se está mirando.
   *
   * `lunes` llega como `YYYY-MM-DD` y no como un instante: la semana que se
   * mira es la del reloj de quien mira, y un `toISOString()` del lunes a las
   * 00:00 en Ecuador es el domingo a las 05:00 en UTC, que empieza la semana
   * un día antes.
   */
  @Get('tareas')
  tareas(
    @Query('lunes') lunes: string,
    @Query('hoy') hoy: string,
    @Usuario() usuario: string,
  ) {
    const esDia = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
    if (!esDia(lunes)) {
      throw new BadRequestException('Falta el lunes de la semana, como 2026-10-19.');
    }
    // `hoy` lo manda el cliente porque sabe en qué día está su reloj; si no
    // llega, se usa el del servidor.
    return this.agenda.tareas(usuario, lunes, esDia(hoy) ? hoy : undefined);
  }

  @Post('tareas/:id/hecha')
  @HttpCode(200)
  marcarTarea(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { hecha?: boolean },
    @Usuario() usuario: string,
  ) {
    return this.agenda.marcarTarea(id, body?.hecha ?? true, usuario);
  }

  /** Cuándo pueden atender estas personas. */
  @Get('disponibilidad')
  disponibilidad(
    @Query('usuarios') usuarios: string,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('duracion') duracion: string,
  ) {
    if (!usuarios || !desde || !hasta) {
      throw new BadRequestException('Hacen falta «usuarios», «desde» y «hasta».');
    }
    return this.agenda.disponibilidad(
      usuarios.split(',').filter(Boolean),
      desde,
      hasta,
      duracion ? Number(duracion) : 30,
    );
  }

  /** Si esta franja choca con algo de quienes van a asistir. */
  @Post('conflictos')
  @HttpCode(200)
  conflictos(@Body() body: { inicio?: string; fin?: string; usuarios?: string[] }) {
    if (!body?.inicio || !body?.fin) throw new BadRequestException('Faltan las fechas.');
    return this.agenda.comprobarConflictos({
      inicio: body.inicio,
      fin: body.fin,
      usuarios: body.usuarios ?? [],
    });
  }
}
