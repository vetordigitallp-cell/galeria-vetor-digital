// Exibição de um pedido (página do pedido e "Minhas compras").
import { el, money, dateTimeBR, ICONS, waLink, loadSettings, toast } from './core.js';
import { saveSigned } from './vd-client.js';

// Originais guardados no Netlify vêm em partes: o navegador junta e salva.
async function saveItem(url) {
  if (url.startsWith('/api/file')) {
    const m = url.match(/[?&]download=([^&]+)/);
    return saveSigned(url.replace(/&download=[^&]+/, ''), m ? decodeURIComponent(m[1]) : undefined);
  }
  const a = el('a', { href: url, download: '' });
  document.body.append(a); a.click(); a.remove();
}

const STATUS = {
  paid: ['paid', 'Pagamento aprovado'],
  pending: ['pending', 'Aguardando pagamento'],
  failed: ['failed', 'Pagamento não iniciado'],
  canceled: ['canceled', 'Cancelado'],
  refunded: ['refunded', 'Estornado']
};

export async function apiOrder(body) {
  const res = await fetch('/api/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível carregar o pedido.');
  return data;
}

async function downloadAll(items, btn) {
  btn.disabled = true;
  for (let i = 0; i < items.length; i++) {
    btn.textContent = `Baixando ${i + 1} de ${items.length}…`;
    try { await saveItem(items[i].download_url); } catch (e) { toast(e.message, 5000); }
    await new Promise((r) => setTimeout(r, 600));
  }
  btn.disabled = false;
  btn.innerHTML = ICONS.download + ' Baixar todas';
}

export async function renderOrder(data) {
  const { order, items } = data;
  const [cls, label] = STATUS[order.status] || ['pending', order.status];
  const s = await loadSettings();
  const help = waLink(s, `Pedido ${order.code}`);
  const paid = order.status === 'paid';
  const method = order.capture_method === 'pix' ? 'Pix'
    : order.capture_method === 'credit_card' ? `Cartão de crédito${order.installments > 1 ? ` em ${order.installments}x` : ''}` : null;

  const head = el('div', { class: 'card stack' },
    el('div', { class: 'row', style: { justifyContent: 'space-between' } },
      el('div', {}, el('p', { class: 'eyebrow', style: { margin: 0 } }, 'Pedido'), el('h2', { class: 'mono', style: { fontSize: '28px' } }, order.code)),
      el('span', { class: `status ${cls}` }, label)),
    el('div', { class: 'row muted', style: { gap: '6px 22px', fontSize: '14px' } },
      el('span', {}, `Total: `, el('b', { style: { color: 'var(--fg)' } }, money(order.total_cents))),
      el('span', {}, `${items.length} ${items.length === 1 ? 'foto' : 'fotos'}`),
      el('span', {}, `Feito em ${dateTimeBR(order.created_at)}`),
      method ? el('span', {}, method) : null,
      order.paid_at ? el('span', {}, `Aprovado em ${dateTimeBR(order.paid_at)}`) : null),
    order.receipt_url ? el('a', { href: order.receipt_url, target: '_blank', rel: 'noopener', class: 'muted', style: { fontSize: '14px' } }, 'Ver comprovante da InfinitePay') : null
  );

  const breakdown = order.subtotal_cents != null && (order.discount_cents || order.tip_cents)
    ? el('div', { class: 'card stack', style: { gap: '6px' } },
        ...(order.pricing || []).filter((a) => a.discount_pct).map((a) => el('div', { class: 'sum-line disc' }, el('span', {}, `${a.event_name}: ${a.count} fotos, desconto de ${a.discount_pct}%`), el('span', {}, '− ' + money(a.discount_cents)))),
        el('div', { class: 'sum-line' }, el('span', {}, 'Subtotal'), el('span', {}, money(order.subtotal_cents))),
        order.discount_cents ? el('div', { class: 'sum-line disc' }, el('span', {}, 'Descontos'), el('span', {}, '− ' + money(order.discount_cents))) : null,
        order.tip_cents ? el('div', { class: 'sum-line' }, el('span', {}, 'Gorjeta ao fotógrafo'), el('span', {}, money(order.tip_cents))) : null,
        el('div', { class: 'sum-line', style: { color: 'inherit', fontWeight: 700 } }, el('span', {}, 'Total'), el('span', {}, money(order.total_cents))))
    : null;
  const out = [head, breakdown];

  if (order.status === 'pending') {
    out.push(el('div', { class: 'alert warn stack' },
      el('div', { class: 'row' }, el('span', { class: 'spinner' }), el('b', {}, 'Aguardando a confirmação do pagamento')),
      el('span', {}, 'As fotos originais são liberadas automaticamente assim que a InfinitePay confirmar o pagamento. No Pix, isso costuma levar poucos segundos.'),
      order.checkout_url ? el('div', { class: 'row' }, el('a', { class: 'btn btn-primary btn-sm', href: order.checkout_url }, 'Ir para o pagamento')) : null));
  } else if (order.status === 'refunded') {
    out.push(el('div', { class: 'alert err' }, 'Este pedido foi estornado, por isso os downloads foram desativados. Dúvidas? Fale com a gente pelo WhatsApp.'));
  } else if (!paid) {
    out.push(el('div', { class: 'alert err' }, 'Este pedido não foi pago. Você pode montar o carrinho de novo ou falar com a gente pelo WhatsApp.'));
  }

  if (paid) {
    const all = el('button', { class: 'btn btn-primary', html: ICONS.download + ' Baixar todas' });
    all.addEventListener('click', () => downloadAll(items.filter((i) => i.download_url), all));
    out.push(el('div', { class: 'alert ok stack' },
      el('b', {}, 'Suas fotos originais estão liberadas, em alta resolução e sem marca-d\'água.'),
      el('span', {}, 'Os links de download valem por 1 hora. Se expirarem, é só recarregar esta página. Guarde o link desta página ou o código do pedido para baixar de novo depois.'),
      el('div', { class: 'row' }, all)));
  }

  out.push(el('div', { class: 'dl-grid' }, items.map((i) => el('div', { class: 'dl' },
    el('img', { src: i.thumb_url, alt: `Foto ${i.code}`, loading: 'lazy' }),
    el('div', { class: 'b' },
      el('div', { class: 'row', style: { justifyContent: 'space-between' } },
        el('span', { class: 'mono muted', style: { fontSize: '12px' } }, i.code),
        el('b', { style: { fontSize: '14px' } }, money(i.price_cents))),
      el('span', { class: 'muted', style: { fontSize: '13px' } }, i.event),
      i.download_url
        ? el('a', { class: 'btn btn-primary btn-sm btn-block', href: i.download_url, download: '', html: ICONS.download + ' Baixar original', onclick: (e) => { e.preventDefault(); saveItem(i.download_url).catch((err) => toast(err.message, 5000)); } })
        : el('span', { class: 'btn btn-sm btn-block', 'aria-disabled': 'true', html: ICONS.lock + ' Liberada após o pagamento' }))))));

  if (help) out.push(el('p', { class: 'muted', style: { fontSize: '14px' } }, 'Algum problema? ', el('a', { href: help, target: '_blank', rel: 'noopener' }, 'Fale com a Vetor Digital pelo WhatsApp'), '.'));
  return out.filter(Boolean);
}
