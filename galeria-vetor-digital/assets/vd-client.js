// Cliente de dados da Galeria Vetor Digital quando o site roda só no Netlify (sem Supabase).
// Oferece as mesmas chamadas usadas pelas telas (from/select/eq..., rpc, storage, auth),
// mas fala com as funções /api/* do próprio site. Nenhuma chave secreta fica no navegador.

const SESSION_KEY = 'vd_admin_session_v1';
const PART = 4 * 1024 * 1024;
let memSession = null;

function readSession() {
  try { const s = JSON.parse(localStorage.getItem(SESSION_KEY)); if (s && s.expires_at > Date.now()) return s; } catch { /* sem armazenamento */ }
  return memSession && memSession.expires_at > Date.now() ? memSession : null;
}
function writeSession(s) {
  memSession = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* sem armazenamento */ }
}
function authHeaders(extra = {}) {
  const s = readSession();
  return s ? { ...extra, Authorization: `Bearer ${s.access_token}` } : extra;
}
async function call(url, body, init = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(body instanceof Blob || body instanceof ArrayBuffer ? {} : { 'Content-Type': 'application/json' }),
    body: body instanceof Blob || body instanceof ArrayBuffer ? body : JSON.stringify(body),
    ...init
  });
  const data = await res.json().catch(() => ({}));
  // Só encerra a sessão quando a recusa vem das nossas funções (resposta com "error").
  // Um 401 sem esse campo vem do próprio Netlify (projeto privado / proteção de acesso), não do login do painel.
  if (res.status === 401 && data.error && readSession()) writeSession(null);
  if (res.status === 401 && !data.error) {
    const e = new Error('O Netlify bloqueou o acesso (projeto privado). Recarregue a página estando logado no Netlify, ou torne o site público.');
    e.code = '401'; throw e;
  }
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.code = res.status === 409 && /duplicado/.test(data.error || '') ? '23505' : String(res.status); throw e; }
  return data;
}

class Query {
  constructor(table) { this.q = { table, op: 'select', filters: [] }; this.mode = 'many'; }
  select(cols = '*', opts = {}) {
    if (this.q.op === 'select') this.q.select = cols;
    else this.returning = true;
    if (opts.head) this.q.head = true;
    return this;
  }
  eq(c, v) { this.q.filters.push([c, 'eq', v]); return this; }
  neq(c, v) { this.q.filters.push([c, 'neq', v]); return this; }
  in(c, v) { this.q.filters.push([c, 'in', v]); return this; }
  is(c, v) { this.q.filters.push([c, 'is', v]); return this; }
  ilike(c, v) { this.q.filters.push([c, 'ilike', v]); return this; }
  gt(c, v) { this.q.filters.push([c, 'gt', v]); return this; }
  gte(c, v) { this.q.filters.push([c, 'gte', v]); return this; }
  lt(c, v) { this.q.filters.push([c, 'lt', v]); return this; }
  lte(c, v) { this.q.filters.push([c, 'lte', v]); return this; }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(c, o = {}) { (this.q.order ||= []).push([c, o.ascending !== false]); return this; }
  range(a, b) { this.q.range = [a, b]; return this; }
  limit(n) { this.q.limit = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  insert(values) { this.q.op = 'insert'; this.q.values = values; return this; }
  upsert(values, opts = {}) { this.q.op = 'upsert'; this.q.values = values; this.q.onConflict = opts.onConflict || 'id'; return this; }
  update(values) { this.q.op = 'update'; this.q.values = values; return this; }
  delete() { this.q.op = 'delete'; return this; }
  async run() {
    try {
      const r = await call('/api/db', this.q);
      if (this.q.head) return { data: null, count: r.count, error: null };
      const rows = r.data || [];
      if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'Registro não encontrado' } };
      if (this.mode === 'maybe') return { data: rows[0] || null, error: null };
      return { data: rows, count: r.count, error: null };
    } catch (e) {
      return { data: null, count: null, error: { message: e.message, code: e.code } };
    }
  }
  then(res, rej) { return this.run().then(res, rej); }
}

async function assemble(signedUrl) {
  const sep = signedUrl.includes('?') ? '&' : '?';
  const info = await fetch(`${signedUrl}${sep}info=1`).then((r) => r.json());
  if (info.error) throw new Error(info.error);
  const parts = [];
  for (let i = 0; i < info.parts; i++) {
    const r = await fetch(`${signedUrl}${sep}part=${i}`);
    if (!r.ok) throw new Error('Falha ao baixar o arquivo.');
    parts.push(await r.blob());
  }
  return { blob: new Blob(parts, { type: info.type }), name: info.name };
}

// Baixa um arquivo assinado (originais) juntando as partes e salva com o nome certo.
export async function saveSigned(url, fallbackName) {
  const { blob, name } = await assemble(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = fallbackName || name || 'foto.jpg';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

function bucketApi(bucket) {
  return {
    async upload(path, body, opts = {}) {
      try {
        const blob = body instanceof Blob ? body : new Blob([body]);
        const parts = Math.max(1, Math.ceil(blob.size / PART));
        for (let i = 0; i < parts; i++) {
          const qs = new URLSearchParams({ bucket, path, part: String(i), parts: String(parts), type: opts.contentType || blob.type || '', upsert: opts.upsert ? '1' : '0' });
          await call(`/api/storage/upload?${qs}`, blob.slice(i * PART, (i + 1) * PART));
        }
        return { data: { path }, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    async remove(paths) {
      try { const r = await call('/api/storage/remove', { bucket, paths }); return { data: r.data, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    async createSignedUrl(path, expiresIn, opts = {}) {
      try { const r = await call('/api/storage/sign', { bucket, path, expiresIn, download: opts.download }); return { data: { signedUrl: r.signedUrl }, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    async download(path) {
      try {
        const r = await call('/api/storage/sign', { bucket, path, expiresIn: 600 });
        return { data: (await assemble(r.signedUrl)).blob, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    getPublicUrl(path) { return { data: { publicUrl: `/api/img/${path}` } }; }
  };
}

export function createClient() {
  return {
    from: (t) => new Query(t),
    async rpc(name, args) {
      try { const r = await call('/api/rpc', { name, args }); return { data: r.data, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    storage: { from: bucketApi },
    auth: {
      async getSession() {
        const s = readSession();
        return { data: { session: s ? { access_token: s.access_token, user: s.user } : null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        try { const s = await call('/api/auth/login', { email, password }); writeSession(s); return { data: { session: s }, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
      },
      async signOut() { writeSession(null); return { error: null }; },
      async resetPasswordForEmail() {
        return { error: { message: 'Esqueceu a senha? Se você é da equipe, peça ao dono uma senha nova (Equipe → Nova senha). Se é o acesso principal, troque a variável ADMIN_PASSWORD no Netlify e publique de novo.' } };
      },
      async updateUser() {
        return { error: { message: 'Troque a senha na variável ADMIN_PASSWORD do Netlify.' } };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    }
  };
}
