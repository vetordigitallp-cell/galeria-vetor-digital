// Painel administrativo da Galeria Vetor Digital (acesso restrito à equipe).
import { sb, BACKEND, CONFIGURED, el, ICONS, LOGO, money, dateTimeBR, publicUrl, toast, setupScreen, backBar, trackNav } from './core.js';
import { viewEvents, viewEventForm, viewEvent, isUploading, viewDelivery } from './admin-events.js';

const app = document.getElementById('app');
let me = null; // { user, role }
let rid = 0;

// ---------------------------------------------------------------- acesso
async function whoAmI() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('admins').select('role').eq('user_id', session.user.id).maybeSingle();
  if (error || !data) return { user: session.user, role: null };
  return { user: session.user, role: data.role };
}

function loginScreen(msg) {
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'username', required: true });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const err = el('div', { class: msg ? 'alert warn' : 'alert err', hidden: !msg }, msg || '');
  const btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar');
  const reset = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Esqueci minha senha');
  const form = el('form', { class: 'card stack' },
    el('div', { class: 'brand', html: LOGO }, el('div', {}, el('b', {}, 'Vetor Digital'), el('span', {}, 'Painel da galeria'))),
    el('div', { class: 'field' }, el('label', {}, 'E-mail'), email),
    el('div', { class: 'field' }, el('label', {}, 'Senha'), pass),
    err, btn, reset);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    btn.disabled = false;
    if (error) { err.className = 'alert err'; err.textContent = 'E-mail ou senha incorretos.'; err.hidden = false; return; }
    boot();
  });
  reset.addEventListener('click', async () => {
    if (!email.value.trim()) { err.className = 'alert warn'; err.textContent = 'Digite seu e-mail acima primeiro.'; err.hidden = false; return; }
    await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    err.className = 'alert ok'; err.textContent = 'Se o e-mail for da equipe, você receberá um link para criar nova senha.'; err.hidden = false;
  });
  app.replaceChildren(el('div', { class: 'login' }, form));
}

async function passwordRecovery() {
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Salvar nova senha');
  const form = el('form', { class: 'card stack' }, el('h2', { style: { fontSize: '26px' } }, 'Nova senha'),
    el('div', { class: 'field' }, el('label', {}, 'Nova senha (mínimo 8 caracteres)'), pass), btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: pass.value });
    if (error) return toast(error.message, 5000);
    toast('Senha atualizada'); history.replaceState(null, '', location.pathname); boot();
  });
  app.replaceChildren(el('div', { class: 'login' }, form));
}

// ---------------------------------------------------------------- estrutura
const NAV = [
  ['painel', 'Painel'], ['eventos', 'Eventos'], ['entrega', 'Entrega'], ['pedidos', 'Pedidos'], ['clientes', 'Clientes'], ['config', 'Configurações'], ['equipe', 'Equipe']
];
// O fotógrafo só vê os eventos (e a troca da própria senha).
const PHOTOG_NAV = [['eventos', 'Eventos'], ['senha', 'Minha senha']];
export const ROLE_NAMES = { owner: 'Dono', admin: 'Administrador', photographer: 'Fotógrafo' };
const isPhotographer = () => me && me.role === 'photographer';

function shell(active, nodes) {
  const logout = el('button', { class: 'btn btn-sm btn-ghost' }, 'Sair');
  logout.addEventListener('click', async () => {
    if (isUploading() && !confirm('Há um envio em andamento. Sair mesmo assim?')) return;
    await sb.auth.signOut(); boot();
  });
  const items = isPhotographer() ? PHOTOG_NAV : NAV;
  const current = items.find(([k]) => k === active);
  // Menu "sanduíche": no celular as áreas ficam escondidas e abrem num toque.
  const toggle = el('button', { class: 'menu-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'adm-menu', html: '<i class="burger" aria-hidden="true"><span></span><span></span><span></span></i>' },
    el('em', {}, current ? current[1] : 'Menu'));
  const menu = el('div', { class: 'side-menu', id: 'adm-menu' },
    el('nav', { 'aria-label': 'Painel' }, items.map(([k, t]) => el('a', { href: `#/${k}`, 'aria-current': active === k ? 'page' : false }, t))),
    el('div', { class: 'who' }, el('span', {}, me.user.email), el('span', { class: 'tag on', style: { justifySelf: 'start' } }, ROLE_NAMES[me.role] || 'Equipe'),
      el('a', { href: './', target: '_blank', class: 'muted' }, 'Abrir o site ↗'), logout));
  const side = el('aside', { class: 'side' },
    el('div', { class: 'side-top' },
      el('a', { class: 'brand', href: isPhotographer() ? '#/eventos' : '#/painel', html: LOGO }, el('div', {}, el('b', {}, 'Vetor Digital'), el('span', {}, 'Painel'))),
      toggle),
    menu);
  toggle.addEventListener('click', () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('nav a')) side.classList.remove('open'); });
  return el('div', { class: 'adm' }, side, el('main', { class: 'content' }, nodes));
}

