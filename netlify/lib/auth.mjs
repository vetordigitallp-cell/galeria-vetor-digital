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
  const em = String(email || '').trim().toLowerCase();
  const pw = String(password || '');
  let who = null;
  if (same(em, E)) {
    if (same(pw, P)) who = { id: 'owner', email: E, role: 'owner', ver: 0 };
  } else {
    const m = (await loadTeam(store)).find((x) => x.email === em);
    if (m && (await checkPassword(pw, m))) who = { id: m.id, email: m.email, role: m.role, ver: m.ver };
  }
  if (!who) {
    st.n += 1; await store.setJSON(lk, st);
    await new Promise((r) => setTimeout(r, 700));
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  if (st.n) await store.del(lk);
  const exp = Date.now() + 12 * 36e5;
  const token = await sign({ k: 'admin', sub: who.id, email: who.email, role: who.role, v: who.ver, exp });
  return { access_token: token, expires_at: exp, user: { id: who.id, email: who.email } };
}

// ---------------------------------------------------------------- equipe (sócios e administradores)
// O dono vem das variáveis do Netlify. As demais pessoas ficam em sys/team, com a senha guardada
// só como hash (scrypt + sal). Cada pessoa tem um número de versão: remover a pessoa ou trocar a
// senha invalida na hora as sessões abertas dela.
const TEAM_KEY = 'sys/team';
const ROLES = new Set(['admin', 'owner', 'photographer']);
async function loadTeam(store) { return (await store.getJSON(TEAM_KEY)) || []; }
function scrypt(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('base64'), hash: (await scrypt(pw, salt)).toString('base64') };
}
async function checkPassword(pw, m) {
  const k = await scrypt(pw, Buffer.from(m.salt, 'base64'));
  const h = Buffer.from(m.hash, 'base64');
  return h.length === k.length && crypto.timingSafeEqual(h, k);
}
function checkNewPassword(pw) {
  if (String(pw || '').length < 10) throw new HttpError(400, 'A senha precisa ter pelo menos 10 caracteres.');
}
const publicMember = (m) => ({ user_id: m.id, email: m.email, role: m.role, created_at: m.created_at });

export async function teamList() {
  const store = await kv('vd-db');
  const E = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return [{ user_id: 'owner', email: E, role: 'owner', created_at: null, main: true }, ...(await loadTeam(store)).map(publicMember)];
}
export async function teamAdd(email, role, password) {
  const store = await kv('vd-db');
  const em = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new HttpError(400, 'Informe um e-mail válido.');
  if (!ROLES.has(role)) throw new HttpError(400, 'Permissão inválida.');
  checkNewPassword(password);
  if (em === String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()) throw new HttpError(400, 'Esse e-mail já é o do dono.');
  const team = await loadTeam(store);
  if (team.some((m) => m.email === em)) throw new HttpError(400, 'Essa pessoa já está na equipe.');
  const m = { id: crypto.randomUUID(), email: em, role, ver: 1, created_at: new Date().toISOString(), ...(await hashPassword(password)) };
  team.push(m);
  await store.setJSON(TEAM_KEY, team);
  return publicMember(m);
}
export async function teamRemove(id) {
  const store = await kv('vd-db');
  const team = await loadTeam(store);
  const next = team.filter((m) => m.id !== String(id));
  if (next.length === team.length) throw new HttpError(404, 'Pessoa não encontrada.');
  await store.setJSON(TEAM_KEY, next);
  return true;
}
// Dono redefine a senha de alguém da equipe (ex.: o sócio esqueceu).
export async function teamResetPassword(id, password) {
  checkNewPassword(password);
  const store = await kv('vd-db');
  const team = await loadTeam(store);
  const m = team.find((x) => x.id === String(id));
  if (!m) throw new HttpError(404, 'Pessoa não encontrada.');
  Object.assign(m, await hashPassword(password), { ver: (m.ver || 1) + 1 });
  await store.setJSON(TEAM_KEY, team);
  return true;
}
// A própria pessoa troca a senha (precisa da senha atual).
export async function changeOwnPassword(actor, current, password) {
  if (!actor || actor.user.id === 'owner') throw new HttpError(400, 'A senha do dono é a variável ADMIN_PASSWORD do Netlify: troque lá e publique de novo.');
  checkNewPassword(password);
  const store = await kv('vd-db');
  const team = await loadTeam(store);
  const m = team.find((x) => x.id === actor.user.id);
  if (!m || !(await checkPassword(String(current || ''), m))) throw new HttpError(400, 'A senha atual não confere.');
  Object.assign(m, await hashPassword(password), { ver: (m.ver || 1) + 1 });
  await store.setJSON(TEAM_KEY, team);
  return true;
}

export async function adminFromRequest(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const p = await verify(token);
  if (!p || p.k !== 'admin') return null;
  if (p.sub === 'owner') return { user: { id: 'owner', email: p.email }, role: 'owner' };
  // Pessoas da equipe: confere a cada pedido se ainda têm acesso e se a senha não mudou.
  const m = (await loadTeam(await kv('vd-db'))).find((x) => x.id === p.sub);
  if (!m || m.ver !== p.v) return null;
  return { user: { id: m.id, email: m.email }, role: m.role };
}

// Link temporário para um arquivo privado (original). dl = nome do arquivo para baixar.
export async function fileToken(bucket, path, seconds, dl) {
  return sign({ k: 'file', b: bucket, p: path, dl: dl || null, exp: Date.now() + seconds * 1000 });
}
