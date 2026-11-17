// POST /api/db — consultas do site e do painel (mesmas regras de acesso do banco anterior).
// POST /api/rpc — funções (estatísticas, busca pelo rosto etc.).
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { runQuery, rpc } from '../lib/db.mjs';
import { adminFromRequest } from '../lib/auth.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  const admin = await adminFromRequest(req);
  const role = admin ? (['owner', 'photographer'].includes(admin.role) ? admin.role : 'admin') : 'public';
  const body = await readJson(req);
  if (new URL(req.url).pathname.endsWith('/rpc')) {
    return json(200, { data: await rpc(String(body.name || ''), body.args || {}, role, admin) });
  }
  const q = {
    table: String(body.table || ''), op: body.op || 'select', select: body.select, filters: Array.isArray(body.filters) ? body.filters : [],
    order: body.order, range: body.range, limit: body.limit, head: body.head, values: body.values, onConflict: body.onConflict
  };
  const r = await runQuery(q, role, admin);
  // Leituras públicas podem ficar alguns segundos no cache do Netlify (economiza créditos).
  const cache = role === 'public' && q.op === 'select' ? { 'Netlify-CDN-Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' } : {};
  return json(200, r, cache);
});

export const config = { path: ['/api/db', '/api/rpc'] };