// Gráfico dos últimos 30 dias: sempre 30 colunas (dias sem venda aparecem vazios),
// para que um único dia com venda não vire uma barra ocupando o gráfico inteiro.
function salesChart(rows) {
  const byDay = new Map(rows.map((d) => [d.day, d]));
  const today = new Date(Date.now() - 3 * 36e5); // horário de Brasília
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
    days.push(byDay.get(day) || { day, orders: 0, revenue_cents: 0 });
  }
  const total = days.reduce((a, d) => a + d.revenue_cents, 0);
  const orders = days.reduce((a, d) => a + d.orders, 0);
  if (!total) return el('p', { class: 'muted' }, 'As vendas dos últimos 30 dias aparecem aqui.');
  const max = Math.max(...days.map((d) => d.revenue_cents));
  const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const tip = (d) => `${br(d.day)}: ${money(d.revenue_cents)} · ${d.orders} ${d.orders === 1 ? 'pedido' : 'pedidos'}`;
  return el('div', { class: 'chart' },
    el('p', { class: 'muted', style: { margin: 0 } }, `${money(total)} em ${orders} ${orders === 1 ? 'pedido pago' : 'pedidos pagos'} · maior dia: ${money(max)}`),
    el('div', { class: 'bars', role: 'img', 'aria-label': `Faturamento diário dos últimos 30 dias, total ${money(total)}` },
      days.map((d) => el('div', { class: d.revenue_cents ? 'bar' : 'bar zero', title: tip(d),
        style: { height: d.revenue_cents ? `${Math.max(6, (d.revenue_cents / max) * 100)}%` : '2px' } }))),
    el('div', { class: 'bars-axis' }, el('span', {}, br(days[0].day)), el('span', {}, br(days[15].day)), el('span', {}, 'hoje')));
}

// ---------------------------------------------------------------- painel (indicadores)
async function viewDashboard() {
  const { data: s, error } = await sb.rpc('admin_stats');
  if (error) throw error;
  const kpi = (label, value, hl) => el('div', { class: 'kpi' + (hl ? ' hl' : '') }, el('small', {}, label), el('b', {}, value));
  const n = (x) => Number(x || 0).toLocaleString('pt-BR');
  const chart = salesChart(s.sales_by_day || []);
  const top = s.top_photos || [];
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Visão geral'), el('h1', {}, 'Painel')),
      el('a', { class: 'btn btn-primary', href: '#/eventos/novo', html: ICONS.plus + ' Novo evento' })),
    el('div', { class: 'kpis' },
      kpi('Faturamento', money(s.revenue_cents), true),
      kpi('Vendas (pedidos pagos)', n(s.orders_paid)),
      kpi('Fotos vendidas', n(s.photos_sold)),
      kpi('Fotos publicadas', n(s.photos_published)),
      kpi('Eventos', `${n(s.events_published)} / ${n(s.events_total)}`),
      kpi('Pedidos aguardando', n(s.orders_pending)),
      kpi('Clientes compradores', n(s.customers))),
    el('div', { class: 'card stack' }, el('h3', {}, 'Faturamento diário (últimos 30 dias)'), chart),
    el('div', { class: 'card stack' }, el('h3', {}, 'Fotografias mais vendidas'),
      top.length ? el('div', { class: 'tbl-wrap', style: { border: 0 } }, el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Foto'), el('th', {}, 'Evento'), el('th', { class: 'num' }, 'Vendas'), el('th', { class: 'num' }, 'Receita'))),
        el('tbody', {}, top.map((t) => el('tr', {},
          el('td', {}, t.thumb_path ? el('img', { src: publicUrl(t.thumb_path), alt: '' }) : ''),
          el('td', { class: 'mono' }, t.code), el('td', {}, t.event || '—'),
          el('td', { class: 'num' }, n(t.sold)), el('td', { class: 'num' }, money(t.revenue_cents)))))))
        : el('p', { class: 'muted' }, 'Ainda não há vendas.'))
  ];
}

