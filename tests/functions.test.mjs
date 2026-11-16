// Testes dos fluxos de pagamento com Supabase e InfinitePay simulados (fetch interceptado).
// Rode com: node --test tests/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.INFINITEPAY_HANDLE = '$vetordigital';
process.env.URL = 'https://galeria.example.com';

const EV1 = crypto.randomUUID();
const EV2 = crypto.randomUUID();
let db, calls, ip;

function reset() {
  db = {
    events: [
      { id: EV1, name: 'Corrida A', price_cents: 1500, published: true },
      { id: EV2, name: 'Corrida Oculta', price_cents: 1500, published: false }
    ],
    photos: [],
    customers: [],
    orders: [],
    order_items: [],
    payment_events: [],
    admins: [{ user_id: 'adm-1', role: 'owner' }],
    settings: [{ id: 1, pix_discount_pct: 0 }]
  };
  for (let i = 1; i <= 3; i++) {
    db.photos.push({ id: crypto.randomUUID(), event_id: EV1, code: `00${i}`, price_cents: i === 3 ? 2500 : null,
      original_path: `${EV1}/orig-${i}.jpg`, thumb_path: `${EV1}/t-${i}.jpg`, published: true });
  }
  db.photos.push({ id: crypto.randomUUID(), event_id: EV2, code: '900', price_cents: null,
    original_path: `${EV2}/x.jpg`, thumb_path: `${EV2}/tx.jpg`, published: true });
  calls = [];
  ip = { linkStatus: 200, check: (b) => ({ success: true, paid: true, amount: currentTotal(b.order_nsu), paid_amount: currentTotal(b.order_nsu), installments: 1, capture_method: 'pix' }) };
}
const currentTotal = (id) => db.orders.find((o) => o.id === id)?.total_cents;

