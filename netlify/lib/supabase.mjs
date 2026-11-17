// Acesso ao Supabase com a chave de servidor (service role / secret key).
// Esta chave só existe nas variáveis de ambiente do Netlify — nunca no navegador.
// Sem SUPABASE_URL, tudo roda no próprio Netlify (Netlify Blobs) com as mesmas funções.
import { env, HttpError } from './http.mjs';
import { restLocal } from './db.mjs';
import { adminFromRequest, fileToken } from './auth.mjs';

export const USE_SUPABASE = Boolean((process.env.SUPABASE_URL || '').trim());

function base() {
  return env('SUPABASE_URL').replace(/\/+$/, '');
}

function serviceHeaders(extra = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // Chaves novas (sb_secret_...) vão só no header apikey; chaves JWT antigas também no Authorization.
  if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!USE_SUPABASE) return restLocal(path, { method, body, prefer });
  const res = await fetch(`${base()}/rest/v1/${path}`, {
    method,
    headers: serviceHeaders(prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await parse(res);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    throw new HttpError(502, `Banco de dados: ${msg}`);
  }
  return data;
}

export function publicUrl(bucket, path) {
  if (!path) return null;
  if (!USE_SUPABASE) return `/api/img/${path.split('/').map(encodeURIComponent).join('/')}`;
  return `${base()}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// Gera links temporários (privados) para baixar os originais comprados.
export async function signOriginals(paths, expiresIn = 3600) {
  if (!paths.length) return [];
  if (!USE_SUPABASE) {
    return Promise.all(paths.map(async (p) => ({ path: p, url: `/api/file?t=${await fileToken('originals', p, expiresIn)}`, error: null })));
  }
  const res = await fetch(`${base()}/storage/v1/object/sign/originals`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn, paths })
  });
  const data = await parse(res);
  if (!res.ok || !Array.isArray(data)) {
    throw new HttpError(502, 'Não foi possível gerar os links de download.');
  }
  return data.map((d) => ({
    path: d.path,
    url: d.signedURL ? `${base()}/storage/v1${d.signedURL}` : null,
    error: d.error || null
  }));
}

// Confere o login de um membro da equipe (token do Supabase Auth enviado pelo painel).
export async function requireAdmin(req) {
  if (!USE_SUPABASE) {
    const a = await adminFromRequest(req);
    if (!a) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
    // Pedidos e pagamentos não fazem parte do acesso de fotógrafo.
    if (a.role === 'photographer') throw new HttpError(403, 'Seu acesso de fotógrafo não inclui pedidos e pagamentos.');
    return a;
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Faça login no painel.');
  const res = await fetch(`${base()}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  const user = await res.json();
  const rows = await rest(`admins?user_id=eq.${user.id}&select=role`);
  if (!rows || !rows.length) throw new HttpError(403, 'Acesso restrito à equipe Vetor Digital.');
  return { user, role: rows[0].role };
}
