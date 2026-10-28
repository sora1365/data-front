import { escaparHtml as e } from './tickets.service';

/**
 * Las páginas que ve el cliente: el formulario de soporte y la encuesta.
 *
 * Son HTML servido por el back, como la proforma y la encuesta de postventa:
 * quien las abre no tiene cuenta en el CRM, y montar el front entero para un
 * formulario de cinco campos es mandarle dos megas a alguien que sólo quiere
 * avisar de que algo no funciona.
 */

const ESTILO = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
  .hoja { max-width: 34rem; margin: 2rem auto; background: #fff; padding: 2rem;
          border: 1px solid #d4d8e0; border-radius: 10px; }
  @media (max-width: 36rem) { .hoja { margin: 0; border-radius: 0; border-width: 0 0 1px; } }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  p.sub { color: #475569; font-size: .9rem; margin: 0 0 1.5rem; }
  label.campo { display: block; font-size: .8rem; color: #475569; margin-bottom: 1rem; }
  input[type=text], input[type=email], select, textarea { width: 100%; box-sizing: border-box;
    padding: .6rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: .95rem;
    font-family: inherit; margin-top: .25rem; background: #fff; }
  button { margin-top: .5rem; padding: .6rem 1.2rem; border: 0; border-radius: 6px;
           background: #1e3a5f; color: #fff; font-size: .95rem; cursor: pointer; }
  .trampa { position: absolute; left: -10000px; }
  .notas { display: flex; gap: .4rem; margin-bottom: 1.5rem; }
  .nota input { position: absolute; opacity: 0; }
  .nota span { display: grid; place-items: center; min-width: 4.5rem; padding: .6rem .4rem;
               border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; font-size: .8rem;
               text-align: center; }
  .nota b { display: block; font-size: 1.2rem; }
  .nota input:checked + span { background: #1e3a5f; color: #fff; border-color: #1e3a5f; }
  .caja { text-align: center; }
`;

function documento(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${e(titulo)}</title>
  <style>${ESTILO}</style>
</head>
<body><div class="hoja">${cuerpo}</div></body>
</html>`;
}

export function paginaMensaje(titulo: string, mensaje: string): string {
  return documento(titulo, `<div class="caja"><h1>${e(titulo)}</h1><p class="sub">${mensaje}</p></div>`);
}

/**
 * El formulario de soporte.
 *
 * Sin «prioridad»: si se deja elegir, todo llega como urgente. La pone quien
 * atiende, y el tipo —queja o reclamo— ya la sube sola.
 */
export function paginaSoporte(accion: string): string {
  return documento(
    'Soporte',
    `
    <h1>¿En qué te ayudamos?</h1>
    <p class="sub">Te respondemos al correo que pongas aquí, con un número de solicitud.</p>
    <form method="post" action="${e(accion)}">
      <input type="hidden" name="abierto_en" value="${Date.now()}">
      <label class="trampa">No rellenar <input type="text" name="sitio_web_hp" tabindex="-1" autocomplete="off"></label>

      <label class="campo">Tu nombre
        <input type="text" name="nombre" required maxlength="120" autocomplete="name"></label>
      <label class="campo">Correo
        <input type="email" name="correo" required maxlength="200" autocomplete="email"></label>
      <label class="campo">Teléfono (opcional)
        <input type="text" name="telefono" maxlength="40" autocomplete="tel"></label>
      <label class="campo">RUC de tu empresa (opcional, nos ayuda a encontrarte)
        <input type="text" name="ruc" maxlength="13" inputmode="numeric"></label>
      <label class="campo">Qué necesitas
        <select name="tipo">
          <option value="consulta">Una consulta</option>
          <option value="solicitud">Pedir algo (un documento, un cambio)</option>
          <option value="incidencia">Algo no funciona</option>
          <option value="queja">Una queja</option>
          <option value="reclamo">Un reclamo (devolución, corrección)</option>
        </select></label>
      <label class="campo">Asunto
        <input type="text" name="asunto" required maxlength="200"></label>
      <label class="campo">Cuéntanos
        <textarea name="descripcion" rows="5" maxlength="5000"></textarea></label>

      <button type="submit">Enviar</button>
    </form>`,
  );
}

/** La encuesta de satisfacción: cinco botones y un comentario. */
export function paginaCsat(t: { id: number; asunto: string }, accion: string): string {
  const opciones: [number, string][] = [
    [1, 'Muy mal'],
    [2, 'Mal'],
    [3, 'Regular'],
    [4, 'Bien'],
    [5, 'Muy bien'],
  ];
  const botones = opciones
    .map(
      ([n, txt]) => `
      <label class="nota"><input type="radio" name="puntaje" value="${n}" required>
        <span><b>${n}</b>${txt}</span></label>`,
    )
    .join('');
  return documento(
    '¿Te resolvimos?',
    `
    <h1>¿Qué tal te atendimos?</h1>
    <p class="sub">Solicitud #${t.id} · ${e(t.asunto)}</p>
    <form method="post" action="${e(accion)}">
      <div class="notas">${botones}</div>
      <label class="campo">¿Algo que debamos saber? (opcional)
        <textarea name="comentario" rows="3" maxlength="2000"></textarea></label>
      <button type="submit">Enviar</button>
    </form>`,
  );
}
