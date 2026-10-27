import {
  BadRequestException,
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
import { Publico } from '../auth/publico.decorator';
import { Usuario } from '../../../common/http/usuario.decorator';
import { ProformasService } from './proformas.service';

@Controller('crm/proformas')
export class ProformasController {
  constructor(private readonly proformas: ProformasService) {}

  @Get('precios')
  precios() {
    return this.proformas.precios();
  }

  @Post('precios')
  @HttpCode(200)
  ponerPrecio(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    if (!body?.producto) throw new BadRequestException('Falta el producto.');
    return this.proformas.ponerPrecio(
      {
        producto: body.producto,
        precio: Number(body.precio),
        iva: body.iva === undefined ? undefined : Number(body.iva),
        nota: body.nota,
      },
      usuario,
    );
  }

  /**
   * La página que abre el cliente.
   *
   * Sin autenticación y por el token: quien recibe una proforma no tiene
   * cuenta en el CRM. Va declarada antes que `:id` porque Nest resuelve por
   * orden y el comodín se tragaría «ver».
   */
  @Publico()
  @Get('ver/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async ver(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    try {
      const proforma = await this.proformas.porToken(token);
      return this.pagina(proforma);
    } catch {
      res.status(404);
      return this.paginaSimple(
        'Enlace no válido',
        'Puede que el enlace esté incompleto o que esta proforma ya no exista.',
      );
    }
  }

  @Publico()
  @Post('ver/:token/aceptar')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async aceptar(
    @Param('token') token: string,
    @Body() body: { quien?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.quien?.trim()) {
      res.status(400);
      return this.paginaSimple('Falta tu nombre', 'Escribe quién acepta la proforma.');
    }
    try {
      const proforma = await this.proformas.aceptar(token, body.quien.trim());
      return this.paginaSimple(
        'Proforma aceptada',
        `Gracias. Hemos registrado la aceptación de la proforma ${escapar(proforma.numero)}.` +
          ' Nos pondremos en contacto para los siguientes pasos.',
      );
    } catch (e: any) {
      res.status(409);
      return this.paginaSimple('No se pudo aceptar', escapar(e?.message ?? 'Vuelve a intentarlo.'));
    }
  }

  @Publico()
  @Post('ver/:token/rechazar')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async rechazar(
    @Param('token') token: string,
    @Body() body: { quien?: string; motivo?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.proformas.rechazar(token, body?.quien?.trim() || 'sin identificar', body?.motivo);
      return this.paginaSimple(
        'Gracias por contestar',
        'Hemos registrado tu respuesta. Si cambias de opinión, escríbele a tu contacto.',
      );
    } catch (e: any) {
      res.status(409);
      return this.paginaSimple('No se pudo registrar', escapar(e?.message ?? 'Vuelve a intentarlo.'));
    }
  }

  // ------------------------------------------------------------ lo de dentro

  @Get('oportunidad/:id')
  deOportunidad(@Param('id', ParseIntPipe) id: number) {
    return this.proformas.deOportunidad(id);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.proformas.obtener(id);
  }

  @Post()
  crear(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    if (!body?.oportunidad) throw new BadRequestException('Falta la oportunidad.');
    return this.proformas.crear(
      Number(body.oportunidad),
      usuario,
      body.diasDeValidez ? Number(body.diasDeValidez) : undefined,
    );
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, any>) {
    return this.proformas.editar(id, body ?? {});
  }

  /**
   * Manda la proforma al cliente.
   *
   * El enlace se compone con la dirección pública del back, que es donde vive
   * la página del cliente. Se toma de `URL_PUBLICA` y no de la cabecera de la
   * petición: detrás de un proxy, el `Host` que llega es el interno, y el
   * cliente recibiría un enlace a una máquina que no existe fuera.
   */
  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@Param('id', ParseIntPipe) id: number) {
    const base = (process.env.URL_PUBLICA || 'http://localhost:3001').replace(/\/+$/, '');
    return this.proformas.enviar(id, base);
  }

  @Post(':id/anular')
  @HttpCode(200)
  anular(@Param('id', ParseIntPipe) id: number, @Body() body: { motivo?: string }) {
    if (!body?.motivo?.trim()) throw new BadRequestException('Di por qué se anula.');
    return this.proformas.anular(id, body.motivo.trim());
  }

  // ------------------------------------------------------------------ vistas

  private pagina(p: any): string {
    const cerrada = p.estado === 'aceptada' || p.estado === 'rechazada' || p.estado === 'anulada';
    const vencida = p.estado_visible === 'vencida';

    const filas = p.lineas
      .map(
        (l: any) => `
        <tr>
          <td>${escapar(l.descripcion)}</td>
          <td class="n">${l.cantidad}</td>
          <td class="n">${dinero(l.precio_unitario)}</td>
          <td class="n">${l.descuento_pct > 0 ? `${l.descuento_pct}%` : '—'}</td>
          <td class="n">${dinero(l.cantidad * l.precio_unitario * (1 - l.descuento_pct / 100))}</td>
        </tr>`,
      )
      .join('');

    const acciones = cerrada
      ? `<p class="aviso">Esta proforma está ${escapar(p.estado)}.</p>`
      : vencida
        ? `<p class="aviso">Esta proforma venció el ${escapar(p.valida_hasta)}. Pide una nueva a tu contacto.</p>`
        : `
        <form method="post" action="/crm/proformas/ver/${escapar(p.token)}/aceptar" class="acciones">
          <label>Tu nombre<input name="quien" required placeholder="Nombre y apellido"></label>
          <button type="submit">Aceptar la proforma</button>
        </form>`;

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Proforma ${escapar(p.numero)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    .hoja { max-width: 46rem; margin: 2rem auto; background: #fff; padding: 2rem;
            border: 1px solid #d4d8e0; border-radius: 10px; }
    h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
    .meta { color: #475569; font-size: .85rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { text-align: left; font-weight: 500; color: #475569; font-size: .75rem;
         border-bottom: 1px solid #e2e8f0; padding: .4rem 0; }
    td { padding: .5rem 0; border-bottom: 1px solid #f1f5f9; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    .totales { margin-left: auto; width: 16rem; margin-top: 1rem; font-size: .9rem; }
    .totales div { display: flex; justify-content: space-between; padding: .2rem 0; }
    .totales .total { font-weight: 600; font-size: 1.05rem; border-top: 1px solid #e2e8f0;
                      margin-top: .3rem; padding-top: .5rem; }
    .acciones { margin-top: 2rem; display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; }
    label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; color: #475569; }
    input { padding: .5rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: .9rem; }
    button { padding: .55rem 1.1rem; border: 0; border-radius: 6px; background: #1e3a5f;
             color: #fff; font-size: .9rem; cursor: pointer; }
    .aviso { margin-top: 2rem; padding: .75rem 1rem; background: #fef3c7; border-radius: 6px;
             font-size: .9rem; }
    .notas { margin-top: 1.5rem; font-size: .85rem; color: #475569; white-space: pre-line; }
  </style>
</head>
<body>
  <div class="hoja">
    <h1>Proforma ${escapar(p.numero)}</h1>
    <div class="meta">
      ${escapar(p.razon_social)}${p.ruc ? ` · RUC ${escapar(p.ruc)}` : ''}<br>
      Válida hasta el ${escapar(p.valida_hasta)}
    </div>

    <table>
      <thead>
        <tr><th>Detalle</th><th class="n">Cant.</th><th class="n">P. unit.</th>
            <th class="n">Dcto.</th><th class="n">Importe</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>

    <div class="totales">
      <div><span>Subtotal</span><span>${dinero(p.subtotal)}</span></div>
      ${p.descuento > 0 ? `<div><span>Descuento</span><span>− ${dinero(p.descuento)}</span></div>` : ''}
      <div><span>IVA</span><span>${dinero(p.iva)}</span></div>
      <div class="total"><span>Total</span><span>${dinero(p.total)}</span></div>
    </div>

    ${p.notas ? `<div class="notas">${escapar(p.notas)}</div>` : ''}
    ${p.condiciones ? `<div class="notas">${escapar(p.condiciones)}</div>` : ''}
    ${acciones}
  </div>
</body>
</html>`;
  }

  private paginaSimple(titulo: string, mensaje: string): string {
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

function dinero(valor: number): string {
  return `$${Number(valor ?? 0).toFixed(2)}`;
}
