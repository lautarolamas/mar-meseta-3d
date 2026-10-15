// Render con IA: manda la vista del modelo a un generador de imágenes gratuito.
// Prueba varios proveedores en orden y cuenta los usos por día en Redis, para no gastar los créditos.
//
// Variables de entorno (todas opcionales; se usan los proveedores que tengan clave):
//   GEMINI_API_KEY            clave de Google AI Studio          (RENDER_CAP_GEMINI, por día, por defecto 20)
//   GEMINI_MODEL              por defecto gemini-2.5-flash-image
//   CF_ACCOUNT_ID, CF_API_TOKEN   Cloudflare Workers AI           (RENDER_CAP_CF, por defecto 40)
//   CF_MODEL                  por defecto @cf/runwayml/stable-diffusion-v1-5-img2img
//   STABILITY_API_KEY         Stability AI                        (RENDER_CAP_STABILITY, por defecto 3)
//   RENDER_ORDER              orden de prueba, por defecto gemini,stability,cf
//   RENDER_CODE               código de acceso del grupo (recomendado: sin él, cualquiera con el link puede gastar créditos)
//   RENDER_CAP_TOTAL          tope diario entre todos, por defecto 30
//   RENDER_CAP_IP             tope diario por persona (IP), por defecto 8
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const num = (k, d) => { const n = parseInt(process.env[k], 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const day = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // día de Argentina

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}
async function incr(key) { const n = await redis(['INCR', key]); if (n === 1) await redis(['EXPIRE', key, 172800]); return n; }
const decr = (key) => redis(['DECR', key]).catch(() => {});

/* ---------- prompt ---------- */
const BASE =
  'Turn this 3D massing model of a coastal city into a photorealistic architectural render. ' +
  'Keep EXACTLY the same layout, street grid, block footprints, building heights, proportions and camera angle as the reference image. ' +
  'Do not add, remove, merge, move or resize any building or block. Do not extend the city beyond the edges shown in the reference. ' +
  'The sea, beach and open areas must appear only where they appear in the reference. ' +
  'Colors in the reference are land uses: keep each colored zone as the same kind of urban fabric (for example yellow = low-rise residential, red = taller commercial, blue = civic or institutional, purple = light industry, green = parks, dark green = boulevard, beige = beach, blue = sea). ' +
  'Add realistic facades, roofs, trees, streets, pavement, cars and people at a believable scale. ';
const STYLES = {
  atardecer: 'Golden hour light, warm sun low over the horizon, long soft shadows, calm sea.',
  mediodia: 'Clear midday sun, blue sky with few clouds, crisp shadows, turquoise sea.',
  maqueta: 'Architectural scale model look: white and light-wood cardboard volumes, soft studio lighting, subtle shadows, neutral background.',
  boceto: 'Architectural concept rendering with a light watercolor and pencil feel, soft colors, visible linework, loose vegetation.',
  nublado: 'Soft overcast daylight, even lighting, realistic muted colors, documentary architectural photography.',
};
function buildPrompt(style, note, hasRef) {
  let p = BASE + (STYLES[style] || STYLES.mediodia);
  if (hasRef) p += ' The second image is the top-down plan of the same city: use it to understand the exact layout and where the sea is.';
  note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (note) p += ' Extra instructions from the user (do not break the rules above): ' + note;
  return p;
}

/* ---------- proveedores ---------- */
const split = (d) => { const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(d); return m ? { mime: m[1], b64: m[2] } : null; };
const fail = (provider, status, text) => { const e = new Error(provider + ' ' + status + ': ' + String(text || '').replace(/\s+/g, ' ').slice(0, 140)); e.status = status; return e; };

async function gemini(job) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const parts = [{ text: job.prompt }, { inline_data: { mime_type: job.image.mime, data: job.image.b64 } }];
  if (job.ref) parts.push({ inline_data: { mime_type: job.ref.mime, data: job.ref.b64 } });
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  });
  const txt = await r.text();
  if (!r.ok) throw fail('gemini', r.status, txt);
  let j; try { j = JSON.parse(txt); } catch (e) { throw fail('gemini', 502, 'respuesta ilegible'); }
  const ps = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const img = ps.map((p) => p.inlineData || p.inline_data).find((x) => x && x.data);
  if (!img) throw fail('gemini', 422, 'no devolvió imagen (¿filtro de contenido?)');
  return 'data:' + (img.mimeType || img.mime_type || 'image/png') + ';base64,' + img.data;
}

async function cloudflare(job) {
  const model = process.env.CF_MODEL || '@cf/runwayml/stable-diffusion-v1-5-img2img';
  const small = job.small || job.image;
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/run/' + model, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.CF_API_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: job.short, negative_prompt: 'distorted, extra buildings, missing buildings, blurry, text, watermark',
      image_b64: small.b64, strength: 0.55, guidance: 7.5, num_steps: 20,
    }),
  });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) throw fail('cloudflare', r.status, await r.text());
  if (ct.indexOf('image/') === 0) return 'data:' + ct.split(';')[0] + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
  const j = await r.json().catch(() => null);
  const b64 = j && j.result && (j.result.image || j.result.image_b64);
  if (!b64) throw fail('cloudflare', 422, 'sin imagen en la respuesta');
  return 'data:image/png;base64,' + b64;
}