// ---------------------------------------------------------------- pedidos
const STATUS_TAG = { paid: ['on', 'Pago'], pending: ['warn', 'Aguardando'], failed: ['bad', 'Falhou'], canceled: ['bad', 'Cancelado'], refunded: ['bad', 'Estornado'] };
const statusTag = (s) => { const [c, t] = STATUS_TAG[s] || ['off', s]; return el('span', { class: 'tag ' + c }, t); };
const method = (o) => o.capture_method === 'pix' ? 'Pix' : o.capture_method === 'credit_card' ? `Cartão${o.installments > 1 ? ` ${o.installments}x` : ''}` : '—';

function csv(rows, name) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

async function viewOrders() {
  let status = 'all';
  let term = '';
  const tbody = el('tbody');
  const info = el('span', { class: 'muted', style: { fontSize: '14px' } });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Código do pedido ou e-mail', style: { maxWidth: '300px' } });
  const tabs = el('div', { class: 'tabs-row' }, [['all', 'Todos'], ['paid', 'Pagos'], ['pending', 'Aguardando'], ['failed', 'Falhos']].map(([k, t]) => {
    const b = el('button', { 'aria-pressed': String(k === status) }, t);
    b.addEventListener('click', () => { status = k; tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
    return b;
  }));
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = search.value.trim(); load(); }, 300); });

  async function fetchOrders(limit = 200) {
    let q = sb.from('orders').select('id,code,status,total_cents,capture_method,installments,created_at,paid_at,customer:customers!inner(name,email,phone),order_items(id)')
      .order('created_at', { ascending: false }).limit(limit);
    if (status !== 'all') q = q.eq('status', status);
    if (term) q = term.includes('@') ? q.ilike('customer.email', `%${term}%`) : q.ilike('code', `%${term}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async function load() {
    try {
      const data = await fetchOrders();
      info.textContent = `${data.length} pedido(s)${data.length === 200 ? ' (mostrando os 200 mais recentes)' : ''}`;
      tbody.replaceChildren(...data.map((o) => el('tr', { class: 'click', onclick: () => { location.hash = `#/pedidos/${o.id}`; } },
        el('td', { class: 'mono' }, o.code),
        el('td', {}, el('div', {}, o.customer?.name || '—'), el('div', { class: 'muted', style: { fontSize: '12px' } }, o.customer?.email)),
        el('td', { class: 'num' }, String(o.order_items?.length ?? '')),
        el('td', { class: 'num' }, money(o.total_cents)),
        el('td', {}, statusTag(o.status)),
        el('td', {}, method(o)),
        el('td', {}, dateTimeBR(o.created_at)))));
      if (!data.length) tbody.replaceChildren(el('tr', {}, el('td', { colspan: '7', class: 'muted' }, 'Nenhum pedido encontrado.')));
    } catch (e) { toast(e.message, 5000); }
  }
  const exp = el('button', { class: 'btn btn-sm' }, 'Exportar CSV');
  exp.addEventListener('click', async () => {
    const data = await fetchOrders(5000);
    csv([['Pedido', 'Status', 'Cliente', 'E-mail', 'WhatsApp', 'Fotos', 'Total (R$)', 'Pagamento', 'Criado em', 'Pago em'],
      ...data.map((o) => [o.code, o.status, o.customer?.name, o.customer?.email, o.customer?.phone, o.order_items?.length, (o.total_cents / 100).toFixed(2).replace('.', ','), method(o), dateTimeBR(o.created_at), dateTimeBR(o.paid_at)])],
    `pedidos-vetor-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  await load();
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Vendas'), el('h1', {}, 'Pedidos e pagamentos')), el('div', { class: 'row' }, search, exp)),
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, tabs, info),
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Pedido'), el('th', {}, 'Cliente'), el('th', { class: 'num' }, 'Fotos'), el('th', { class: 'num' }, 'Total'), el('th', {}, 'Status'), el('th', {}, 'Pagamento'), el('th', {}, 'Data'))),
      tbody))
  ];
}

async function viewOrder(id) {
  const { data: o, error } = await sb.from('orders').select('*,customer:customers(name,email,phone)').eq('id', id).single();
  if (error) throw error;
  const { data: items } = await sb.from('order_items').select('*').eq('order_id', id).order('id');
  const { data: evs } = await sb.from('payment_events').select('*').eq('order_id', id).order('created_at', { ascending: false });
  const check = el('button', { class: 'btn btn-primary btn-sm' }, 'Conferir na InfinitePay');
  const out = el('div', { class: 'alert', hidden: true });
  check.addEventListener('click', async () => {
    check.disabled = true;
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/api/admin/order-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ order_id: id }) });
    const data = await res.json().catch(() => ({}));
    check.disabled = false;
    out.className = 'alert ' + (data.status === 'paid' ? 'ok' : 'warn');
    out.textContent = data.message || data.error || 'Sem resposta';
    out.hidden = false;
    if (data.status && data.status !== o.status) setTimeout(() => route(), 1200);
  });
  const adminPost = async (url, payload) => {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha na operação');
    return data;
  };
  const act = (label, action, confirmMsg, cls = 'btn btn-sm') => {
    const b = el('button', { class: cls }, label);
    b.addEventListener('click', async () => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      b.disabled = true;
      try { await adminPost('/api/admin/order-status', { order_id: id, action }); toast('Pedido atualizado'); route(); }
      catch (e) { toast(e.message, 5000); b.disabled = false; }
    });
    return b;
  };
  const refundBtn = o.status === 'paid' ? act('Marcar como estornado', 'refund', 'Use isto depois de estornar a venda no App/Conta Web da InfinitePay. Os downloads do cliente serão bloqueados. Continuar?') : null;
  const reactBtn = o.status === 'refunded' ? act('Reativar pedido', 'reactivate', 'Reativar libera de novo os downloads do cliente. Continuar?') : null;
  const review = o.needs_review ? el('div', { class: 'alert warn' }, el('b', {}, 'Revisar: '), o.review_note || 'Este pedido precisa de conferência.', ' ', act('Marcar como revisado', 'clear_review')) : null;
  const wa = o.customer?.phone ? `https://wa.me/${o.customer.phone.length <= 11 ? '55' : ''}${o.customer.phone}` : null;
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Pedido'), el('h1', { class: 'mono' }, o.code)),
      el('div', { class: 'row' }, statusTag(o.status), check, refundBtn, reactBtn)),
    review,
    out,
    el('div', { class: 'card' }, el('dl', { class: 'kv' },
      el('dt', {}, 'Cliente'), el('dd', {}, o.customer?.name || '—'),
      el('dt', {}, 'E-mail'), el('dd', {}, o.customer?.email || '—'),
      el('dt', {}, 'WhatsApp'), el('dd', {}, wa ? el('a', { href: wa, target: '_blank', rel: 'noopener' }, o.customer.phone) : '—'),
      o.subtotal_cents != null ? [el('dt', {}, 'Subtotal das fotos'), el('dd', {}, money(o.subtotal_cents))] : null,
      o.discount_cents ? [el('dt', {}, 'Desconto progressivo'), el('dd', {}, '− ' + money(o.discount_cents) + ' (' + (o.pricing || []).filter((a) => a.discount_pct).map((a) => `${a.event_name}: ${a.count} fotos, ${a.discount_pct}%`).join(' · ') + ')')] : null,
      o.tip_cents ? [el('dt', {}, 'Gorjeta ao fotógrafo'), el('dd', {}, money(o.tip_cents))] : null,
      el('dt', {}, 'Total cobrado'), el('dd', {}, money(o.total_cents)),
      el('dt', {}, 'Valor pago'), el('dd', {}, o.paid_amount_cents ? money(o.paid_amount_cents) : '—'),
      el('dt', {}, 'Pagamento'), el('dd', {}, method(o)),
      el('dt', {}, 'Criado em'), el('dd', {}, dateTimeBR(o.created_at)),
      el('dt', {}, 'Pago em'), el('dd', {}, dateTimeBR(o.paid_at) || '—'),
      el('dt', {}, 'Transação (NSU)'), el('dd', { class: 'mono' }, o.transaction_nsu || '—'),
      el('dt', {}, 'Fatura (slug)'), el('dd', { class: 'mono' }, o.invoice_slug || '—'),
      el('dt', {}, 'Comprovante'), el('dd', {}, o.receipt_url ? el('a', { href: o.receipt_url, target: '_blank', rel: 'noopener' }, 'Abrir') : '—'))),
    el('div', { class: 'card stack' }, el('h3', {}, `Fotos (${items.length})`),
      el('div', { class: 'agrid' }, items.map((i) => el('div', { class: 'athumb', style: { cursor: 'default' } },
        el('img', { src: publicUrl(i.thumb_path), alt: '' }),
        el('div', { class: 'cap' }, el('span', { class: 'mono' }, i.photo_code), el('span', {}, money(i.price_cents))))))),
    el('div', { class: 'card stack' }, el('h3', {}, 'Histórico de pagamento'),
      evs.length ? evs.map((e) => el('details', {},
        el('summary', {}, `${dateTimeBR(e.created_at)} · ${e.source} · `, e.verified ? el('span', { class: 'tag on' }, 'confirmado pela InfinitePay') : el('span', { class: 'tag off' }, 'não confirmado')),
        el('pre', { class: 'json' }, JSON.stringify({ recebido: e.payload, conferencia: e.check_result }, null, 2))))
        : el('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum aviso da InfinitePay ainda.')),
    el('a', { class: 'muted', href: '#/pedidos' }, '← Todos os pedidos')
  ];
}

