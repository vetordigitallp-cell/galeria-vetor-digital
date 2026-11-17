// Fluxo completo SEM Supabase: dados e arquivos no Netlify Blobs (em memória no teste).
// A InfinitePay é simulada aqui só para teste automático — nada disso é pagamento real.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.VD_STORE = 'memory';
delete process.env.SUPABASE_URL;
process.env.INFINITEPAY_HANDLE = 'vetordigital';
process.env.URL = 'https://galeriavetordigital.com.br';
process.env.ADMIN_EMAIL = 'dono@vetordigital.com.br';
process.env.ADMIN_PASSWORD = 'senha-forte-de-teste';

let ip = { check: () => ({ success: true, paid: true, amount: 0, capture_method: 'pix' }) };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.host === 'api.checkout.infinitepay.io') {
    const body = JSON.parse(init.body);
    if (url.pathname === '/links') return new Response(JSON.stringify({ url: `https://checkout.infinitepay.io/vetordigital/${body.order_nsu}` }));
    if (url.pathname === '/payment_check') return new Response(JSON.stringify(ip.check(body)));
  }
  throw new Error('rede não simulada: ' + url.href);
};

const fn = async (name) => (await import(`../netlify/functions/${name}.mjs`)).default;
const F = {};
before(async () => {
  for (const n of ['db', 'auth-login', 'storage', 'img', 'file', 'checkout', 'infinitepay-webhook', 'order', 'admin-order-status']) F[n] = await fn(n);
});
const req = (path, { method = 'POST', body, token, raw } = {}) => new Request(`https://galeriavetordigital.com.br${path}`, {
  method, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
});
const J = async (r) => ({ status: r.status, body: await r.json() });
let TOKEN, EV, PH, ORIGINAL;

test('painel: senha errada recusa, senha certa entra', async () => {
  assert.equal((await F['auth-login'](req('/api/auth/login', { body: { email: 'dono@vetordigital.com.br', password: 'errada' } }))).status, 401);
  const r = await J(await F['auth-login'](req('/api/auth/login', { body: { email: 'DONO@vetordigital.com.br', password: 'senha-forte-de-teste' } })));
  assert.equal(r.status, 200);
  TOKEN = r.body.access_token;
});

test('público não lê pedidos nem grava; admin cria evento', async () => {
  assert.equal((await F.db(req('/api/db', { body: { table: 'orders' } }))).status, 403);
  assert.equal((await F.db(req('/api/db', { body: { table: 'events', op: 'insert', values: { slug: 'x', name: 'x' } } }))).status, 403);
  const r = await J(await F.db(req('/api/db', { token: TOKEN, body: { table: 'events', op: 'insert', values: { slug: 'corrida-unai', name: 'Corrida Unaí 10K', price_cents: 1500, published: true, event_date: '2026-11-01' } } })));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  EV = r.body.data[0];
  assert.ok(EV.faces_purge_at, 'data de exclusão dos rostos calculada');
});

test('envio de original grande em partes + prévia; foto registrada', async () => {
  ORIGINAL = crypto.randomBytes(10 * 1024 * 1024 + 123); // 10 MB: maior que o limite de 6 MB de uma função
  const PART = 4 * 1024 * 1024; const parts = Math.ceil(ORIGINAL.length / PART);
  for (let i = 0; i < parts; i++) {
    const qs = new URLSearchParams({ bucket: 'originals', path: `${EV.id}/a.jpg`, part: i, parts, type: 'image/jpeg' });
    const r = await F.storage(req(`/api/storage/upload?${qs}`, { token: TOKEN, raw: ORIGINAL.subarray(i * PART, (i + 1) * PART) }));
    assert.equal(r.status, 200);
  }
  const prev = Buffer.from('jpeg-previa');
  for (const p of [`${EV.id}/a.jpg`, `${EV.id}/t/a.jpg`]) {
    const qs = new URLSearchParams({ bucket: 'previews', path: p, part: 0, parts: 1, type: 'image/jpeg' });
    assert.equal((await F.storage(req(`/api/storage/upload?${qs}`, { token: TOKEN, raw: prev }))).status, 200);
  }
  const qs = new URLSearchParams({ bucket: 'previews', path: 'x.jpg', part: 0, parts: 1, type: 'image/jpeg' });
  assert.equal((await F.storage(req(`/api/storage/upload?${qs}`, { raw: prev }))).status, 401, 'sem login não envia');
  const r = await J(await F.db(req('/api/db', { token: TOKEN, body: { table: 'photos', op: 'insert', values: {
    event_id: EV.id, code: 'ARUF-01', original_name: 'a.jpg', original_path: `${EV.id}/a.jpg`, preview_path: `${EV.id}/a.jpg`, thumb_path: `${EV.id}/t/a.jpg`, published: true } } })));
  assert.equal(r.status, 200);
  PH = r.body.data[0];
  const dup = await F.db(req('/api/db', { token: TOKEN, body: { table: 'photos', op: 'insert', values: { event_id: EV.id, code: 'X', original_name: 'a.jpg', original_path: 'z', preview_path: 'z', thumb_path: 'z' } } }));
  assert.equal(dup.status, 409, 'mesma foto não é enviada duas vezes');
});