async function stability(job) {
  const fd = new FormData();
  fd.append('image', new Blob([Buffer.from(job.image.b64, 'base64')], { type: job.image.mime }), 'modelo.jpg');
  fd.append('prompt', job.short);
  fd.append('control_strength', '0.75');
  fd.append('output_format', 'jpeg');
  const r = await fetch('https://api.stability.ai/v2beta/stable-image/control/structure', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STABILITY_API_KEY, Accept: 'image/*' }, body: fd,
  });
  if (!r.ok) throw fail('stability', r.status, await r.text());
  return 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
}

const PROVIDERS = {
  gemini:    { name: 'Google Gemini',    ok: () => !!process.env.GEMINI_API_KEY,                              cap: () => num('RENDER_CAP_GEMINI', 20),    run: gemini },
  stability: { name: 'Stability AI',     ok: () => !!process.env.STABILITY_API_KEY,                           cap: () => num('RENDER_CAP_STABILITY', 3),  run: stability },
  cf:        { name: 'Cloudflare (SD 1.5)', ok: () => !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN), cap: () => num('RENDER_CAP_CF', 40),        run: cloudflare },
};
const order = () => (process.env.RENDER_ORDER || 'gemini,stability,cf').split(',').map((s) => s.trim()).filter((k) => PROVIDERS[k]);
const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket && req.socket.remoteAddress || 'x').trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = order().filter((k) => PROVIDERS[k].ok());
  const needCode = !!process.env.RENDER_CODE;
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'Falta conectar la base de datos (sirve para contar los usos diarios).' });
  const D = day();

  try {
    if (req.method === 'GET') {
      const out = [];
      for (const k of configured) {
        const used = parseInt(await redis(['GET', 'render:' + D + ':p:' + k]), 10) || 0;
        out.push({ id: k, name: PROVIDERS[k].name, left: Math.max(0, PROVIDERS[k].cap() - used), cap: PROVIDERS[k].cap() });
      }
      const tot = parseInt(await redis(['GET', 'render:' + D + ':total']), 10) || 0;
      const me = parseInt(await redis(['GET', 'render:' + D + ':ip:' + ipOf(req)]), 10) || 0;
      return res.status(200).json({ configured: out, needCode, totalLeft: Math.max(0, num('RENDER_CAP_TOTAL', 30) - tot), meLeft: Math.max(0, num('RENDER_CAP_IP', 8) - me) });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (needCode && String(b.code || '') !== process.env.RENDER_CODE) return res.status(401).json({ error: 'El código no es correcto.', needCode: true });
    if (!configured.length) return res.status(503).json({ error: 'Todavía no hay ningún proveedor de render configurado. Mirá el README.' });
    const image = split(b.image || ''), ref = b.ref ? split(b.ref) : null, small = b.small ? split(b.small) : null;
    if (!image || b.image.length > 3500000 || (b.ref && (!ref || b.ref.length > 3500000))) return res.status(400).json({ error: 'La imagen no es válida o es muy pesada.' });

    const ip = ipOf(req), kIp = 'render:' + D + ':ip:' + ip, kTot = 'render:' + D + ':total';
    const gate = await redis(['SET', 'render:cool:' + ip, '1', 'EX', 15, 'NX']);
    if (gate !== 'OK') return res.status(429).json({ error: 'Esperá unos segundos entre un render y otro.' });
    if ((await incr(kIp)) > num('RENDER_CAP_IP', 8)) { await decr(kIp); return res.status(429).json({ error: 'Llegaste al tope de renders de hoy para esta conexión.' }); }
    if ((await incr(kTot)) > num('RENDER_CAP_TOTAL', 30)) { await decr(kTot); await decr(kIp); return res.status(429).json({ error: 'El grupo llegó al tope de renders de hoy. Se renueva a medianoche.' }); }

    const prompt = buildPrompt(b.style, b.note, !!ref);
    const job = { prompt, short: prompt.slice(0, 1500), image, ref, small };
    const errors = [];
    for (const k of configured) {
      const P = PROVIDERS[k], kP = 'render:' + D + ':p:' + k, kOff = 'render:off:' + k;
      if (await redis(['GET', kOff])) { errors.push(P.name + ': en pausa'); continue; }
      if ((await incr(kP)) > P.cap()) { await decr(kP); errors.push(P.name + ': sin cupo hoy'); continue; }
      try {
        const out = await P.run(job);
        const left = Math.max(0, num('RENDER_CAP_TOTAL', 30) - (parseInt(await redis(['GET', kTot]), 10) || 0));
        return res.status(200).json({ image: out, provider: P.name, totalLeft: left });
      } catch (e) {
        await decr(kP);
        errors.push(String(e.message || e).slice(0, 160));
        if (e.status === 429 || e.status === 402 || e.status === 403) await redis(['SET', kOff, '1', 'EX', 900]).catch(() => {});
      }
    }
    await decr(kTot); await decr(kIp);
    return res.status(502).json({ error: 'Ningún proveedor pudo generar el render ahora.', detail: errors });
  } catch (e) {
    return res.status(500).json({ error: 'Error del servidor.' });
  }
};