// ---------------------------------------------------------------- clientes
async function viewCustomers() {
  const { data, error } = await sb.rpc('admin_customers');
  if (error) throw error;
  const exp = el('button', { class: 'btn btn-sm' }, 'Exportar CSV');
  exp.addEventListener('click', () => csv([['Nome', 'E-mail', 'WhatsApp', 'Pedidos', 'Pedidos pagos', 'Total pago (R$)', 'Último pedido'],
    ...data.map((c) => [c.name, c.email, c.phone, c.orders, c.paid_orders, (c.paid_total_cents / 100).toFixed(2).replace('.', ','), dateTimeBR(c.last_order)])], `clientes-vetor-${new Date().toISOString().slice(0, 10)}.csv`));
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Relacionamento'), el('h1', {}, 'Clientes')), exp),
    data.length ? el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Cliente'), el('th', {}, 'WhatsApp'), el('th', { class: 'num' }, 'Pedidos'), el('th', { class: 'num' }, 'Pagos'), el('th', { class: 'num' }, 'Total pago'), el('th', {}, 'Último pedido'))),
      el('tbody', {}, data.map((c) => el('tr', {},
        el('td', {}, el('div', {}, c.name || '—'), el('div', { class: 'muted', style: { fontSize: '12px' } }, c.email)),
        el('td', {}, c.phone || '—'),
        el('td', { class: 'num' }, String(c.orders)), el('td', { class: 'num' }, String(c.paid_orders)),
        el('td', { class: 'num' }, money(c.paid_total_cents)), el('td', {}, dateTimeBR(c.last_order)))))))
      : el('div', { class: 'empty' }, el('b', {}, 'Nenhum cliente ainda'), 'Os clientes aparecem aqui após o primeiro pedido.')
  ];
}