function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'on_conflict'].includes(k)) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== decodeURIComponent(v.slice(3))) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ url: url.href, method, body, headers: init.headers });
  const ok = (data, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status });

  if (url.host === 'api.checkout.infinitepay.io') {
    if (url.pathname === '/links') {
      if (ip.linkStatus !== 200) return ok({ success: false }, ip.linkStatus);
      return ok({ url: `https://checkout.infinitepay.io/vetordigital/${body.order_nsu}` });
    }
    if (url.pathname === '/payment_check') return ok(ip.check(body));
  }
  if (url.pathname === '/auth/v1/user') {
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    return auth === 'Bearer admin-token' ? ok({ id: 'adm-1' }) : ok({ error: 'x' }, 401);
  }
  if (url.pathname === '/storage/v1/object/sign/originals') {
    return ok(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/originals/${p}?token=SIG` })));
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice(9);
    const params = [...url.searchParams.entries()];
    const rows = db[table];
    if (method === 'GET') {
      let out = filterRows(rows, params).map((r) => ({ ...r }));
      if (table === 'photos') out = out.map((p) => ({ ...p, event: db.events.find((e) => e.id === p.event_id) }));
      if (table === 'orders') out = out.map((o) => ({ ...o, customer: db.customers.find((c) => c.id === o.customer_id) }));
      return ok(out);
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const inserted = list.map((r) => {
        if (table === 'customers') {
          const ex = db.customers.find((c) => c.email === r.email);
          if (ex) return Object.assign(ex, r);
        }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
        rows.push(row);
        return row;
      });
      return ok(inserted, 201);
    }
    if (method === 'PATCH') {
      filterRows(rows, params).forEach((r) => Object.assign(r, body));
      return ok(undefined, 204);
    }
  }
  throw new Error('fetch não simulado: ' + method + ' ' + url.href);
};

const checkout = (await import('../netlify/functions/checkout.mjs')).default;
const webhook = (await import('../netlify/functions/infinitepay-webhook.mjs')).default;
const order = (await import('../netlify/functions/order.mjs')).default;
const adminStatus = (await import('../netlify/functions/admin-order-status.mjs')).default;

const post = (fn, path, body) => fn(new Request(`https://galeria.example.com${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}));
const customer = { name: 'Maria Atleta', email: 'Maria@Email.com', phone: '(38) 99947-1986' };

beforeEach(reset);

test('checkout usa preços do banco, cria pedido e link real da InfinitePay', async () => {
  const ids = db.photos.filter((p) => p.event_id === EV1).map((p) => p.id);
  const res = await post(checkout, '/api/checkout', { photo_ids: ids, customer, total: 1 });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  // 3 fotos do mesmo álbum = 5% de desconto progressivo
  assert.equal(data.total_cents, 5500 - 275);
  assert.match(data.checkout_url, /^https:\/\/checkout\.infinitepay\.io\//);
  const linkCall = calls.find((c) => c.url.endsWith('/links'));
  assert.equal(linkCall.body.handle, 'vetordigital');
  assert.equal(linkCall.body.order_nsu, data.order_id);
  assert.equal(linkCall.body.items.reduce((s, i) => s + i.price * i.quantity, 0), 5225);
  assert.match(linkCall.body.items[0].description, /3 fotos, 5% de desconto/);
  assert.deepEqual(linkCall.body.webhook, { url: 'https://galeria.example.com/api/infinitepay/webhook', events: ['paid', 'refunded', 'canceled', 'payment_failed'] });
  assert.equal(linkCall.body.options, undefined, 'sem API Key não envia options');
  assert.equal(linkCall.body.redirect_url, `https://galeria.example.com/pedido/${data.order_id}/${data.token}`);
  assert.equal(linkCall.body.customer.phone_number, '+5538999471986');
  assert.equal(linkCall.headers['X-Api-Key'], undefined);
  const o = db.orders[0];
  assert.equal(o.status, 'pending');
  assert.notEqual(o.access_token_hash, data.token, 'token não pode ser salvo em texto puro');
  assert.equal(db.customers[0].email, 'maria@email.com');
  assert.equal(db.order_items.length, 3);
});

test('checkout recusa foto de evento não publicado e carrinho vazio', async () => {
  const hidden = db.photos.find((p) => p.event_id === EV2).id;
  let res = await post(checkout, '/api/checkout', { photo_ids: [hidden], customer });
  assert.equal(res.status, 409);
  res = await post(checkout, '/api/checkout', { photo_ids: [], customer });
  assert.equal(res.status, 400);
  res = await post(checkout, '/api/checkout', { photo_ids: ['abc'], customer });
  assert.equal(res.status, 400);
  assert.equal(db.orders.length, 0);
});

test('falha da InfinitePay marca o pedido como falho e não devolve link', async () => {
  ip.linkStatus = 422;
  const res = await post(checkout, '/api/checkout', { photo_ids: [db.photos[0].id], customer });
  assert.equal(res.status, 502);
  assert.equal(db.orders[0].status, 'failed');
});

async function newOrder() {
  const res = await post(checkout, '/api/checkout', { photo_ids: [db.photos[0].id, db.photos[2].id], customer });
  return res.json();
}

test('pedido pendente não entrega originais', async () => {
  const o = await newOrder();
  const res = await post(order, '/api/order', { id: o.order_id, token: o.token });
  const data = await res.json();
  assert.equal(data.order.status, 'pending');
  assert.ok(data.items.every((i) => i.download_url === null));
  assert.ok(data.order.checkout_url);
});

test('token errado não acessa o pedido', async () => {
  const o = await newOrder();
  const res = await post(order, '/api/order', { id: o.order_id, token: 'errado' });
  assert.equal(res.status, 404);
});

test('webhook só aprova depois do payment_check e libera downloads assinados', async () => {
  const o = await newOrder();
  const res = await post(webhook, '/api/infinitepay/webhook', {
    order_nsu: o.order_id, transaction_nsu: 'tx-1', invoice_slug: 'slug-1', amount: 4000, capture_method: 'pix'
  });
  assert.equal(res.status, 200);
  const check = calls.find((c) => c.url.endsWith('/payment_check'));
  assert.deepEqual(check.body, { handle: 'vetordigital', order_nsu: o.order_id, transaction_nsu: 'tx-1', slug: 'slug-1' });
  assert.equal(db.orders[0].status, 'paid');
  assert.equal(db.payment_events.at(-1).verified, true);
  const data = await (await post(order, '/api/order', { id: o.order_id, token: o.token })).json();
  assert.equal(data.order.status, 'paid');
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((i) => /token=SIG&download=Corrida-A-00\d\.jpg$/.test(i.download_url)));
});

test('webhook falso (payment_check diz não pago) não libera nada', async () => {
  ip.check = () => ({ success: false, paid: false });
  const o = await newOrder();
  await post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 'fake', invoice_slug: 'fake' });
  assert.equal(db.orders[0].status, 'pending');
  const data = await (await post(order, '/api/order', { id: o.order_id, token: o.token })).json();
  assert.ok(data.items.every((i) => i.download_url === null));
});

