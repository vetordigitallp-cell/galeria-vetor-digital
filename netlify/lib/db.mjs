// Banco de dados da Galeria Vetor Digital sobre o Netlify Blobs (sem Supabase).
//
// Cada registro é um blob: r/<tabela>/<partição>/<id>. Tabelas grandes são particionadas
// (fotos por evento, itens por pedido). Cada partição tem uma "versão" (v/...) que muda a
// cada escrita e um "instantâneo" (s/...) com todas as linhas, refeito quando fica velho.
// Assim, abrir uma galeria custa 2 leituras, e escritas simultâneas (webhooks) não se perdem.
//
// As regras de acesso são as mesmas do banco anterior (RLS):
//   público  -> só configurações, eventos publicados e fotos publicadas (sem o caminho do original)
//   admin    -> tudo
//   servidor -> tudo (funções internas: checkout, webhook, pedido)
import crypto from 'node:crypto';
import { kv, mapLimit } from './blobstore.mjs';
import { HttpError } from './http.mjs';

export const SETTINGS_DEFAULTS = {
  id: 1, company_name: 'Vetor Digital', tagline: 'Fotografia esportiva', about: null, whatsapp: '5538997251419',
  whatsapp_message: 'Olá! Preciso de ajuda com a compra de fotos na Galeria Vetor Digital.',
  instagram: 'vetordigital.lp', email: null, cnpj: null, city: null, default_price_cents: 1500,
  watermark_text: 'VETOR DIGITAL', face_retention_days: 90, pix_discount_pct: 0
};

const TABLES = {
  settings: { part: null },
  events: { part: null, unique: [['slug']] },
  photos: { part: 'event_id', unique: [['event_id', 'original_name']] },
  photo_faces: { part: 'event_id', intId: true },
  customers: { part: null, unique: [['email']] },
  orders: { part: null, unique: [['code']] },
  order_items: { part: 'order_id', intId: true },
  payment_events: { part: 'order_id', intId: true }
};

const PUBLIC_TABLES = new Set(['settings', 'events', 'photos']);
const HIDDEN_PHOTO_COLS = ['original_path', 'original_name'];

let seq = 0;
const intId = () => Date.now() * 1000 + ((seq = (seq + 1) % 1000));
const partOf = (t, row) => (TABLES[t].part ? String(row[TABLES[t].part] ?? '_') : '_');
const rowKey = (t, part, id) => `r/${t}/${part}/${id}`;
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ leitura por partição
async function readPart(store, t, part) {
  const [ver, snap] = await Promise.all([store.getJSON(`v/${t}/${part}`), store.getJSON(`s/${t}/${part}`)]);
  if (snap && ver != null && snap.t >= ver) return snap.rows;
  const start = Date.now() - 2000; // margem para relógios diferentes entre instâncias
  const keys = await store.list(`r/${t}/${part}/`);
  const rows = (await mapLimit(keys, 32, (k) => store.getJSON(k))).filter(Boolean);
  if (ver != null) await store.setJSON(`s/${t}/${part}`, { t: start, rows });
  return rows;
}

async function partitions(store, t) {
  return (await store.list(`v/${t}/`)).map((k) => k.slice(`v/${t}/`.length));
}

async function bump(store, t, part) {
  await store.setJSON(`v/${t}/${part}`, Date.now());
}

function wantedParts(t, filters) {
  const p = TABLES[t]?.part;
  if (!p) return ['_'];
  for (const [col, op, val] of filters) {
    if (col === p && op === 'eq') return [String(val)];
    if (col === p && op === 'in') return val.map(String);
  }
  return null; // todas
}

async function loadRows(store, t, filters = []) {
  if (t === 'settings') {
    const rows = await readPart(store, t, '_');
    return rows.length ? rows.map((r) => ({ ...SETTINGS_DEFAULTS, ...r })) : [{ ...SETTINGS_DEFAULTS }];
  }
  if (!TABLES[t]) throw new HttpError(400, `Tabela desconhecida: ${t}`);
  const parts = wantedParts(t, filters) || (await partitions(store, t));
  const all = await mapLimit(parts, 16, (p) => readPart(store, t, p));
  return all.flat();
}