// ---------------------------------------------------------------- configurações
async function viewSettings() {
  const { data: s, error } = await sb.from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  const field = (key, label, attrs = {}, hint) => {
    const input = attrs.textarea ? el('textarea', { class: 'input', name: key }, s[key] || '') : el('input', { class: 'input', name: key, value: s[key] ?? '', ...attrs });
    return el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('span', { class: 'muted', style: { fontSize: '12px' } }, hint) : null);
  };
  const form = el('form', { class: 'stack' },
    el('div', { class: 'card stack' }, el('h3', {}, 'Atendimento'),
      el('div', { class: 'form-grid two' },
        field('whatsapp', 'Número do WhatsApp', { inputmode: 'numeric', placeholder: '5538999999999' }, 'Com DDI e DDD, só números. Ex.: 55 + 38 + número.'),
        field('instagram', 'Instagram', { placeholder: 'vetordigital.lp' })),
      field('whatsapp_message', 'Mensagem inicial do WhatsApp')),
    el('div', { class: 'card stack' }, el('h3', {}, 'Informações institucionais'),
      el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Preencha apenas dados verdadeiros. Campos vazios não aparecem no site.'),
      el('div', { class: 'form-grid two' },
        field('company_name', 'Nome da empresa'), field('tagline', 'Frase de apresentação'),
        field('cnpj', 'CNPJ'), field('city', 'Cidade / UF'), field('email', 'E-mail de contato', { type: 'email' })),
      field('about', 'Sobre a empresa (aparece na página inicial)', { textarea: true })),
    el('div', { class: 'card stack' }, el('h3', {}, 'Vendas, marca-d\'água e privacidade'),
      el('div', { class: 'form-grid two' },
        field('default_price', 'Preço padrão para novos eventos (R$)', { value: (s.default_price_cents / 100).toFixed(2).replace('.', ','), inputmode: 'decimal' }),
        field('watermark_text', 'Texto da marca-d\'água', {}, 'Aplicado nas prévias das próximas fotos enviadas.'),
        field('pix_discount_pct', 'Desconto no Pix (%)', { type: 'number', min: '0', max: '99', step: '0.5' }, 'Aplicado pela InfinitePay na página de pagamento. Exige a API Key configurada no servidor. 0 = sem desconto.'),
        field('face_retention_days', 'Dias para apagar os dados faciais após o evento', { type: 'number', min: '1', max: '365' }, 'Vale para eventos criados ou com data alterada depois desta mudança.'))),
    el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar configurações')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const price = Math.round(parseFloat(String(fd.default_price).replace(/\./g, '').replace(',', '.')) * 100);
    if (!Number.isFinite(price) || price < 100) return toast('Preço mínimo R$ 1,00');
    const patch = {
      whatsapp: fd.whatsapp.replace(/\D/g, '') || null, whatsapp_message: fd.whatsapp_message || null,
      instagram: fd.instagram.replace(/^@/, '').trim() || null, company_name: fd.company_name.trim() || 'Vetor Digital',
      tagline: fd.tagline.trim() || null, cnpj: fd.cnpj.trim() || null, city: fd.city.trim() || null,
      email: fd.email.trim() || null, about: fd.about.trim() || null, default_price_cents: price,
      watermark_text: fd.watermark_text.trim() || 'VETOR DIGITAL',
      pix_discount_pct: Math.min(99, Math.max(0, parseFloat(String(fd.pix_discount_pct || '0').replace(',', '.')) || 0)),
      face_retention_days: Math.min(365, Math.max(1, parseInt(fd.face_retention_days, 10) || 90))
    };
    const { error: err } = await sb.from('settings').update(patch).eq('id', 1);
    toast(err ? 'Erro: ' + err.message : 'Configurações salvas', err ? 5000 : 2500);
  });
  return [el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Ajustes'), el('h1', {}, 'Configurações'))), form];
}