test('valor pago divergente não libera fotos', async () => {
  ip.check = () => ({ success: true, paid: true, amount: 100, paid_amount: 100 });
  const o = await newOrder();
  await post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 't', invoice_slug: 's' });
  assert.equal(db.orders[0].status, 'pending');
});

test('retorno ao site com parâmetros confere na InfinitePay (sem webhook)', async () => {
  const o = await newOrder();
  const data = await (await post(order, '/api/order', {
    id: o.order_id, token: o.token, transaction_nsu: 'tx-9', slug: 'sl-9', capture_method: 'credit_card'
  })).json();
  assert.equal(data.order.status, 'paid');
  assert.ok(data.items[0].download_url);
});

test('área Minhas compras: código + e-mail', async () => {
  const o = await newOrder();
  let res = await post(order, '/api/order', { code: o.code.toLowerCase(), email: 'maria@email.com' });
  assert.equal(res.status, 200);
  res = await post(order, '/api/order', { code: o.code, email: 'outra@email.com' });
  assert.equal(res.status, 404);
});

test('webhook com order_nsu inválido responde 400', async () => {
  const res = await post(webhook, '/api/infinitepay/webhook', { order_nsu: 'x' });
  assert.equal(res.status, 400);
});


// ---------------- novos cenários da integração oficial

const payOrder = async (o) => post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 'tx-p', invoice_slug: 'sl-p', capture_method: 'credit_card' });

test('com API Key: options com link único, validade, cartão sem Pix e desconto no Pix', async () => {
  process.env.INFINITEPAY_API_KEY = 'inchk_teste';
  db.settings[0].pix_discount_pct = 5;
  try {
    const ids = db.photos.filter((p) => p.event_id === EV1).map((p) => p.id);
    await post(checkout, '/api/checkout', { photo_ids: ids, customer, payment_method: 'pix' });
    let link = calls.filter((c) => c.url.endsWith('/links')).at(-1);
    assert.equal(link.headers['X-Api-Key'], 'inchk_teste');
    assert.equal(link.body.options.single_payment, true);
    assert.match(link.body.options.valid_until, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00$/);
    assert.deepEqual(link.body.options.payment_methods_enabled, ['credit_card', 'pix']);
    assert.deepEqual(link.body.options.discounts, { pix: 5 });
    await post(checkout, '/api/checkout', { photo_ids: ids, customer, payment_method: 'credit_card' });
    link = calls.filter((c) => c.url.endsWith('/links')).at(-1);
    assert.deepEqual(link.body.options.payment_methods_enabled, ['credit_card']);
    assert.equal(link.body.options.discounts, undefined);
    assert.equal(db.orders.at(-1).payment_method_requested, 'credit_card');
  } finally { delete process.env.INFINITEPAY_API_KEY; }
});

test('cartão parcelado: paid_amount maior que o total ainda libera (compara só amount)', async () => {
  ip.check = (b) => ({ success: true, paid: true, amount: currentTotal(b.order_nsu), paid_amount: currentTotal(b.order_nsu) + 390, installments: 6, capture_method: 'credit_card' });
  const o = await newOrder();
  await payOrder(o);
  assert.equal(db.orders[0].status, 'paid');
  assert.equal(db.orders[0].installments, 6);
});

