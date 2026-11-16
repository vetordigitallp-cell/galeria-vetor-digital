// POST /api/checkout — cria o pedido e pede o link de pagamento à InfinitePay.
// O preço é sempre lido do banco; o valor enviado pelo navegador é ignorado.
import { handle, json, readJson, HttpError, siteUrl, UUID_RE } from '../lib/http.mjs';
import { rest } from '../lib/supabase.mjs';
import { createCheckoutLink } from '../lib/infinitepay.mjs';
import { newOrderCode, newToken, hashToken } from '../lib/orders.mjs';
// Mesma regra de preço do carrinho (desconto progressivo por álbum + gorjeta), recalculada aqui.
import { priceCart, validTipCents } from '../../galeria-vetor-digital/assets/pricing.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_ITEMS = 200;

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  const body = await readJson(req);

  const ids = [...new Set(Array.isArray(body.photo_ids) ? body.photo_ids.map(String) : [])];
  if (!ids.length) throw new HttpError(400, 'Seu carrinho está vazio.');
  if (ids.length > MAX_ITEMS) throw new HttpError(400, `Máximo de ${MAX_ITEMS} fotos por pedido.`);
  if (!ids.every((id) => UUID_RE.test(id))) throw new HttpError(400, 'Foto inválida no carrinho.');

  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').trim().slice(0, 120),
    email: String(c.email || '').trim().toLowerCase().slice(0, 160),
    phone: String(c.phone || '').replace(/\D/g, '').slice(0, 15)
  };
  if (customer.name.length < 3) throw new HttpError(400, 'Informe seu nome completo.');
  if (!EMAIL_RE.test(customer.email)) throw new HttpError(400, 'Informe um e-mail válido.');
  if (customer.phone && (customer.phone.length < 10 || customer.phone.length > 13)) {
    throw new HttpError(400, 'Informe o WhatsApp com DDD.');
  }

  const paymentMethod = body.payment_method === 'credit_card' ? 'credit_card' : 'pix';
  const tipCents = body.tip_cents == null ? 0 : Number(body.tip_cents);
  if (!validTipCents(tipCents)) throw new HttpError(400, 'Valor de gorjeta inválido (máximo R$ 500,00).');
  let pixDiscount = 0;
  try {
    const [st] = await rest('settings?id=eq.1&select=pix_discount_pct');
    pixDiscount = Number(st?.pix_discount_pct) || 0;
  } catch { pixDiscount = 0; }

  // Fotos e preços vindos do banco
  const photos = await rest(
    `photos?id=in.(${ids.join(',')})&select=id,code,price_cents,original_path,thumb_path,published,` +
    `event:events!inner(id,name,price_cents,published)`
  );
  const byId = new Map((photos || []).map((p) => [p.id, p]));
  const unavailable = ids.filter((id) => {
    const p = byId.get(id);
    return !p || !p.published || !p.event?.published;
  });
  if (unavailable.length) {
    throw new HttpError(409, 'Algumas fotos não estão mais disponíveis. Atualize o carrinho.', { unavailable });
  }

  const lines = ids.map((id) => {
    const p = byId.get(id);
    return { photo: p, price: p.price_cents ?? p.event.price_cents };
  });
  const pricing = priceCart(lines.map((l) => ({ event_id: l.photo.event.id, event_name: l.photo.event.name, price_cents: l.price })), tipCents);
  const total = pricing.total_cents;
  if (total < 100) throw new HttpError(400, 'O valor mínimo do pedido é R$ 1,00.');

  // Cliente (atualiza nome/telefone se o e-mail já existir)
  const [cust] = await rest('customers?on_conflict=email', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { email: customer.email, name: customer.name, phone: customer.phone || null, updated_at: new Date().toISOString() }
  });

  const token = newToken();
  const [order] = await rest('orders', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      code: newOrderCode(),
      customer_id: cust.id,
      total_cents: total,
      access_token_hash: hashToken(token),
      status: 'pending',
      payment_method_requested: paymentMethod,
      subtotal_cents: pricing.subtotal_cents,
      discount_cents: pricing.discount_cents,
      tip_cents: pricing.tip_cents,
      pricing: pricing.albums.map(({ next, ...a }) => a),
      pix_discount_pct: pixDiscount
    }
  });

  await rest('order_items', {
    method: 'POST',
    prefer: 'return=minimal',
    body: lines.map((l) => ({
      order_id: order.id,
      photo_id: l.photo.id,
      event_id: l.photo.event.id,
      event_name: l.photo.event.name,
      photo_code: l.photo.code,
      price_cents: l.price,
      original_path: l.photo.original_path,
      thumb_path: l.photo.thumb_path
    }))
  });

  const site = siteUrl(req);
  let link;
  try {
    link = await createCheckoutLink({
      orderNsu: order.id,
      redirectUrl: `${site}/pedido/${order.id}/${token}`,
      webhookUrl: `${site}/api/infinitepay/webhook`,
      customer,
      paymentMethod,
      pixDiscountPct: pixDiscount,
      // Um item por álbum (já com o desconto) + a gorjeta, somando exatamente o total do pedido.
      items: [
        ...pricing.albums.map((al) => ({
          description: `Fotos - ${al.event_name} (${al.count} ${al.count === 1 ? 'foto' : 'fotos'}${al.discount_pct ? `, ${al.discount_pct}% de desconto` : ''})`.slice(0, 120),
          price: al.total_cents,
          quantity: 1
        })),
        ...(pricing.tip_cents ? [{ description: 'Gorjeta ao fotógrafo', price: pricing.tip_cents, quantity: 1 }] : [])
      ]
    });
  } catch (err) {
    await rest(`orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'failed' } });
    throw err;
  }

  await rest(`orders?id=eq.${order.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { checkout_url: link.url }
  });

  return json(200, {
    order_id: order.id,
    code: order.code,
    token,
    total_cents: total,
    checkout_url: link.url
  });
});

export const config = { path: '/api/checkout' };