test('público vê evento e foto, sem caminho do original; prévia servida com cache', async () => {
  const ev = await J(await F.db(req('/api/db', { body: { table: 'events', filters: [['slug', 'eq', 'corrida-unai']] } })));
  assert.equal(ev.body.data.length, 1);
  const ph = await J(await F.db(req('/api/db', { body: { table: 'photos', select: '*', filters: [['event_id', 'eq', EV.id]] } })));
  assert.equal(ph.body.data.length, 1);
  assert.equal(ph.body.data[0].original_path, undefined);
  const img = await F.img(req(`/api/img/${EV.id}/a.jpg`, { method: 'GET' }));
  assert.equal(img.status, 200);
  assert.match(img.headers.get('Netlify-CDN-Cache-Control'), /immutable/);
  assert.equal((await F.file(req('/api/file?t=falso', { method: 'GET' }))).status, 403);
});

let ORDER;
test('compra: checkout cria pedido pendente sem downloads', async () => {
  const r = await J(await F.checkout(req('/api/checkout', { body: { photo_ids: [PH.id], customer: { name: 'Maria Atleta', email: 'maria@email.com' }, payment_method: 'pix' } })));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total_cents, 1500);
  ORDER = r.body;
  const v = await J(await F.order(req('/api/order', { body: { id: ORDER.order_id, token: ORDER.token } })));
  assert.equal(v.body.order.status, 'pending');
  assert.equal(v.body.items[0].download_url, null);
  assert.equal(v.body.items[0].thumb_url, `/api/img/${EV.id}/t/a.jpg`);
});

test('pagamento confirmado no servidor libera o original completo (partes juntas = arquivo original)', async () => {
  ip.check = () => ({ success: true, paid: true, amount: 1500, paid_amount: 1500, capture_method: 'pix', installments: 1 });
  const w = await F['infinitepay-webhook'](req('/api/infinitepay/webhook', { body: { order_nsu: ORDER.order_id, transaction_nsu: 'tx1', invoice_slug: 'sl1', amount: 1500 } }));
  assert.equal(w.status, 200);
  const v = await J(await F.order(req('/api/order', { body: { id: ORDER.order_id, token: ORDER.token } })));
  assert.equal(v.body.order.status, 'paid');
  const url = v.body.items[0].download_url;
  assert.match(url, /^\/api\/file\?t=/);
  const base = url.replace(/&download=.*/, '');
  const info = await J(await F.file(req(`${base}&info=1`, { method: 'GET' })));
  assert.equal(info.body.parts, 3);
  const chunks = [];
  for (let i = 0; i < info.body.parts; i++) chunks.push(Buffer.from(await (await F.file(req(`${base}&part=${i}`, { method: 'GET' }))).arrayBuffer()));
  assert.ok(Buffer.concat(chunks).equals(ORIGINAL), 'arquivo baixado idêntico ao original');
});

test('painel: pedido, estatísticas, estorno bloqueia download', async () => {
  const st = await J(await F.db(req('/api/rpc', { token: TOKEN, body: { name: 'admin_stats' } })));
  assert.equal(st.body.data.revenue_cents, 1500);
  assert.equal(st.body.data.orders_paid, 1);
  const list = await J(await F.db(req('/api/db', { token: TOKEN, body: { table: 'orders', select: 'id,code,status,customer:customers!inner(name,email),order_items(id)', order: [['created_at', false]] } })));
  assert.equal(list.body.data[0].customer.email, 'maria@email.com');
  assert.equal(list.body.data[0].order_items.length, 1);
  ip.check = () => ({ success: true, paid: false });
  await F['infinitepay-webhook'](req('/api/infinitepay/webhook', { body: { order_nsu: ORDER.order_id, transaction_nsu: 'tx1', invoice_slug: 'sl1', event: 'refunded' } }));
  const v = await J(await F.order(req('/api/order', { body: { id: ORDER.order_id, token: ORDER.token } })));
  assert.equal(v.body.order.status, 'refunded');
  assert.equal(v.body.items[0].download_url, null);
  assert.equal((await F['admin-order-status'](req('/api/admin/order-status', { token: TOKEN, body: { order_id: ORDER.order_id, action: 'reactivate' } }))).status, 200);
});

