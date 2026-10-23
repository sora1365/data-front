import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Usuario } from '../../../common/http/usuario.decorator';
import { PostventaService } from './postventa.service';

@Controller('crm/postventa')
export class PostventaController {
  constructor(private readonly postventa: PostventaService) {}

  /**
   * La encuesta que abre el cliente.
   *
   * Sin autenticación y por el token, como la proforma: quien recibe el
   * enlace no tiene cuenta en el CRM. Va antes que el resto para que el
   * comodín no se la trague.
   */
  @Get('encuesta/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async ver(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    try {
      const encuesta = await this.postventa.encuestaPorToken(token);
      return encuesta.respondida_en
        ? this.pagina(
            'Ya contestaste',
            `Gracias por tu respuesta${encuesta.puntaje !== null ? ` de ${encuesta.puntaje}/10` : ''}.`,
          )
        : this.formulario(encuesta);
    } catch {
      res.status(404);
      return this.pagina('Enlace no válido', 'Puede que el enlace esté incompleto.');
    }
  }

  @Post('encuesta/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async responder(
    @Param('token') token: string,
    @Body() body: { puntaje?: string; comentario?: string; quien?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.postventa.responder(
        token,
        Number(body?.puntaje),
        body?.comentario,
        body?.quien,
      );
      return this.pagina(
        'Gracias',
        'Hemos registrado tu respuesta. Si pusiste un comentario, lo va a leer quien lleva tu cuenta.',
      );
    } catch (e: any) {
      res.status(400);
      return this.pagina('No se pudo guardar', escapar(e?.message ?? 'Vuelve a intentarlo.'));
    }
  }

  // ------------------------------------------------------------ lo de dentro

  @Get()
  resumen(@Query('dias') dias?: string) {
    return this.postventa.resumen(dias ? Number(dias) : undefined);
  }

  @Get('renovaciones')
  renovaciones(@Query('dias') dias?: string) {
    return this.postventa.renovaciones(dias ? Number(dias) : undefined);
  }

  @Post('renovaciones/:venta/renovar')
  @HttpCode(200)
  renovar(@Param('venta', ParseIntPipe) venta: number, @Usuario() usuario: string) {
    return this.postventa.renovar(venta, usuario);
  }

  @Post('renovaciones/:venta')
  @HttpCode(200)
  fijar(
    @Param('venta', ParseIntPipe) venta: number,
    @Body() body: { periodicidad?: any; desde?: string },
  ) {
    const admitidas = ['mensual', 'anual', 'unica', null];
    const periodicidad = body?.periodicidad ?? null;
    if (!admitidas.includes(periodicidad)) {
      throw new BadRequestException('La periodicidad es mensual, anual o unica.');
    }
    return this.postventa.fijarRenovacion(venta, periodicidad, body?.desde);
  }

  @Get('encuestas')
  encuestas() {
    return this.postventa.encuestas();
  }

  @Post('encuestas')
  crearEncuesta(@Body() body: { venta?: number; correo?: string }, @Usuario() usuario: string) {
    if (!body?.venta) throw new BadRequestException('Falta la venta.');
    return this.postventa.crearEncuesta(Number(body.venta), usuario, body.correo);
  }

  @Post('encuestas/:id/enviar')
  @HttpCode(200)
  enviar(@Param('id', ParseIntPipe) id: number) {
    const base = (process.env.URL_PUBLICA || 'http://localhost:3001').replace(/\/+$/, '');
    return this.postventa.enviarEncuesta(id, base);
  }

  // ------------------------------------------------------------------ vistas

  /**
   * Una sola pregunta y un comentario.
   *
   * Los números van como botones grandes y no como un desplegable: una
   * encuesta que cuesta tres toques se contesta la mitad de las veces, y la
   * mitad que falta es siempre la de los clientes que no están contentos.
   */
  private formulario(encuesta: any): string {
    const botones = Array.from({ length: 11 }, (_, n) => `
      <label class="nota">
        <input type="radio" name="puntaje" value="${n}" required>
        <span>${n}</span>
      </label>`).join('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>¿Qué tal vamos?</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    .hoja { max-width: 34rem; margin: 2rem auto; background: #fff; padding: 2rem;
            border: 1px solid #d4d8e0; border-radius: 10px; }
    h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
    p.sub { color: #475569; font-size: .9rem; margin: 0 0 1.5rem; }
    .notas { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .5rem; }
    .nota input { position: absolute; opacity: 0; }
    .nota span { display: grid; place-items: center; width: 2.4rem; height: 2.4rem;
                 border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer;
                 font-size: .95rem; }
    .nota input:checked + span { background: #1e3a5f; color: #fff; border-color: #1e3a5f; }
    .extremos { display: flex; justify-content: space-between; font-size: .75rem;
                color: #64748b; margin-bottom: 1.5rem; }
    textarea, input[type=text] { width: 100%; box-sizing: border-box; padding: .6rem;
      border: 1px solid #cbd5e1; border-radius: 6px; font-size: .9rem; font-family: inherit; }
    label.campo { display: block; font-size: .8rem; color: #475569; margin-bottom: 1rem; }
    button { margin-top: .5rem; padding: .6rem 1.2rem; border: 0; border-radius: 6px;
             background: #1e3a5f; color: #fff; font-size: .95rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="hoja">
    <h1>¿Qué tal vamos?</h1>
    <p class="sub">
      ${escapar(encuesta.razon_social ?? '')} · del 0 al 10, ¿qué tan probable es que
      nos recomiendes?
    </p>
    <form method="post" action="/crm/postventa/encuesta/${escapar(encuesta.token)}">
      <div class="notas">${botones}</div>
      <div class="extremos"><span>Nada probable</span><span>Muy probable</span></div>

      <label class="campo">
        ¿Por qué? (opcional, pero es lo que más nos sirve)
        <textarea name="comentario" rows="3"></textarea>
      </label>

      <label class="campo">
        Tu nombre (opcional)
        <input type="text" name="quien">
      </label>

      <button type="submit">Enviar</button>
    </form>
  </div>
</body>
</html>`;
  }

  private pagina(titulo: string, mensaje: string): string {
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapar(titulo)}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center;
           min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
    .caja { background: #fff; padding: 2rem; border-radius: 8px; max-width: 28rem;
            border: 1px solid #d4d8e0; text-align: center; }
    h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
    p { margin: 0; color: #475569; font-size: .9rem; }
  </style>
</head>
<body><div class="caja"><h1>${escapar(titulo)}</h1><p>${mensaje}</p></div></body>
</html>`;
  }
}

function escapar(texto: unknown): string {
  return String(texto ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c,
  );
}