// ---------------------------------------------------------------- equipe e permissões
// Troca da própria senha (pessoas da equipe; o acesso principal usa a variável do Netlify).
function myPasswordForm() {
  const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const nw = el('input', { class: 'input', type: 'password', minlength: '10', autocomplete: 'new-password', required: true });
  const form = el('form', { class: 'card stack' }, el('h3', {}, 'Minha senha'),
    el('div', { class: 'form-grid two' }, el('div', { class: 'field' }, el('label', {}, 'Senha atual'), cur), el('div', { class: 'field' }, el('label', {}, 'Nova senha (mínimo 10)'), nw)),
    el('div', {}, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Trocar minha senha')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error: err } = await sb.rpc('change_password', { p_current: cur.value, p_new: nw.value });
    if (err) return toast(err.message, 5000);
    toast('Senha trocada. Entre de novo com a senha nova.', 5000);
    await sb.auth.signOut(); boot();
  });
  return form;
}

async function viewMyPassword() {
  const head = el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Sua conta'), el('h1', {}, 'Minha senha')));
  if (me.user.id === 'owner') return [head, el('p', { class: 'muted' }, 'A senha do acesso principal é a variável ADMIN_PASSWORD do Netlify. Para trocá-la, altere lá e publique de novo.')];
  return [head, el('p', { class: 'muted', style: { margin: 0 } }, `Você entra como ${me.user.email} (${ROLE_NAMES[me.role] || 'Equipe'}).`), myPasswordForm()];
}