// ------------------------------------------------------------------ filtros, seleção, ordenação
function get(row, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
}

function likeRe(pattern) {
  const esc = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

function test(row, [col, op, val]) {
  const v = get(row, col);
  switch (op) {
    case 'eq': return v != null && String(v) === String(val);
    case 'neq': return String(v) !== String(val);
    case 'in': return val.map(String).includes(String(v));
    case 'is': return val === null ? v == null : v === val;
    case 'ilike': return v != null && likeRe(val).test(String(v));
    case 'like': return v != null && new RegExp(likeRe(val).source).test(String(v));
    case 'gt': return v > val;
    case 'gte': return v >= val;
    case 'lt': return v < val;
    case 'lte': return v <= val;
    default: throw new HttpError(400, `Filtro não suportado: ${op}`);
  }
}

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of String(s || '*')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(s) {
  return splitTop(s).map((item) => {
    const m = item.match(/^(?:(\w+):)?(\w+)(!inner)?\((.*)\)$/s);
    if (m) return { embed: true, alias: m[1] || m[2], table: m[2], inner: Boolean(m[3]), cols: m[4] };
    return { col: item };
  });
}

const singular = (t) => t.replace(/s$/, '');

async function resolveEmbeds(store, t, rows, spec, role) {
  for (const e of spec.filter((x) => x.embed)) {
    if (role === 'public' && !PUBLIC_TABLES.has(e.table)) throw new HttpError(403, 'Acesso negado');
    const fk = `${singular(e.table)}_id`;
    const manyToOne = rows.some((r) => fk in r);
    const sub = parseSelect(e.cols);
    if (manyToOne) {
      const ids = [...new Set(rows.map((r) => r[fk]).filter((x) => x != null))];
      let targets = ids.length ? await loadRows(store, e.table, e.table === 'events' ? [] : [['id', 'in', ids]]) : [];
      targets = targets.filter((x) => ids.map(String).includes(String(x.id)));
      targets = applyAccess(e.table, targets, role, await publishedEventIds(store, role));
      const byId = new Map(targets.map((x) => [String(x.id), x]));
      for (const r of rows) {
        const x = byId.get(String(r[fk]));
        r[e.alias] = x ? project(x, sub) : null;
      }
    } else {
      const back = `${singular(t)}_id`;
      const ids = rows.map((r) => r.id);
      const targets = ids.length ? await loadRows(store, e.table, [[back, 'in', ids]]) : [];
      for (const r of rows) r[e.alias] = targets.filter((x) => String(x[back]) === String(r.id)).map((x) => project(x, sub));
    }
  }
  return rows.filter((r) => spec.every((e) => !e.embed || !e.inner || (Array.isArray(r[e.alias]) ? r[e.alias].length : r[e.alias])));
}

function project(row, spec) {
  if (spec.some((x) => x.col === '*')) {
    const out = { ...row };
    for (const e of spec.filter((x) => x.embed)) if (e.alias in row) out[e.alias] = row[e.alias];
    return out;
  }
  const out = {};
  for (const x of spec) {
    if (x.embed) { if (x.alias in row) out[x.alias] = row[x.alias]; } else if (x.col in row) out[x.col] = row[x.col];
    else out[x.col] = null;
  }
  return out;
}

async function publishedEventIds(store, role) {
  if (role !== 'public') return null;
  const evs = await loadRows(store, 'events');
  return new Set(evs.filter((e) => e.published).map((e) => String(e.id)));
}

function applyAccess(t, rows, role, pubEvents) {
  if (role !== 'public') return rows;
  if (!PUBLIC_TABLES.has(t)) throw new HttpError(403, 'Acesso negado');
  if (t === 'events') return rows.filter((r) => r.published);
  if (t === 'photos') {
    return rows.filter((r) => r.published && pubEvents.has(String(r.event_id))).map((r) => {
      const c = { ...r };
      for (const k of HIDDEN_PHOTO_COLS) delete c[k];
      return c;
    });
  }
  return rows;
}

function sortRows(rows, order) {
  if (!order || !order.length) return rows;
  return rows.sort((a, b) => {
    for (const [col, asc = true] of order) {
      const x = get(a, col); const y = get(b, col);
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : -1) * (asc ? 1 : -1);
    }
    return 0;
  });
}

