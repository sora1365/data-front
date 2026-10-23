/**
 * La página pública de un formulario.
 *
 * Es HTML servido por el propio API y no una pantalla del CRM: quien la abre
 * no tiene cuenta, la página se incrusta en webs ajenas con un `<iframe>`, y
 * así el envío va al mismo origen que la sirvió. Con un `fetch` desde la web
 * del cliente haría falta abrir CORS a cualquier dominio, y eso no se abre
 * para todo el API por un formulario.
 *
 * Funciona sin JavaScript: el envío es un `<form>` normal y los errores
 * vuelven pintados en la misma página. El JavaScript sólo añade lo que no es
 * imprescindible —ocultar campos condicionales, medir la prisa del robot y
 * avisar al `<iframe>` de su altura.
 */
import { CampoFormulario, campoVisible } from './leads.reglas';

export function escapar(texto: unknown): string {
  return String(texto ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Los parámetros de origen que la página recoge y reenvía con el formulario. */
const OCULTOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'pagina'];

const ESTILO = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         background: transparent; color: #0f172a; }
  .caja { max-width: 32rem; margin: 0 auto; padding: 1.25rem; background: #fff;
          border: 1px solid #d4d8e0; border-radius: 10px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .desc { color: #475569; font-size: .9rem; margin: 0 0 1rem; }
  .campo { display: flex; flex-direction: column; gap: .3rem; margin-bottom: .85rem; }
  label { font-size: .85rem; font-weight: 600; }
  .req { color: #b91c1c; }
  input[type=text], input[type=email], input[type=tel], textarea, select {
    font: inherit; font-size: .95rem; padding: .55rem .65rem; border: 1px solid #cbd5e1;
    border-radius: 6px; width: 100%; background: #fff; color: inherit; }
  textarea { min-height: 6rem; resize: vertical; }
  .casilla { flex-direction: row; align-items: flex-start; gap: .5rem; font-weight: 400; }
  .casilla label { font-weight: 400; }
  .consent { font-size: .78rem; color: #475569; }
  .errores { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
             border-radius: 6px; padding: .6rem .8rem; font-size: .85rem; margin-bottom: 1rem; }
  .errores ul { margin: 0; padding-left: 1.1rem; }
  button { font: inherit; font-weight: 600; background: #1e3a5f; color: #fff; border: 0;
           border-radius: 6px; padding: .65rem 1.2rem; cursor: pointer; width: 100%; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .gracias { text-align: center; padding: 1.5rem .5rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; }
    .caja { background: #0f172a; border-color: #334155; }
    .desc, .consent { color: #94a3b8; }
    input[type=text], input[type=email], input[type=tel], textarea, select {
      background: #1e293b; border-color: #334155; }
  }
`;

/** Avisa al `<iframe>` que la contiene de la altura, para no mostrar barra de scroll. */
const SCRIPT_ALTURA = `
  function avisar() {
    try { parent.postMessage({ friday_formulario: location.pathname, alto: document.body.scrollHeight }, '*'); } catch (e) {}
  }
  addEventListener('load', avisar);
  addEventListener('resize', avisar);
`;

function control(campo: CampoFormulario, valor: string, oculto: boolean): string {
  const id = `c_${campo.clave}`;
  // Un obligatorio que se pinta oculto no lleva `required`, o sin JavaScript
  // el navegador no dejaría enviar; el script se lo devuelve al mostrarlo.
  const req = campo.obligatorio ? (oculto ? ' data-req="1"' : ' required') : '';
  const nombre = `name="${escapar(campo.clave)}" id="${id}"`;
  switch (campo.tipo) {
    case 'area':
      return `<textarea ${nombre}${req}>${escapar(valor)}</textarea>`;
    case 'seleccion':
      return `<select ${nombre}${req}><option value="">Elige una opción</option>${(campo.opciones ?? [])
        .map(
          (o) =>
            `<option value="${escapar(o)}"${o === valor ? ' selected' : ''}>${escapar(o)}</option>`,
        )
        .join('')}</select>`;
    case 'correo':
      return `<input type="email" autocomplete="email" ${nombre} value="${escapar(valor)}"${req}>`;
    case 'telefono':
      return `<input type="tel" autocomplete="tel" ${nombre} value="${escapar(valor)}"${req}>`;
    default:
      return `<input type="text" ${nombre} value="${escapar(valor)}"${req}>`;
  }
}

function bloqueCampo(campo: CampoFormulario, respuestas: Record<string, unknown>): string {
  const valor = String(respuestas[campo.clave] ?? '');
  const oculto = !campoVisible(campo, respuestas);
  const condicion = campo.mostrarSi
    ? ` data-si-campo="${escapar(campo.mostrarSi.campo)}" data-si-valor="${escapar(campo.mostrarSi.valor)}"`
    : '';
  const estilo = oculto ? ' style="display:none"' : '';
  const marca = campo.obligatorio ? ' <span class="req">*</span>' : '';

  if (campo.tipo === 'casilla') {
    const marcado = ['on', 'true', '1', 'sí', 'si'].includes(valor.toLowerCase()) ? ' checked' : '';
    return `<div class="campo casilla"${condicion}${estilo}>
      <input type="checkbox" name="${escapar(campo.clave)}" id="c_${escapar(campo.clave)}"${marcado}${
        campo.obligatorio ? ' required' : ''
      }>
      <label for="c_${escapar(campo.clave)}">${escapar(campo.etiqueta)}${marca}</label></div>`;
  }
  return `<div class="campo"${condicion}${estilo}>
    <label for="c_${escapar(campo.clave)}">${escapar(campo.etiqueta)}${marca}</label>
    ${control(campo, valor, oculto)}</div>`;
}

/**
 * Oculta y muestra los campos condicionales al vuelo.
 *
 * Un campo oculto pierde el `required`, o el navegador no dejaría enviar un
 * formulario con un obligatorio que no se ve. El servidor aplica la misma
 * regla (`campoVisible`), así que sin JavaScript se exige lo mismo.
 */
const SCRIPT_CONDICIONES = `
  var form = document.querySelector('form');
  function valorDe(nombre) {
    var el = form.elements[nombre];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'sí' : '';
    return el.value;
  }
  function aplicar() {
    document.querySelectorAll('[data-si-campo]').forEach(function (bloque) {
      var visible = valorDe(bloque.dataset.siCampo) === bloque.dataset.siValor;
      bloque.style.display = visible ? '' : 'none';
      bloque.querySelectorAll('input,select,textarea').forEach(function (el) {
        if (visible && el.dataset.req) el.required = true;
        if (!visible) { if (el.required) el.dataset.req = '1'; el.required = false; }
      });
    });
    avisar();
  }
  form.addEventListener('input', aplicar);
  form.addEventListener('change', aplicar);
  aplicar();
  form.elements['abierto_en'].value = String(Date.now());
`;

export function paginaFormulario(
  formulario: {
    slug: string;
    nombre: string;
    titulo?: string | null;
    descripcion?: string | null;
    campos: CampoFormulario[];
    texto_consentimiento: string;
    redirigir_a?: string | null;
  },
  respuestas: Record<string, unknown>,
  errores: string[] = [],
): string {
  const ocultos = OCULTOS.map(
    (k) => `<input type="hidden" name="${k}" value="${escapar(respuestas[k] ?? '')}">`,
  ).join('');
  const consentido = ['on', 'true', '1'].includes(String(respuestas.consentimiento ?? ''));

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapar(formulario.titulo || formulario.nombre)}</title>
  <style>${ESTILO}</style>
</head>
<body>
  <div class="caja">
    ${formulario.titulo ? `<h1>${escapar(formulario.titulo)}</h1>` : ''}
    ${formulario.descripcion ? `<p class="desc">${escapar(formulario.descripcion)}</p>` : ''}
    ${
      errores.length
        ? `<div class="errores" role="alert"><ul>${errores.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul></div>`
        : ''
    }
    <form method="post" accept-charset="utf-8" action="/crm/publico/f/${escapar(formulario.slug)}"${
      formulario.redirigir_a ? ' target="_top"' : ''
    }>
      ${formulario.campos.map((c) => bloqueCampo(c, respuestas)).join('\n')}
      <div class="campo casilla">
        <input type="checkbox" name="consentimiento" id="c_consentimiento"${consentido ? ' checked' : ''}>
        <label for="c_consentimiento" class="consent">${escapar(formulario.texto_consentimiento)}</label>
      </div>
      <div class="hp" aria-hidden="true">
        <label>No rellenar <input type="text" name="sitio_web_hp" tabindex="-1" autocomplete="off"></label>
      </div>
      <input type="hidden" name="abierto_en" value="">
      ${ocultos}
      <button type="submit">Enviar</button>
    </form>
  </div>
  <script>${SCRIPT_ALTURA}${SCRIPT_CONDICIONES}</script>
</body>
</html>`;
}

export function paginaGracias(mensaje: string | null | undefined): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Gracias</title>
  <style>${ESTILO}</style>
</head>
<body>
  <div class="caja gracias">
    <h1>¡Gracias!</h1>
    <p class="desc">${escapar(mensaje || 'Recibimos tus datos. Te contactaremos muy pronto.')}</p>
  </div>
  <script>${SCRIPT_ALTURA}</script>
</body>
</html>`;
}

export function paginaNoDisponible(): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Formulario no disponible</title><style>${ESTILO}</style></head>
<body><div class="caja gracias"><h1>Formulario no disponible</h1>
<p class="desc">Este formulario ya no recibe respuestas.</p></div></body></html>`;
}
