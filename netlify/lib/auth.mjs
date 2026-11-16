// Login do painel e links temporários assinados, sem serviço externo.
// - O acesso do dono vem de ADMIN_EMAIL e ADMIN_PASSWORD (variáveis do Netlify; a senha é secreta).
// - A chave de assinatura é gerada uma única vez e fica guardada no próprio Netlify Blobs.
import crypto from 'node:crypto';
import { kv } from './blobstore.mjs';
import { HttpError } from './http.mjs';

let secretCache = null;
async function secret() {
  if (process.env.VD_SECRET) return process.env.VD_SECRET;
  if (secretCache) return secretCache;
  const store = await kv('vd-db');
  let s = await store.getJSON('sys/secret');
  if (!s) { s = crypto.randomBytes(48).toString('base64url'); await store.setJSON('sys/secret', s); }
  return (secretCache = s);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export async function sign(payload) {
  const body = b64(payload);
  const mac = crypto.createHmac('sha256', await secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export async function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const good = crypto.createHmac('sha256', await secret()).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  return p;
}

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const LOCK_MAX = 8;
const LOCK_MS = 15 * 60 * 1000;
async function lockKey(ip) {
  return `sys/login/${crypto.createHash('sha256').update(String(ip || 'desconhecido')).digest('hex').slice(0, 32)}`;
}

export async function login(email, password, ip) {
  const store = await kv('vd-db');
  const lk = await lockKey(ip);
  const st = (await store.getJSON(lk)) || { n: 0, since: Date.now() };
  if (Date.now() - st.since > LOCK_MS) { st.n = 0; st.since = Date.now(); }
  if (st.n >= LOCK_MAX) throw new HttpError(429, 'Muitas tentativas de login. Aguarde 15 minutos e tente de novo.');
  const readEnv = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '');
  const E = String(readEnv('ADMIN_EMAIL')).trim().toLowerCase();
  const P = String(readEnv('ADMIN_PASSWORD'));
  // Diz qual configuração falta, sem nunca revelar o valor.
  if (!E) throw new HttpError(500, 'Painel sem acesso configurado: ADMIN_EMAIL não chegou às funções do Netlify.');
  if (!P) throw new HttpError(500, 'Painel sem acesso configurado: ADMIN_PASSWORD não chegou às funções do Netlify.');
  if (P.length < 10) throw new HttpError(500, 'Painel sem acesso configurado: ADMIN_PASSWORD tem menos de 10 caracteres.');
  const ok = same(String(email || '').trim().toLowerCase(), E) & same(String(password || ''), P);
  if (!ok) {
    st.n += 1; await store.setJSON(lk, st);
    await new Promise((r) => setTimeout(r, 700));
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  if (st.n) await store.del(lk);
  const exp = Date.now() + 12 * 36e5;
  return { access_token: await sign({ k: 'admin', sub: 'owner', email: E, exp }), expires_at: exp, user: { id: 'owner', email: E } };
}

export async function adminFromRequest(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const p = await verify(token);
  return p && p.k === 'admin' ? { user: { id: p.sub, email: p.email }, role: 'owner' } : null;
}

// Link temporário para um arquivo privado (original). dl = nome do arquivo para baixar.
export async function fileToken(bucket, path, seconds, dl) {
  return sign({ k: 'file', b: bucket, p: path, dl: dl || null, exp: Date.now() + seconds * 1000 });
}
