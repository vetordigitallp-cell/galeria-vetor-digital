// Painel administrativo da Galeria Vetor Digital (acesso restrito à equipe).
import { sb, CONFIGURED, el, ICONS, LOGO, money, dateTimeBR, publicUrl, toast, setupScreen } from './core.js';
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

function shell(active, nodes) {
  const logout = el('button', { class: 'btn btn-sm btn-ghost' }, 'Sair');
  logout.addEventListener('click', async () => {
    if (isUploading() && !confirm('Há um envio em andamento. Sair mesmo assim?')) return;
    await sb.auth.signOut(); boot();
  });
  return el('div', { class: 'adm' },
    el('aside', { class: 'side' },
      el('a', { class: 'brand', href: '#/painel', html: LOGO }, el('div', {}, el('b', {}, 'Vetor Digital'), el('span', {}, 'Painel'))),
      el('nav', { 'aria-label': 'Painel' }, NAV.map(([k, t]) => el('a', { href: `#/${k}`, 'aria-current': active === k ? 'page' : false }, t))),
      el('div', { class: 'who' }, el('span', {}, me.user.email), el('span', { class: 'tag on', style: { justifySelf: 'start' } }, me.role === 'owner' ? 'Dono' : 'Administrador'),
        el('a', { href: './', target: '_blank', class: 'muted' }, 'Abrir o site ↗'), logout)),
    el('main', { class: 'content' }, nodes));
}

// ---------------------------------------------------------------- painel (indicadores)
async function viewDashboard() {
  const { data: s, error } = await sb.rpc('admin_stats');
  if (error) throw error;
  const kpi = (label, value, hl) => el('div', { class: 'kpi' + (hl ? ' hl' : '') }, el('small', {}, label), el('b', {}, value));
  const n = (x) => Number(x || 0).toLocaleString('pt-BR');
  const days = s.sales_by_day || [];
  const max = Math.max(1, ...days.map((d) => d.revenue_cents));
  const chart = days.length
    ? el('div', { class: 'bars' }, days.map((d) => el('div', { style: { height: `${Math.max(3, (d.revenue_cents / max) * 100)}%` }, title: `${d.day}: ${money(d.revenue_cents)} (${d.orders} pedidos)` })))
    : el('p', { class: 'muted' }, 'As vendas dos últimos 30 dias aparecem aqui.');
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
async function viewTeam() {
  const { data, error } = await sb.rpc('admin_team');
  if (error) throw error;
  const owner = me.role === 'owner';
  const email = el('input', { class: 'input', type: 'email', placeholder: 'email@exemplo.com' });
  const role = el('select', { class: 'input', style: { maxWidth: '200px' } }, el('option', { value: 'admin' }, 'Administrador'), el('option', { value: 'owner' }, 'Dono'));
  const add = el('form', { class: 'card stack' }, el('h3', {}, 'Adicionar à equipe'),
    el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Primeiro crie o usuário no Supabase (Authentication > Users > Add user). Depois informe o e-mail aqui.'),
    el('div', { class: 'row' }, email, role, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Dar acesso')));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error: err } = await sb.rpc('grant_admin', { p_email: email.value, p_role: role.value });
    if (err) return toast(err.message, 6000);
    toast('Acesso concedido'); route();
  });
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Permissões'), el('h1', {}, 'Equipe'))),
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'E-mail'), el('th', {}, 'Permissão'), el('th', {}, 'Desde'), el('th', {}, ''))),
      el('tbody', {}, data.map((m) => el('tr', {},
        el('td', {}, m.email), el('td', {}, m.role === 'owner' ? 'Dono' : 'Administrador'), el('td', {}, dateTimeBR(m.created_at)),
        el('td', { class: 'num' }, owner && m.user_id !== me.user.id ? el('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!confirm(`Remover o acesso de ${m.email}?`)) return;
          const { error: err } = await sb.rpc('revoke_admin', { p_user: m.user_id });
          if (err) return toast(err.message, 5000);
          toast('Acesso removido'); route();
        } }, 'Remover') : '')))))),
    owner ? add : el('p', { class: 'muted' }, 'Somente o dono pode adicionar ou remover pessoas da equipe.')
  ];
}

// ---------------------------------------------------------------- roteador
async function route() {
  const my = ++rid;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [p0, p1, p2] = parts;
  let active = p0 || 'painel';
  let view;
  if (!p0 || p0 === 'painel') view = viewDashboard();
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
  app.replaceChildren(shell(active, [el('div', { class: 'row' }, el('span', { class: 'spinner' }), el('span', { class: 'muted' }, 'Carregando…'))]));
  try {
    const nodes = await view;
    if (my !== rid) return;
    app.replaceChildren(shell(active, nodes));
  } catch (e) {
    console.error(e);
    if (my !== rid) return;
    app.replaceChildren(shell(active, [el('div', { class: 'alert err' }, 'Erro: ' + (e.message || e))]));
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
  if (!me.role) { await sb.auth.signOut(); return loginScreen('Este usuário não tem permissão de acesso ao painel. Peça ao dono para liberar seu e-mail em Equipe.'); }
  if (!location.hash || location.hash === '#') location.hash = '#/painel';
  else route();
}
boot();