async function viewTeam() {
  const { data, error } = await sb.rpc('admin_team');
  if (error) throw error;
  const owner = me.role === 'owner';
  const local = BACKEND === 'netlify';
  const roleName = (r) => ({ owner: 'Dono (acesso total)', admin: 'Administrador', photographer: 'Fotógrafo' }[r] || r);

  // Adicionar pessoa (sócio, funcionário)
  const email = el('input', { class: 'input', type: 'email', placeholder: 'email@exemplo.com', required: true, autocomplete: 'off' });
  const role = el('select', { class: 'input' },
    el('option', { value: 'photographer' }, 'Fotógrafo — só cria eventos e cuida das fotos'),
    el('option', { value: 'admin' }, 'Administrador — tudo, menos mexer na equipe'),
    el('option', { value: 'owner' }, 'Dono — acesso total, inclusive a equipe'));
  const pass = el('input', { class: 'input', type: 'text', minlength: '10', placeholder: 'mínimo 10 caracteres', required: local, autocomplete: 'new-password' });
  const gen = el('button', { class: 'btn btn-sm', type: 'button' }, 'Gerar senha');
  gen.addEventListener('click', () => {
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint32Array(14));
    pass.value = Array.from(r, (x) => abc[x % abc.length]).join('');
  });
  const add = el('form', { class: 'card stack' }, el('h3', {}, 'Adicionar pessoa à equipe'),
    local
      ? el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Defina uma senha inicial e passe para a pessoa por um canal seguro (ligação ou pessoalmente). Ela entra em ', el('b', {}, location.origin + '/admin'), ' e pode trocar a senha em Equipe → Minha senha.')
      : el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Primeiro crie o usuário no Supabase (Authentication > Users > Add user). Depois informe o e-mail aqui.'),
    el('div', { class: 'form-grid two' },
      el('div', { class: 'field' }, el('label', {}, 'E-mail da pessoa'), email),
      el('div', { class: 'field' }, el('label', {}, 'Permissão'), role)),
    local ? el('div', { class: 'field' }, el('label', {}, 'Senha inicial'), el('div', { class: 'row' }, pass, gen)) : null,
    el('div', {}, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Dar acesso')));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error: err } = await sb.rpc('grant_admin', { p_email: email.value, p_role: role.value, p_password: pass.value });
    if (err) return toast(err.message, 6000);
    toast('Acesso criado. Passe o e-mail e a senha para a pessoa.', 6000); route();
  });

  const actions = (m) => {
    if (!owner || m.main || m.user_id === me.user.id) return '';
    const rm = el('button', { class: 'btn btn-sm btn-danger' }, 'Remover');
    rm.addEventListener('click', async () => {
      if (!confirm(`Remover o acesso de ${m.email}? A pessoa sai do painel na hora.`)) return;
      const { error: err } = await sb.rpc('revoke_admin', { p_user: m.user_id });
      if (err) return toast(err.message, 5000);
      toast('Acesso removido'); route();
    });
    if (!local) return rm;
    const rs = el('button', { class: 'btn btn-sm' }, 'Nova senha');
    rs.addEventListener('click', async () => {
      const np = prompt(`Nova senha para ${m.email} (mínimo 10 caracteres):`);
      if (np == null) return;
      const { error: err } = await sb.rpc('reset_admin_password', { p_user: m.user_id, p_password: np });
      if (err) return toast(err.message, 5000);
      toast('Senha redefinida. As sessões abertas dessa pessoa foram encerradas.', 5000);
    });
    return el('div', { class: 'row', style: { justifyContent: 'flex-end' } }, rs, rm);
  };

  const mine = local && me.user.id !== 'owner' ? myPasswordForm() : null;

  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Permissões'), el('h1', {}, 'Equipe'))),
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'E-mail'), el('th', {}, 'Permissão'), el('th', {}, 'Desde'), el('th', {}, ''))),
      el('tbody', {}, data.map((m) => el('tr', {},
        el('td', {}, m.email, m.main ? el('span', { class: 'tag', style: { marginLeft: '8px' } }, 'Principal') : null),
        el('td', {}, roleName(m.role)),
        el('td', {}, m.created_at ? dateTimeBR(m.created_at) : '—'),
        el('td', { class: 'num' }, actions(m))))))),
    owner ? add : el('p', { class: 'muted' }, 'Somente quem tem permissão de Dono pode adicionar ou remover pessoas da equipe.'),
    mine,
    local ? el('p', { class: 'muted', style: { fontSize: '13px' } }, 'O acesso Principal é o e-mail e a senha das variáveis ADMIN_EMAIL e ADMIN_PASSWORD do Netlify. Para trocá-los, altere lá e publique de novo.') : null
  ].filter(Boolean);
}