test('Pix com desconto: aceita amount já com desconto', async () => {
  db.settings[0].pix_discount_pct = 10;
  ip.check = (b) => ({ success: true, paid: true, amount: Math.round(currentTotal(b.order_nsu) * 0.9), paid_amount: Math.round(currentTotal(b.order_nsu) * 0.9), capture_method: 'pix' });
  const o = await newOrder();
  await payOrder(o);
  assert.equal(db.orders[0].status, 'paid');
});

test('aviso duplicado não altera pedido já pago nem duplica a aprovação', async () => {
  const o = await newOrder();
  await payOrder(o);
  const paidAt = db.orders[0].paid_at;
  const r = await payOrder(o);
  assert.equal(r.status, 200);
  assert.equal(db.orders[0].status, 'paid');
  assert.equal(db.orders[0].paid_at, paidAt);
});

test('estorno: InfinitePay deixa de confirmar -> pedido estornado e downloads bloqueados', async () => {
  const o = await newOrder();
  await payOrder(o);
  ip.check = () => ({ success: true, paid: false });
  await post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 'qualquer', invoice_slug: 'qualquer', event: 'refunded' });
  const recheck = calls.filter((c) => c.url.endsWith('/payment_check')).at(-1);
  assert.equal(recheck.body.transaction_nsu, 'tx-p', 'reconfere com os identificadores guardados, não os do aviso');
  assert.equal(db.orders[0].status, 'refunded');
  const data = await (await post(order, '/api/order', { id: o.order_id, token: o.token })).json();
  assert.ok(data.items.every((i) => i.download_url === null));
});

test('aviso falso de estorno (InfinitePay ainda confirma) não bloqueia, só marca para revisão', async () => {
  const o = await newOrder();
  await payOrder(o);
  await post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 'x', invoice_slug: 'y', event: 'refunded' });
  assert.equal(db.orders[0].status, 'paid');
  assert.equal(db.orders[0].needs_review, true);
});

test('cancelamento antes do pagamento marca o pedido como cancelado', async () => {
  ip.check = () => ({ success: true, paid: false });
  const o = await newOrder();
  await post(webhook, '/api/infinitepay/webhook', { order_nsu: o.order_id, transaction_nsu: 't', invoice_slug: 's', event: 'canceled' });
  assert.equal(db.orders[0].status, 'canceled');
});

test('painel: marcar estornado e reativar exige login de administrador', async () => {
  const o = await newOrder();
  await payOrder(o);
  const call = (token, action) => adminStatus(new Request('https://galeria.example.com/api/admin/order-status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ order_id: o.order_id, action }) }));
  assert.equal((await call('invalido', 'refund')).status, 401);
  assert.equal((await call('admin-token', 'refund')).status, 200);
  assert.equal(db.orders[0].status, 'refunded');
  assert.equal((await call('admin-token', 'refund')).status, 409);
  assert.equal((await call('admin-token', 'reactivate')).status, 200);
  assert.equal(db.orders[0].status, 'paid');
});

test('gorjeta entra no total cobrado e é validada no servidor', async () => {
  const ids = db.photos.filter((p) => p.event_id === EV1).slice(0, 2).map((p) => p.id);
  let res = await post(checkout, '/api/checkout', { photo_ids: ids, customer, tip_cents: 1000 });
  const d = await res.json();
  assert.equal(d.total_cents, 3000 - 150 + 1000, '2 fotos: 5% só sobre as fotos, gorjeta sem desconto');
  const link = calls.filter((c) => c.url.endsWith('/links')).at(-1);
  assert.deepEqual(link.body.items.at(-1), { description: 'Gorjeta ao fotógrafo', price: 1000, quantity: 1 });
  assert.equal(db.orders.at(-1).tip_cents, 1000);
  for (const bad of [-100, 50001, 12.5, 'abc']) {
    res = await post(checkout, '/api/checkout', { photo_ids: ids, customer, tip_cents: bad });
    assert.equal(res.status, 400, String(bad));
  }
});