// ------------------------------------------------------------------ consulta genérica
// q = { table, op, select, filters:[[col,op,val]], order:[[col,asc]], range:[a,b], limit, single, count, head, values, onConflict, returning }
export async function runQuery(q, role = 'server') {
  const store = await kv('vd-db');
  const t = q.table;
  const op = q.op || 'select';
  if (t === 'admins') {
    if (role === 'public') throw new HttpError(403, 'Acesso negado');
    return { data: [{ user_id: 'owner', role: 'owner' }], count: 1 };
  }
  if (!TABLES[t]) throw new HttpError(400, `Tabela desconhecida: ${t}`);
  if (role === 'public' && op !== 'select') throw new HttpError(403, 'Acesso negado');
  if (role === 'public' && t === 'photo_faces') throw new HttpError(403, 'Acesso negado');

  if (op === 'insert' || op === 'upsert') return { data: await insertRows(store, t, q.values, op === 'upsert' ? q.onConflict : null) };
  const filters = q.filters || [];
  const plain = filters.filter(([c]) => !c.includes('.'));
  const nested = filters.filter(([c]) => c.includes('.'));

  let rows = (await loadRows(store, t, plain)).filter((r) => plain.every((f) => test(r, f)));
  if (op === 'update') return { data: await updateRows(store, t, rows, q.values || {}) };
  if (op === 'delete') return { data: await deleteRows(store, t, rows) };

  rows = applyAccess(t, rows, role, await publishedEventIds(store, role)).map((r) => ({ ...r }));
  const spec = parseSelect(q.select || '*');
  rows = await resolveEmbeds(store, t, rows, spec, role);
  rows = rows.filter((r) => nested.every((f) => test(r, f)));
  rows = sortRows(rows, q.order);
  const count = rows.length;
  if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
  if (q.limit != null) rows = rows.slice(0, q.limit);
  rows = rows.map((r) => project(r, spec));
  if (q.head) return { data: null, count };
  return { data: rows, count };
}

// Restrições "unique" com uma chave de índice por valor (u/...), sem reler a tabela inteira.
const uKey = (t, cols, row) => `u/${t}/${cols.join('+')}/${crypto.createHash('sha1').update(cols.map((c) => String(row[c]).toLowerCase()).join('\u0000')).digest('hex')}`;

async function checkUnique(store, t, row) {
  for (const cols of TABLES[t].unique || []) {
    if (cols.some((c) => row[c] == null)) continue;
    const owner = await store.getJSON(uKey(t, cols, row));
    if (owner != null && String(owner) !== String(row.id)) {
      // índice pode estar velho (registro apagado): confere se o dono ainda existe
      const still = await loadRows(store, t, TABLES[t].part ? [[TABLES[t].part, 'eq', row[TABLES[t].part]]] : []);
      if (still.some((e) => String(e.id) === String(owner) && cols.every((c) => String(e[c]).toLowerCase() === String(row[c]).toLowerCase()))) {
        const err = new HttpError(409, `Registro duplicado (${cols.join(', ')})`); err.code = '23505'; throw err;
      }
    }
  }
}
async function setUnique(store, t, row, prev) {
  for (const cols of TABLES[t].unique || []) {
    if (prev && cols.every((c) => String(prev[c]) === String(row[c]))) continue;
    if (prev && cols.every((c) => prev[c] != null)) await store.del(uKey(t, cols, prev));
    if (cols.every((c) => row[c] != null)) await store.setJSON(uKey(t, cols, row), row.id);
  }
}
async function delUnique(store, t, row) {
  for (const cols of TABLES[t].unique || []) if (cols.every((c) => row[c] != null)) await store.del(uKey(t, cols, row));
}

