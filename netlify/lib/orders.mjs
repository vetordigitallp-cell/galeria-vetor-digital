// Regras de pedido: confirmação de pagamento e montagem da entrega.
import crypto from 'node:crypto';
import { rest, signOriginals, publicUrl } from './supabase.mjs';
import { paymentCheck } from './infinitepay.mjs';
import { UUID_RE } from './http.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newOrderCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `VD-${s}`;
}

export function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function getOrder(id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const rows = await rest(`orders?id=eq.${id}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

async function logPaymentEvent(orderId, source, payload, verified, checkResult, event = null) {
  try {
    await rest('payment_events', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { order_id: orderId, source, event, payload: payload || null, verified, check_result: checkResult || null }
    });
  } catch (e) {
    console.error('[auditoria] falha ao registrar evento', e.message);
  }
}

// O nome do evento não aparece no exemplo de payload da documentação; tentamos os campos prováveis
// só para registro e revisão. Nenhuma decisão de liberar fotos depende dele.
export function eventName(payload) {
  const v = payload && (payload.event || payload.event_type || payload.type || payload.status);
  return typeof v === 'string' ? v.toLowerCase().slice(0, 40) : null;
}

/**
 * Valor esperado. A documentação manda NÃO comparar paid_amount (pode ter juros do parcelamento).
 * Comparamos "amount" com o total do pedido; se houver desconto no Pix, aceitamos também o total com desconto,
 * porque a documentação não diz se "amount" vem antes ou depois do desconto.
 */
export function amountMatches(order, check) {
  const amount = Number(check?.amount);
  const total = Number(order.total_cents);
  if (amount === total) return true;
  const d = Number(order.pix_discount_pct) || 0;
  if (d > 0 && (check?.capture_method || '') === 'pix') {
    const discounted = Math.round(total * (100 - d) / 100);
    return Math.abs(amount - discounted) <= 1;
  }
  return false;
}

/**
 * Confirma o pagamento SEMPRE consultando a InfinitePay (payment_check).
 * O retorno do cliente ao site ou o webhook sozinhos nunca liberam fotos.
 * Retorna { status, verified, reason }.
 */
export async function confirmPayment(order, { transactionNsu, slug, source, payload }) {
  const ev = eventName(payload);
  if (!order) return { status: 'not_found', verified: false, reason: 'Pedido não encontrado' };
  if (order.status === 'paid') return reconcilePaid(order, { source, payload, ev });
  if (order.status === 'refunded') {
    await logPaymentEvent(order.id, source, payload, false, { note: 'pedido estornado; reativação só pelo painel' }, ev);
    return { status: 'refunded', verified: false, reason: 'Pedido estornado' };
  }

  if (!transactionNsu || !slug) {
    if (slug && !order.invoice_slug) {
      await rest(`orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { invoice_slug: slug } });
    }
    await logPaymentEvent(order.id, source, payload, false, { note: 'sem transaction_nsu/slug' }, ev);
    return { status: order.status, verified: false, reason: 'Aguardando a transação' };
  }

  const check = await paymentCheck({ orderNsu: order.id, transactionNsu, slug });
  const amountOk = amountMatches(order, check);
  const verified = check?.success === true && check?.paid === true && amountOk;
  await logPaymentEvent(order.id, source, payload, verified, check, ev);

  if (!verified) {
    const reason = check?.paid === true && !amountOk
      ? `Valor divergente (esperado ${order.total_cents}, recebido ${check?.amount})`
      : 'Pagamento ainda não aprovado';
    const patch = { transaction_nsu: transactionNsu, invoice_slug: slug };
    // Cancelamento informado e não pago na conferência: marca como cancelado (se pagar depois, ainda é aceito).
    if (ev === 'canceled' && check?.paid !== true) Object.assign(patch, { status: 'canceled', canceled_at: new Date().toISOString() });
    await rest(`orders?id=eq.${order.id}&status=in.(pending,failed,canceled)`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    if (check?.paid === true && !amountOk) {
      await rest(`orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { needs_review: true, review_note: reason } });
    }
    return { status: patch.status || order.status, verified: false, reason };
  }

  // Atualização condicional: só passa para "paid" uma vez (protege contra avisos duplicados).
  await rest(`orders?id=eq.${order.id}&status=in.(pending,failed,canceled)`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_nsu: transactionNsu,
      invoice_slug: slug,
      capture_method: check.capture_method || payload?.capture_method || null,
      installments: Number.isFinite(Number(check.installments)) ? Number(check.installments) : null,
      paid_amount_cents: Number.isFinite(Number(check.paid_amount)) ? Number(check.paid_amount) : null,
      receipt_url: payload?.receipt_url || order.receipt_url || null
    }
  });
  return { status: 'paid', verified: true, reason: 'Pagamento confirmado pela InfinitePay' };
}

/**
 * Aviso para um pedido já pago (ex.: refunded). O webhook não tem assinatura,
 * então conferimos com os identificadores JÁ GUARDADOS no pedido (não os do aviso).
 * - InfinitePay diz paid:false  -> estornado: bloqueia os downloads.
 * - InfinitePay ainda diz paid:true, mas o aviso fala em estorno/cancelamento -> marca para revisão.
 */
async function reconcilePaid(order, { source, payload, ev }) {
  if (!order.transaction_nsu || !order.invoice_slug) {
    await logPaymentEvent(order.id, source, payload, false, { note: 'pago sem identificadores guardados' }, ev);
    return { status: 'paid', verified: true, reason: 'já confirmado' };
  }
  let check;
  try {
    check = await paymentCheck({ orderNsu: order.id, transactionNsu: order.transaction_nsu, slug: order.invoice_slug });
  } catch (e) {
    await logPaymentEvent(order.id, source, payload, false, { note: 'falha ao reconferir', error: e.message }, ev);
    throw e;
  }
  await logPaymentEvent(order.id, source, payload, check?.paid === true, check, ev);
  if (check?.success === true && check?.paid === false) {
    await rest(`orders?id=eq.${order.id}&status=eq.paid`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'refunded', refunded_at: new Date().toISOString(), needs_review: false,
        review_note: 'InfinitePay deixou de confirmar o pagamento (estorno ou cancelamento). Downloads bloqueados.' }
    });
    return { status: 'refunded', verified: true, reason: 'Pagamento estornado/cancelado na InfinitePay' };
  }
  if (ev === 'refunded' || ev === 'canceled') {
    await rest(`orders?id=eq.${order.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { needs_review: true, review_note: `Aviso de "${ev}" recebido, mas a InfinitePay ainda confirma o pagamento. Confira no app e, se estornado, use "Marcar como estornado".` }
    });
  }
  return { status: 'paid', verified: true, reason: 'já confirmado' };
}

function safeFileName(eventName, code) {
  const base = `${eventName || 'Vetor Digital'} ${code}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');
  return `${base || 'foto'}.jpg`;
}

// Monta a resposta pública do pedido; links dos originais só quando pago.
export async function orderView(order) {
  const items = await rest(
    `order_items?order_id=eq.${order.id}&select=photo_code,event_name,price_cents,original_path,thumb_path&order=id`
  );
  let downloads = [];
  if (order.status === 'paid') {
    downloads = await signOriginals(items.map((i) => i.original_path), 60 * 60);
  }
  return {
    order: {
      id: order.id,
      code: order.code,
      status: order.status,
      total_cents: order.total_cents,
      subtotal_cents: order.subtotal_cents ?? null,
      discount_cents: order.discount_cents ?? 0,
      tip_cents: order.tip_cents ?? 0,
      pricing: order.pricing || null,
      created_at: order.created_at,
      paid_at: order.paid_at,
      capture_method: order.capture_method,
      installments: order.installments,
      receipt_url: order.receipt_url,
      checkout_url: order.status === 'pending' ? order.checkout_url : null
    },
    items: items.map((i, n) => {
      const d = downloads[n];
      const url = d && d.url
        ? `${d.url}${d.url.includes('?') ? '&' : '?'}download=${encodeURIComponent(safeFileName(i.event_name, i.photo_code))}`
        : null;
      return {
        code: i.photo_code,
        event: i.event_name,
        price_cents: i.price_cents,
        thumb_url: publicUrl('previews', i.thumb_path),
        download_url: url
      };
    })
  };
}
