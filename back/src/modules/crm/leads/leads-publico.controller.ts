import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsService } from './leads.service';
import { paginaFormulario, paginaGracias, paginaNoDisponible } from './formulario.html';

/**
 * Lo que ve quien deja sus datos: sin cuenta, sin `X-Usuario`.
 *
 * Es la única puerta del CRM que escribe sin firma, así que no acepta nada
 * que no esté en la definición del formulario (ver `validarEnvio`) y nunca
 * dice si quien envía ya estaba en la base: «gracias» es la misma respuesta
 * para un lead nuevo, para uno repetido y para un robot. Contestar distinto
 * permitiría averiguar quién es cliente probando correos.
 */
@Controller('crm/publico/f')
export class LeadsPublicoController {
  constructor(private readonly leads: LeadsService) {}

  @Get(':slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async pagina(
    @Param('slug') slug: string,
    @Query() consulta: Record<string, string>,
    @Headers('referer') referente: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const formulario = await this.leads.formularioPublico(slug);
      await this.leads.contarVista(Number(formulario.id));
      // Abierto directamente (un QR, un enlace en una historia) no hay
      // `pagina` en la consulta, pero sí puede haber `Referer`.
      return paginaFormulario(formulario, {
        ...consulta,
        pagina: consulta.pagina || referente || '',
      });
    } catch {
      res.status(404);
      return paginaNoDisponible();
    }
  }

  /**
   * La definición en JSON, para quien prefiera pintar el formulario con su
   * propio diseño y mandar el envío como JSON a la misma dirección.
   */
  @Get(':slug/definicion')
  async definicion(@Param('slug') slug: string) {
    const f = await this.leads.formularioPublico(slug);
    return {
      slug: f.slug,
      titulo: f.titulo,
      descripcion: f.descripcion,
      campos: f.campos,
      texto_consentimiento: f.texto_consentimiento,
    };
  }

  /**
   * El envío. Acepta el `<form>` de la página (urlencoded) y JSON.
   *
   * Con el `<form>` devuelve HTML —la página de gracias, la redirección o el
   * mismo formulario con los errores y lo que ya se escribió—; con JSON
   * devuelve JSON. Siempre 200 en lo que valida, para que el navegador no
   * enseñe una página de error a quien sólo olvidó un campo.
   */
  @Post(':slug')
  @HttpCode(200)
  async enviar(
    @Param('slug') slug: string,
    @Body() cuerpo: Record<string, unknown>,
    @Headers('content-type') tipo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const comoJson = (tipo ?? '').includes('application/json');
    let resultado: Awaited<ReturnType<LeadsService['recibirEnvio']>>;
    try {
      resultado = await this.leads.recibirEnvio(slug, cuerpo ?? {});
    } catch {
      res.status(404);
      if (comoJson) return { ok: false, errores: ['Este formulario ya no recibe respuestas.'] };
      res.type('html');
      return paginaNoDisponible();
    }

    if (comoJson) {
      return resultado.ok
        ? { ok: true, mensaje: resultado.formulario.mensaje_gracias ?? null }
        : { ok: false, errores: resultado.errores };
    }

    res.type('html');
    if (!resultado.ok) {
      return paginaFormulario(resultado.formulario, cuerpo ?? {}, resultado.errores);
    }
    if (resultado.formulario.redirigir_a) {
      res.redirect(303, resultado.formulario.redirigir_a);
      return;
    }
    return paginaGracias(resultado.formulario.mensaje_gracias);
  }
}