function withDefaults(t, row, prev) {
  const r = { ...prev, ...row };
  if (r.id == null) r.id = t === 'settings' ? 1 : TABLES[t].intId ? intId() : crypto.randomUUID();
  if (!prev && !r.created_at && t !== 'settings') r.created_at = nowIso();
  if (t === 'events') {
    r.category ??= 'Corrida de rua'; r.price_cents ??= 1500; r.published ??= false; r.face_search ??= true; r.updated_at = nowIso();
  }
  if (t === 'photos') { r.published ??= true; r.faces_indexed ??= false; r.face_count ??= 0; r.price_cents ??= null; }
  if (t === 'orders') { r.status ??= 'pending'; r.needs_review ??= false; r.pix_discount_pct ??= 0; }
  if (t === 'customers') r.updated_at = nowIso();
  return r;
}

async function setFacesPurge(store, r) {
  const [s] = await loadRows(store, 'settings');
  const days = Number(s.face_retention_days) || 90;
  const base = r.event_date ? new Date(`${r.event_date}T12:00:00-03:00`) : new Date();
  r.faces_purge_at = new Date(base.getTime() + days * 864e5).toISOString();
}

async function insertRows(store, t, values, onConflict) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean);
  const out = [];
  for (const v of list) {
    let prev = null;
    if (onConflict || t === 'settings') {
      const cols = t === 'settings' ? ['id'] : onConflict.split(',');
      const existing = await loadRows(store, t, cols.map((c) => [c, 'eq', v[c]]));
      prev = existing.find((e) => cols.every((c) => String(e[c]).toLowerCase() === String(v[c] ?? (c === 'id' ? 1 : '')).toLowerCase())) || null;
      if (t === 'settings' && prev && !(await store.list('r/settings/_/')).length) prev = null;
    }
    const row = withDefaults(t, prev ? { ...v, id: prev.id } : v, prev);
    if (t === 'events' && (!prev || 'event_date' in v)) await setFacesPurge(store, row);
    const part = partOf(t, row);
    await checkUnique(store, t, row);
    await store.setJSON(rowKey(t, part, row.id), row);
    await setUnique(store, t, row, prev);
    await bump(store, t, part);
    out.push(row);
  }
  return out;
}

async function updateRows(store, t, rows, patch) {
  const touched = new Set();
  const out = [];
  for (const r of rows) {
    const next = { ...r, ...patch };
    if (t === 'events') { next.updated_at = nowIso(); if ('event_date' in patch) await setFacesPurge(store, next); }
    if (t === 'customers') next.updated_at = nowIso();
    const part = partOf(t, next);
    await checkUnique(store, t, next);
    await store.setJSON(rowKey(t, part, r.id), next);
    await setUnique(store, t, next, r);
    touched.add(part);
    out.push(next);
  }
  for (const p of touched) await bump(store, t, p);
  return out;
}

async function deleteRows(store, t, rows) {
  const touched = new Set();
  for (const r of rows) {
    const part = partOf(t, r);
    await store.del(rowKey(t, part, r.id));
    await delUnique(store, t, r);
    touched.add(part);
  }
  for (const p of touched) await bump(store, t, p);
  // cascatas do banco anterior
  if (t === 'events') {
    for (const ev of rows) {
      for (const sub of ['photos', 'photo_faces']) {
        const subRows = await loadRows(store, sub, [['event_id', 'eq', ev.id]]);
        if (subRows.length) await deleteRows(store, sub, subRows);
      }
    }
  }
  if (t === 'photos') {
    for (const ph of rows) {
      const f = (await loadRows(store, 'photo_faces', [['event_id', 'eq', ph.event_id]])).filter((x) => String(x.photo_id) === String(ph.id));
      if (f.length) await deleteRows(store, 'photo_faces', f);
    }
  }
  return rows;
}

