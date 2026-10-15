// Guarda el estado compartido (alturas, etc.) en Upstash Redis, conectado desde Vercel > Storage.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// a, b: alturas de los mapas 1 y 2 · c: alturas del plano propio · cc: la ciudad cargada (polígonos y usos)
const KEYS = { a: 'mar-meseta-3d:estado', b: 'mar-meseta-3d:estado-b', c: 'mar-meseta-3d:estado-c', cc: 'mar-meseta-3d:ciudad-c' };
const MAXLEN = { cc: 900000 };

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  const KEY = KEYS[(req.query && req.query.map) || 'a'];
  if (!KEY) return res.status(400).json({ error: 'mapa' });
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'Falta conectar la base de datos' });
  try {
    if (req.method === 'GET') {
      const json = await redis(['GET', KEY]);
      return res.status(200).json({ json: json || null });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body.json !== 'string' || body.json.length > (MAXLEN[(req.query && req.query.map) || 'a'] || 200000)) return res.status(400).json({ error: 'bad' });
      JSON.parse(body.json);
      await redis(['SET', KEY, body.json]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
