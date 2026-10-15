/* Panel "Render con IA": toma la vista del modelo y la manda a /api/render (que prueba varios proveedores gratuitos). */
(function () {
  'use strict';
  var aside = document.querySelector('aside.panel');
  if (!aside) return;
  var CODE_KEY = 'render-code-v1', busy = false, cool = 0;
  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var sec = document.createElement('section'); sec.id = 'render-ia';
  sec.innerHTML =
    '<h2>Render con IA</h2>' +
    '<p class="lead">Convierte la vista que elijas en una imagen realista. Usa servicios gratuitos y tiene un tope diario para el grupo, así no se gastan los créditos.</p>' +
    '<div class="ctl" style="grid-template-columns:1fr"><label for="rn-view">Vista que se manda</label><select id="rn-view"></select></div>' +
    '<div class="ctl" style="grid-template-columns:1fr"><label for="rn-style">Estilo</label><select id="rn-style">' +
    '<option value="mediodia">Mediodía, cielo despejado</option><option value="atardecer">Atardecer cálido</option><option value="nublado">Día nublado, foto de arquitectura</option>' +
    '<option value="maqueta">Maqueta blanca de estudio</option><option value="boceto">Boceto acuarela y lápiz</option></select></div>' +
    '<div class="ctl" style="grid-template-columns:1fr"><label for="rn-note">Indicaciones (opcional)</label>' +
    '<textarea id="rn-note" rows="3" maxlength="500" placeholder="Ej: mar turquesa, árboles en las avenidas, edificios de hormigón claro" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:6px 8px;color:inherit;font:inherit;resize:vertical"></textarea></div>' +
    '<label class="chk" style="margin-bottom:10px"><input type="checkbox" id="rn-ref" checked> Mandar también la planta como referencia</label>' +
    '<div class="ctl" id="rn-codebox" style="grid-template-columns:1fr" hidden><label for="rn-code">Código del grupo</label>' +
    '<input type="password" id="rn-code" autocomplete="off" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:6px 8px;color:inherit;font:inherit"></div>' +
    '<div class="exp"><button class="btn" type="button" id="rn-go" style="background:var(--accent);color:var(--accent-ink);border-color:var(--accent)">Generar render</button></div>' +
    '<p class="note" id="rn-info" aria-live="polite" style="margin-top:8px"></p>' +
    '<figure id="rn-out" hidden style="margin:10px 0 0"><img id="rn-img" alt="Render generado con IA" style="width:100%;height:auto;display:block;border:1px solid var(--line);background:#fff">' +
    '<div class="exp" style="margin-top:6px"><a class="btn" id="rn-dl" download="render.png">Descargar</a><a class="btn" id="rn-open" target="_blank" rel="noopener">Abrir grande</a></div>' +
    '<p class="note" id="rn-prov" style="margin-top:4px"></p></figure>';
  var note = aside.querySelector('p.note:last-child');
  aside.insertBefore(sec, note || null);

  function info(t, err) { var e = $('rn-info'); e.textContent = t || ''; e.style.color = err ? '#b3261e' : ''; }
  function fillViews() {
    var api = window.__shotApi, s = $('rn-view');
    if (!api || s.options.length) return;
    Object.keys(api.names).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = api.names[k]; s.appendChild(o); });
  }
  var obs = setInterval(function () { if (window.__shotApi) { fillViews(); clearInterval(obs); } }, 400);

  var status = null;
  function loadStatus() {
    fetch('/api/render', { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok) { info(x.j && x.j.error || 'El render no está disponible.', true); return; }
      status = x.j;
      $('rn-codebox').hidden = !x.j.needCode;
      if (x.j.needCode && !$('rn-code').value) $('rn-code').value = lsGet(CODE_KEY);
      if (!x.j.configured.length) { info('Todavía no hay ningún proveedor conectado (ver README para cargar las claves gratuitas).', true); return; }
      info('Proveedores: ' + x.j.configured.map(function (p) { return p.name; }).join(' → ') + '. Hoy quedan ' + x.j.meLeft + ' renders para vos y ' + x.j.totalLeft + ' para el grupo.');
    }).catch(function () { info('No se pudo consultar el servicio de render.', true); });
  }
  loadStatus();

  function shrink(url, max, q) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      im.onerror = rej; im.src = url;
    });
  }

  $('rn-go').addEventListener('click', function () {
    var api = window.__shotApi;
    if (busy) return;
    if (!api) { info('Primero cargá un plano para tener un modelo.', true); return; }
    if (Date.now() < cool) { info('Esperá unos segundos entre un render y otro.', true); return; }
    var code = $('rn-code').value; if (!$('rn-codebox').hidden) lsSet(CODE_KEY, code);
    busy = true; $('rn-go').disabled = true; info('Preparando la imagen…');
    var view = $('rn-view').value || 'cur', withRef = $('rn-ref').checked && view !== 'plan';
    var main, ref = null, small;
    try {
      main = api.capture(view); if (withRef) ref = api.capture('plan');
    } catch (e) { busy = false; $('rn-go').disabled = false; info('No se pudo capturar la vista.', true); return; }
    Promise.all([shrink(main, 1024, 0.86), ref ? shrink(ref, 768, 0.82) : Promise.resolve(null), shrink(main, 512, 0.9)]).then(function (im) {
      info('Generando el render… puede tardar hasta un minuto.');
      return fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: im[0], ref: im[1], small: im[2], style: $('rn-style').value, note: $('rn-note').value, code: code }) });
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok) {
        var d = x.j && x.j.detail && x.j.detail.length ? ' (' + x.j.detail.join(' · ') + ')' : '';
        if (x.j && x.j.needCode) { $('rn-codebox').hidden = false; }
        info((x.j && x.j.error || 'No se pudo generar.') + d, true); return;
      }
      $('rn-img').src = x.j.image; $('rn-out').hidden = false;
      var fn = 'render-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + (/image\/jpeg/.test(x.j.image) ? 'jpg' : 'png');
      $('rn-dl').href = x.j.image; $('rn-dl').download = fn; $('rn-open').href = x.j.image;
      $('rn-prov').textContent = 'Generado con ' + x.j.provider + '. Quedan ' + x.j.totalLeft + ' renders hoy para el grupo. Es una interpretación: revisá que respete tu plano.';
      info('');
      cool = Date.now() + 15000; loadStatus();
    }).catch(function () { info('Falló la conexión con el servicio de render.', true); }).then(function () { busy = false; $('rn-go').disabled = false; });
  });
})();