// ------------------------------------------------------------------ funções (RPC)
const parseVec = (v) => (Array.isArray(v) ? v : JSON.parse(String(v))).map(Number);
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

export async function rpc(name, args = {}, role = 'server') {
  const store = await kv('vd-db');
  if (name === 'search_faces') {
    const evs = await loadRows(store, 'events', [['id', 'eq', args.p_event]]);
    const ev = evs.find((e) => String(e.id) === String(args.p_event));
    if (!ev || !ev.published || !ev.face_search) return [];
    const q = parseVec(args.p_embedding);
    if (q.length !== 128) throw new HttpError(400, 'Vetor inválido');
    const th = Math.min(Math.max(Number(args.p_threshold) || 0.5, 0.3), 0.6);
    const photos = new Set((await loadRows(store, 'photos', [['event_id', 'eq', ev.id]])).filter((p) => p.published).map((p) => String(p.id)));
    const best = new Map();
    for (const f of await loadRows(store, 'photo_faces', [['event_id', 'eq', ev.id]])) {
      if (!photos.has(String(f.photo_id))) continue;
      const d = dist(q, parseVec(f.embedding));
      if (d < th && d < (best.get(f.photo_id) ?? Infinity)) best.set(f.photo_id, d);
    }
    return [...best].map(([photo_id, distance]) => ({ photo_id, distance })).sort((a, b) => a.distance - b.distance).slice(0, 500);
  }
  if (role === 'public') throw new HttpError(403, 'Acesso negado');

  if (name === 'purge_event_faces') {
    const faces = await loadRows(store, 'photo_faces', [['event_id', 'eq', args.p_event]]);
    await deleteRows(store, 'photo_faces', faces);
    const photos = await loadRows(store, 'photos', [['event_id', 'eq', args.p_event]]);
    await updateRows(store, 'photos', photos.filter((p) => p.faces_indexed || p.face_count), { faces_indexed: false, face_count: 0 });
    return faces.length;
  }
  if (name === 'purge_expired_faces') {
    const now = Date.now(); let n = 0;
    for (const ev of await loadRows(store, 'events')) {
      if (ev.faces_purge_at && Date.parse(ev.faces_purge_at) < now) n += await rpc('purge_event_faces', { p_event: ev.id }, 'server');
    }
    return n;
  }
  if (name === 'admin_stats') {
    const [events, photos, orders, items] = await Promise.all(['events', 'photos', 'orders', 'order_items'].map((t) => loadRows(store, t)));
    const pubEv = new Set(events.filter((e) => e.published).map((e) => String(e.id)));
    const paid = orders.filter((o) => o.status === 'paid');
    const paidIds = new Set(paid.map((o) => String(o.id)));
    const soldItems = items.filter((i) => paidIds.has(String(i.order_id)));
    const top = new Map();
    for (const i of soldItems) {
      const k = String(i.photo_id || i.photo_code + i.event_name);
      const x = top.get(k) || { photo_id: i.photo_id, code: i.photo_code, event: i.event_name, thumb_path: i.thumb_path, sold: 0, revenue_cents: 0 };
      x.sold++; x.revenue_cents += i.price_cents; top.set(k, x);
    }
    const byDay = new Map();
    const since = Date.now() - 30 * 864e5;
    for (const o of paid) {
      if (!o.paid_at || Date.parse(o.paid_at) < since) continue;
      const day = new Date(Date.parse(o.paid_at) - 3 * 36e5).toISOString().slice(0, 10);
      const x = byDay.get(day) || { day, orders: 0, revenue_cents: 0 };
      x.orders++; x.revenue_cents += o.total_cents; byDay.set(day, x);
    }
    return {
      photos_published: photos.filter((p) => p.published && pubEv.has(String(p.event_id))).length,
      photos_total: photos.length, events_total: events.length, events_published: pubEv.size,
      orders_paid: paid.length, orders_pending: orders.filter((o) => o.status === 'pending').length,
      photos_sold: soldItems.length, revenue_cents: paid.reduce((s, o) => s + o.total_cents, 0),
      customers: new Set(paid.map((o) => o.customer_id)).size,
      top_photos: [...top.values()].sort((a, b) => b.sold - a.sold || b.revenue_cents - a.revenue_cents).slice(0, 10),
      sales_by_day: [...byDay.values()].sort((a, b) => (a.day > b.day ? 1 : -1))
    };
  }
  if (name === 'admin_customers') {
    const [customers, orders] = await Promise.all([loadRows(store, 'customers'), loadRows(store, 'orders')]);
    return customers.map((c) => {
      const os = orders.filter((o) => String(o.customer_id) === String(c.id));
      const paid = os.filter((o) => o.status === 'paid');
      return { id: c.id, name: c.name, email: c.email, phone: c.phone, orders: os.length, paid_orders: paid.length,
        paid_total_cents: paid.reduce((s, o) => s + o.total_cents, 0),
        last_order: os.map((o) => o.created_at).sort().at(-1) || null };
    }).sort((a, b) => String(b.last_order || '').localeCompare(String(a.last_order || '')));
  }
  if (name === 'admin_team') {
    return [{ user_id: 'owner', email: process.env.ADMIN_EMAIL || '', role: 'owner', created_at: null }];
  }
  if (name === 'grant_admin' || name === 'revoke_admin') {
    throw new HttpError(400, 'Nesta versão o painel tem um único acesso (o do dono), definido nas variáveis ADMIN_EMAIL e ADMIN_PASSWORD do Netlify.');
  }
  throw new HttpError(400, `Função desconhecida: ${name}`);
}

