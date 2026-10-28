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
import { Usuario } from '../../../common/http/usuario.decorator';
import { CANALES_DE_ENVIO, MOTIVOS_DE_RECHAZO, type CanalDeEnvio } from './proformas.reglas';
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
  @Get('ver/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async ver(
    @Param('token') token: string,
    @Query('imprimir') imprimir: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const proforma = await this.proformas.porToken(token);
      return this.pagina(proforma, imprimir !== undefined);
    } catch {
      res.status(404);
      return this.paginaSimple(
        'Enlace no válido',
        'Puede que el enlace esté incompleto o que esta proforma ya no exista.',
      );
    }
  }

  @Post('ver/:token/aceptar')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async aceptar(
    @Param('token') token: string,
    @Body() body: { quien?: string; opcion?: string | string[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.quien?.trim()) {
      res.status(400);
      return this.paginaSimple('Falta tu nombre', 'Escribe quién acepta la proforma.');
    }
    // Un formulario manda un valor suelto si hay una casilla marcada y una
    // lista si hay varias.
    const opciones = ([] as string[]).concat(body.opcion ?? []).map(Number).filter(Number.isFinite);
    try {
      const proforma = await this.proformas.aceptar(token, body.quien.trim(), opciones);
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

  @Post('ver/:token/rechazar')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async rechazar(
    @Param('token') token: string,
    @Body() body: { quien?: string; motivo?: string; motivo_rechazo?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.proformas.rechazar(
        token,
        body?.quien?.trim() || 'sin identificar',
        body?.motivo_rechazo,
        body?.motivo,
      );
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

  /** Todas las propuestas, para seguirlas. `estado` es el visible: incluye «vencida». */
  @Get()
  listado(
    @Query('estado') estado?: string,
    @Query('comercial') comercial?: string,
    @Query('marca') marca?: string,
  ) {
    return this.proformas.listado({ estado, comercial, marca });
  }

  @Get('motivos')
  motivos() {
    return Object.entries(MOTIVOS_DE_RECHAZO).map(([codigo, nombre]) => ({ codigo, nombre }));
  }

  @Get('plantillas')
  plantillas() {
    return this.proformas.plantillas();
  }

  @Post('plantillas')
  @HttpCode(200)
  ponerPlantilla(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    return this.proformas.ponerPlantilla(body ?? {}, usuario);
  }

  @Get('descuentos')
  topes() {
    return this.proformas.topes();
  }

  @Post('descuentos')
  @HttpCode(200)
  ponerTope(@Body() body: { nivel?: string; hasta_pct?: number }, @Usuario() usuario: string) {
    return this.proformas.ponerTope(String(body?.nivel ?? ''), Number(body?.hasta_pct), usuario);
  }

  /** Los descuentos esperando firma, y cuáles puede firmar quien pregunta. */
  @Get('aprobaciones')
  aprobaciones(@Usuario() usuario: string) {
    return this.proformas.pendientesDeAprobar(usuario);
  }

  @Get('oportunidad/:id')
  deOportunidad(@Param('id', ParseIntPipe) id: number) {
    return this.proformas.deOportunidad(id);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.proformas.obtener(id);
  }

  @Get(':id/eventos')
  eventos(@Param('id', ParseIntPipe) id: number) {
    return this.proformas.eventos(id);
  }

  @Post()
  crear(@Body() body: Record<string, any>, @Usuario() usuario: string) {
    if (!body?.oportunidad) throw new BadRequestException('Falta la oportunidad.');
    return this.proformas.crear(Number(body.oportunidad), usuario, {
      diasDeValidez: body.diasDeValidez ? Number(body.diasDeValidez) : undefined,
      plantilla: body.plantilla || undefined,
    });
  }

  @Patch(':id')
  editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, any>,
    @Usuario() usuario: string,
  ) {
    return this.proformas.editar(id, body ?? {}, usuario);
  }

  @Post(':id/version')
  version(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.proformas.nuevaVersion(id, usuario);
  }

  @Post(':id/pedir-aprobacion')
  @HttpCode(200)
  pedirAprobacion(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.proformas.pedirAprobacion(id, usuario);
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  aprobar(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: string) {
    return this.proformas.aprobar(id, usuario);
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
  enviar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { canal?: string },
    @Usuario() usuario: string,
  ) {
    const canal = body?.canal ?? 'correo';
    if (!(CANALES_DE_ENVIO as readonly string[]).includes(canal)) {
      throw new BadRequestException(`Se manda por ${CANALES_DE_ENVIO.join(' o ')}.`);
    }
    const base = (process.env.URL_PUBLICA || 'http://localhost:3001').replace(/\/+$/, '');
    return this.proformas.enviar(id, base, usuario, canal as CanalDeEnvio);
  }

  @Post(':id/anular')
  @HttpCode(200)
  anular(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { motivo?: string },
    @Usuario() usuario: string,
  ) {
    if (!body?.motivo?.trim()) throw new BadRequestException('Di por qué se anula.');
    return this.proformas.anular(id, body.motivo.trim(), usuario);
  }

  // ------------------------------------------------------------------ vistas

  /**
   * La propuesta como la ve el cliente.
   *
   * Las líneas opcionales llevan una casilla y el total se rehace en la
   * página mientras las marca: es la «propuesta interactiva» del
   * requerimiento. El total que manda es el del servidor al aceptar; el de la
   * página sólo acompaña.
   *
   * Con `imprimir` se abre el diálogo de impresión, que es el PDF: un
   * documento generado en el servidor sería un segundo diseño de la misma
   * proforma que mantener, y acabaría diciendo cosas distintas.
   */
  private pagina(p: any, imprimir = false): string {
    const reemplazada = p.estado === 'reemplazada';
    const cerrada = p.estado === 'aceptada' || p.estado === 'rechazada' || p.estado === 'anulada';
    const vencida = p.estado_visible === 'vencida';
    // Un borrador se abre por aquí para imprimirlo antes de mandarlo, pero no
    // se contesta: el cliente todavía no lo tiene.
    const borrador = p.estado === 'borrador';
    const abierta = !cerrada && !vencida && !reemplazada && !borrador;

    const importe = (l: any) => {
      const bruto = l.cantidad * l.precio_unitario;
      const base = bruto - (bruto * l.descuento_pct) / 100;
      return { base, total: base + (base * l.iva_pct) / 100 };
    };

    const fila = (l: any) => {
      const { base, total } = importe(l);
      const casilla = !l.opcional
        ? ''
        : abierta
          ? `<input type="checkbox" name="opcion" value="${escapar(l.id)}" form="aceptar"
                    data-total="${total.toFixed(2)}" class="opcion">`
          : l.incluida
            ? '✓'
            : '';
      return `
        <tr class="${l.opcional ? 'opcional' : ''}">
          <td>${casilla} ${escapar(l.descripcion)}${l.opcional ? ' <span class="etq">opcional</span>' : ''}</td>
          <td class="n">${l.cantidad}</td>
          <td class="n">${dinero(l.precio_unitario)}</td>
          <td class="n">${l.descuento_pct > 0 ? `${l.descuento_pct}%` : '—'}</td>
          <td class="n">${dinero(base)}</td>
        </tr>`;
    };
    const filas = p.lineas.map(fila).join('');
    const hayOpciones = p.lineas.some((l: any) => l.opcional);

    const motivos = Object.entries(MOTIVOS_DE_RECHAZO)
      .map(([codigo, nombre]) => `<option value="${codigo}">${escapar(nombre)}</option>`)
      .join('');

    const acciones = borrador
      ? `<p class="aviso">Borrador: esta proforma todavía no se ha enviado.</p>`
      : reemplazada
      ? `<p class="aviso">Esta proforma fue reemplazada${
          p.reemplazada_por ? ` por la ${escapar(p.reemplazada_por)}` : ''
        }. Usa el enlace de la versión más reciente.</p>`
      : cerrada
        ? `<p class="aviso">Esta proforma está ${escapar(p.estado)}.</p>`
        : vencida
          ? `<p class="aviso">Esta proforma venció el ${escapar(p.valida_hasta)}. Pide una nueva a tu contacto.</p>`
          : `
        ${hayOpciones ? '<p class="nota-opciones">Marca las opciones que quieras añadir antes de aceptar.</p>' : ''}
        <form id="aceptar" method="post" action="/crm/proformas/ver/${escapar(p.token)}/aceptar" class="acciones">
          <label>Tu nombre<input name="quien" required placeholder="Nombre y apellido"></label>
          <button type="submit">Aceptar la proforma</button>
        </form>
        <details class="rechazo">
          <summary>No me interesa</summary>
          <form method="post" action="/crm/proformas/ver/${escapar(p.token)}/rechazar">
            <label>¿Por qué?<select name="motivo_rechazo">${motivos}</select></label>
            <label>¿Algo más que quieras decirnos?<textarea name="motivo" rows="2"></textarea></label>
            <label>Tu nombre<input name="quien" placeholder="Nombre y apellido"></label>
            <button type="submit" class="secundario">Enviar respuesta</button>
          </form>
        </details>`;

    const script = `
  <script>
    (function () {
      var base = ${Number(p.total).toFixed(2)};
      var casillas = document.querySelectorAll('.opcion');
      var total = document.getElementById('total');
      function rehacer() {
        var suma = base;
        casillas.forEach(function (c) { if (c.checked) suma += Number(c.dataset.total); });
        total.textContent = '$' + suma.toFixed(2);
      }
      casillas.forEach(function (c) { c.addEventListener('change', rehacer); });
      ${imprimir ? "window.addEventListener('load', function () { window.print(); });" : ''}
    })();
  </script>`;

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
    .cabecera { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
    h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
    .meta { color: #475569; font-size: .85rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { text-align: left; font-weight: 500; color: #475569; font-size: .75rem;
         border-bottom: 1px solid #e2e8f0; padding: .4rem 0; }
    td { padding: .5rem 0; border-bottom: 1px solid #f1f5f9; }
    tr.opcional td { color: #334155; background: #f8fafc; }
    .etq { font-size: .7rem; color: #64748b; border: 1px solid #cbd5e1; border-radius: 4px;
           padding: 0 .3rem; margin-left: .3rem; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    .totales { margin-left: auto; width: 16rem; margin-top: 1rem; font-size: .9rem; }
    .totales div { display: flex; justify-content: space-between; padding: .2rem 0; }
    .totales .total { font-weight: 600; font-size: 1.05rem; border-top: 1px solid #e2e8f0;
                      margin-top: .3rem; padding-top: .5rem; }
    .acciones { margin-top: 1rem; display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; }
    label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; color: #475569; }
    input, select, textarea { padding: .5rem; border: 1px solid #cbd5e1; border-radius: 6px;
                              font-size: .9rem; font-family: inherit; }
    input[type=checkbox] { padding: 0; width: 1rem; height: 1rem; vertical-align: middle; }
    button { padding: .55rem 1.1rem; border: 0; border-radius: 6px; background: #1e3a5f;
             color: #fff; font-size: .9rem; cursor: pointer; }
    button.secundario { background: #e2e8f0; color: #0f172a; }
    .pdf { background: none; color: #1e3a5f; border: 1px solid #cbd5e1; padding: .35rem .8rem;
           font-size: .8rem; }
    .aviso { margin-top: 2rem; padding: .75rem 1rem; background: #fef3c7; border-radius: 6px;
             font-size: .9rem; }
    .notas { margin-top: 1.5rem; font-size: .85rem; color: #475569; white-space: pre-line; }
    .nota-opciones { margin-top: 1.5rem; font-size: .85rem; color: #475569; }
    .rechazo { margin-top: 1.5rem; font-size: .85rem; color: #475569; }
    .rechazo summary { cursor: pointer; }
    .rechazo form { display: flex; flex-direction: column; gap: .6rem; margin-top: .75rem; max-width: 24rem; }
    @media (max-width: 40rem) { .hoja { margin: 0; border-radius: 0; padding: 1.25rem; } }
    @media print {
      body { background: #fff; }
      .hoja { border: 0; margin: 0; max-width: none; padding: 0; }
      .acciones, .rechazo, .nota-opciones, .pdf, .aviso, .opcion { display: none; }
    }
  </style>
</head>
<body>
  <div class="hoja">
    <div class="cabecera">
      <div>
        <h1>Proforma ${escapar(p.numero)}</h1>
        <div class="meta">
          ${escapar(p.razon_social)}${p.ruc ? ` · RUC ${escapar(p.ruc)}` : ''}<br>
          ${p.contacto ? `Atención: ${escapar(p.contacto)}<br>` : ''}
          Válida hasta el ${escapar(p.valida_hasta)}
        </div>
      </div>
      <button type="button" class="pdf" onclick="window.print()">Descargar PDF</button>
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
      <div class="total"><span>Total</span><span id="total">${dinero(p.total)}</span></div>
      ${hayOpciones && abierta ? '<div><small>El total suma las opciones que marques, con su IVA.</small></div>' : ''}
    </div>

    ${p.condiciones_pago ? `<div class="notas"><strong>Forma de pago.</strong> ${escapar(p.condiciones_pago)}</div>` : ''}
    ${p.notas ? `<div class="notas">${escapar(p.notas)}</div>` : ''}
    ${p.condiciones ? `<div class="notas">${escapar(p.condiciones)}</div>` : ''}
    ${acciones}
  </div>
  ${script}
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