test('busca pelo rosto encontra a foto com vetor parecido', async () => {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 4);
  await F.db(req('/api/db', { token: TOKEN, body: { table: 'photo_faces', op: 'insert', values: [{ photo_id: PH.id, event_id: EV.id, embedding: JSON.stringify(v) }] } }));
  await F.db(req('/api/db', { token: TOKEN, body: { table: 'events', op: 'update', filters: [['id', 'eq', EV.id]], values: { face_search: true } } }));
  const near = v.map((x) => x + 0.01);
  const r = await J(await F.db(req('/api/rpc', { body: { name: 'search_faces', args: { p_event: EV.id, p_embedding: JSON.stringify(near), p_threshold: 0.5 } } })));
  assert.equal(r.body.data[0].photo_id, PH.id);
  assert.equal((await F.db(req('/api/db', { body: { table: 'photo_faces' } }))).status, 403, 'vetores faciais nunca são públicos');
});

test('login: bloqueia depois de 8 senhas erradas do mesmo IP', async () => {
  const tentar = (pw, ip) => F['auth-login'](new Request('https://galeriavetordigital.com.br/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': ip }, body: JSON.stringify({ email: 'dono@vetordigital.com.br', password: pw }) }));
  for (let i = 0; i < 8; i++) assert.equal((await tentar('errada', '9.9.9.9')).status, 401);
  assert.equal((await tentar('senha-forte-de-teste', '9.9.9.9')).status, 429, 'bloqueado mesmo com a senha certa');
  assert.equal((await tentar('senha-forte-de-teste', '8.8.8.8')).status, 200, 'outro IP continua entrando');
});

// ---------------------------------------------------------------- equipe (sócio)
test('equipe: dono adiciona sócio, sócio entra, não mexe na equipe e perde acesso ao ser removido', async () => {
  const { login, adminFromRequest } = await import('../netlify/lib/auth.mjs');
  const { rpc } = await import('../netlify/lib/db.mjs');
  const req = (t) => new Request('http://x/api/db', { headers: { authorization: 'Bearer ' + t } });
  const owner = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, '10.0.0.1');
  const ownerActor = await adminFromRequest(req(owner.access_token));
  assert.equal(ownerActor.role, 'owner');
  await assert.rejects(() => rpc('grant_admin', { p_email: 'socio@x.com', p_role: 'admin', p_password: 'curta' }, 'owner', ownerActor), /10 caracteres/);
  const m = await rpc('grant_admin', { p_email: 'Socio@X.com', p_role: 'admin', p_password: 'senha-do-socio-1' }, 'owner', ownerActor);
  assert.equal(m.email, 'socio@x.com');
  await assert.rejects(() => rpc('grant_admin', { p_email: 'socio@x.com', p_role: 'admin', p_password: 'senha-do-socio-1' }, 'owner', ownerActor), /já está/);
  const s = await login('socio@x.com', 'senha-do-socio-1', '10.0.0.2');
  const sActor = await adminFromRequest(req(s.access_token));
  assert.equal(sActor.role, 'admin');
  await assert.rejects(() => rpc('grant_admin', { p_email: 'z@x.com', p_password: '1234567890' }, 'admin', sActor), /Dono/);
  await assert.rejects(() => login('socio@x.com', 'errada-errada', '10.0.0.3'), /incorretos/);
  // troca de senha pela própria pessoa encerra a sessão antiga
  await rpc('change_password', { p_current: 'senha-do-socio-1', p_new: 'senha-nova-do-socio' }, 'admin', sActor);
  assert.equal(await adminFromRequest(req(s.access_token)), null);
  const s2 = await login('socio@x.com', 'senha-nova-do-socio', '10.0.0.2');
  assert.ok(await adminFromRequest(req(s2.access_token)));
  // removido: perde o acesso na hora
  await rpc('revoke_admin', { p_user: m.user_id }, 'owner', ownerActor);
  assert.equal(await adminFromRequest(req(s2.access_token)), null);
  const team = await rpc('admin_team', {}, 'owner', ownerActor);
  assert.equal(team.length, 1);
  assert.ok(!JSON.stringify(team).includes('hash'));
});