// ------------------------------------------------------------------ adaptador no formato PostgREST
// Permite que as funções de pagamento continuem usando rest('orders?id=eq.X', {...}) sem mudanças.
function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  return v;
}

export function parseRestPath(path) {
  const [table, qs = ''] = path.split('?');
  const q = { table, filters: [], select: '*' };
  for (const [k, raw] of new URLSearchParams(qs)) {
    if (k === 'select') q.select = raw;
    else if (k === 'order') q.order = raw.split(',').map((x) => { const [c, d] = x.split('.'); return [c, d !== 'desc']; });
    else if (k === 'on_conflict') q.onConflict = raw;
    else if (k === 'limit') q.limit = Number(raw);
    else {
      const m = raw.match(/^(\w+)\.(.*)$/s);
      if (!m) continue;
      const [, op, val] = m;
      if (op === 'in') q.filters.push([k, 'in', val.replace(/^\(|\)$/g, '').split(',').filter(Boolean)]);
      else if (op === 'is') q.filters.push([k, 'is', parseValue(val)]);
      else q.filters.push([k, op, parseValue(val)]);
    }
  }
  return q;
}

export async function restLocal(path, { method = 'GET', body, prefer = '' } = {}) {
  const q = parseRestPath(path);
  if (method === 'GET') return (await runQuery(q, 'server')).data;
  if (method === 'POST') {
    q.op = q.onConflict && /merge-duplicates/.test(prefer) ? 'upsert' : 'insert';
    q.values = body;
    const { data } = await runQuery(q, 'server');
    return /return=representation/.test(prefer) ? data : null;
  }
  if (method === 'PATCH') { q.op = 'update'; q.values = body; await runQuery(q, 'server'); return null; }
  if (method === 'DELETE') { q.op = 'delete'; await runQuery(q, 'server'); return null; }
  throw new HttpError(405, 'Método não suportado');
}