// ---------------------------------------------------------------- roteador
// Tela "pai" de cada área do painel, usada pelo botão Voltar quando não há tela anterior nesta aba.
function adminBackFor(p0, p1, p2) {
  if (!p0 || p0 === 'painel') return null; // visão geral não tem Voltar
  if (p0 === 'eventos' && !p1 && window.__vdRole === 'photographer') return null; // início do fotógrafo
  if (p0 === 'senha') return backBar(window.__vdRole === 'photographer' ? '#/eventos' : '#/painel', 'Voltar');
  if (p0 === 'eventos' && p1 && p2 === 'editar') return backBar(`#/eventos/${p1}`, 'Voltar');
  if (p0 === 'eventos' && p1) return backBar('#/eventos', 'Voltar');
  if (p0 === 'pedidos' && p1) return backBar('#/pedidos', 'Voltar');
  return backBar('#/painel', 'Voltar');
}

async function route() {
  const my = ++rid;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [p0, p1, p2] = parts;
  let active = p0 || 'painel';
  let view;
  // Fotógrafo: só eventos e "Minha senha"; qualquer outra área volta para Eventos.
  if (isPhotographer() && !['eventos', 'senha'].includes(p0)) { location.replace('#/eventos'); return; }
  if (p0 === 'senha') view = viewMyPassword();
  else if (!p0 || p0 === 'painel') view = viewDashboard();
  else if (p0 === 'eventos' && p1 === 'novo') view = viewEventForm(null);
  else if (p0 === 'eventos' && p1 && p2 === 'editar') view = viewEventForm(p1);
  else if (p0 === 'eventos' && p1) view = viewEvent(p1);
  else if (p0 === 'eventos') view = viewEvents();
  else if (p0 === 'entrega') view = viewDelivery();
  else if (p0 === 'pedidos' && p1) view = viewOrder(p1);
  else if (p0 === 'pedidos') view = viewOrders();
  else if (p0 === 'clientes') view = viewCustomers();
  else if (p0 === 'config') view = viewSettings();
  else if (p0 === 'equipe') view = viewTeam();
  else { active = 'painel'; view = viewDashboard(); }
  trackNav();
  const back = adminBackFor(p0, p1, p2);
  const withBack = (nodes) => (back ? [back, ...[nodes].flat()] : nodes);
  app.replaceChildren(shell(active, [el('div', { class: 'row' }, el('span', { class: 'spinner' }), el('span', { class: 'muted' }, 'Carregando…'))]));
  try {
    const nodes = await view;
    if (my !== rid) return;
    app.replaceChildren(shell(active, withBack(nodes)));
  } catch (e) {
    console.error(e);
    if (my !== rid) return;
    app.replaceChildren(shell(active, withBack([el('div', { class: 'alert err' }, 'Erro: ' + (e.message || e))])));
  }
}

let skipNext = false;
window.addEventListener('hashchange', () => {
  if (skipNext) { skipNext = false; return; }
  if (isUploading() && !confirm('Há um envio de fotos em andamento. Se sair desta página o envio continua, mas você perde o acompanhamento. Continuar?')) {
    skipNext = true; history.back(); return;
  }
  if (me && me.role) route();
});

async function boot() {
  if (!CONFIGURED) { app.replaceChildren(setupScreen()); return; }
  if (location.hash.includes('type=recovery')) {
    await new Promise((r) => setTimeout(r, 300));
    return passwordRecovery();
  }
  me = await whoAmI();
  if (!me) return loginScreen();
  if (!me.role) { await sb.auth.signOut(); return loginScreen('Sua sessão terminou ou este acesso foi removido. Entre novamente; se não conseguir, fale com o dono do painel.'); }
  window.__vdRole = me.role;
  if (!location.hash || location.hash === '#') location.hash = me.role === 'photographer' ? '#/eventos' : '#/painel';
  else route();
}
boot();
