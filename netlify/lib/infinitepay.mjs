// Integração oficial com o Checkout Integrado da InfinitePay.
// Documentação: https://www.infinitepay.io/checkout-documentacao
import { env, HttpError } from './http.mjs';

const API = 'https://api.checkout.infinitepay.io';

function handleTag() {
  return env('INFINITEPAY_HANDLE').replace(/^\$/, '').trim();
}

function headers() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const key = process.env.INFINITEPAY_API_KEY;
  if (key && key.trim()) h['X-Api-Key'] = key.trim();
  return h;
}

// A documentação não fixa o nome do campo com a URL do checkout na resposta,
// então procuramos a primeira URL https válida nos campos conhecidos e, por fim, em qualquer campo.
export function pickCheckoutUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const direct = ['url', 'link', 'checkout_url', 'payment_url', 'invoice_url'];
  for (const k of direct) if (typeof data[k] === 'string' && /^https:\/\//.test(data[k])) return data[k];
  for (const k of ['data', 'link', 'result', 'invoice']) {
    if (data[k] && typeof data[k] === 'object') {
      const found = pickCheckoutUrl(data[k]);
      if (found) return found;
    }
  }
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && /^https:\/\/[^\s]*infinitepay/i.test(v)) return v;
  }
  return null;
}

export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return undefined;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+${d}`;
  return undefined;
}

export const WEBHOOK_EVENTS = ['paid', 'refunded', 'canceled', 'payment_failed'];

export function hasApiKey() {
  return Boolean((process.env.INFINITEPAY_API_KEY || '').trim());
}

/**
 * Monta o corpo do POST /links conforme a documentação oficial.
 * - webhook: objeto { url, events } (paid, refunded, canceled, payment_failed)
 * - options (só com API Key): link de pagamento único, validade, meios e desconto no Pix.
 *   O cartão não pode ser desligado; só o Pix liga/desliga.
 */
export function buildLinkBody({ items, orderNsu, redirectUrl, webhookUrl, customer, paymentMethod, pixDiscountPct, validDays = 3 }) {
  const body = {
    handle: handleTag(),
    items,
    order_nsu: orderNsu,
    redirect_url: redirectUrl,
    webhook: { url: webhookUrl, events: WEBHOOK_EVENTS }
  };
  if (customer) {
    body.customer = { name: customer.name, email: customer.email };
    const phone = normalizePhone(customer.phone);
    if (phone) body.customer.phone_number = phone;
  }
  if (hasApiKey()) {
    const until = new Date(Date.now() + validDays * 864e5);
    const pad = (n) => String(n).padStart(2, '0');
    // ISO 8601 no fuso de Brasília (-03:00)
    const br = new Date(until.getTime() - 3 * 36e5);
    const validUntil = `${br.getUTCFullYear()}-${pad(br.getUTCMonth() + 1)}-${pad(br.getUTCDate())}T${pad(br.getUTCHours())}:${pad(br.getUTCMinutes())}:${pad(br.getUTCSeconds())}-03:00`;
    const methods = paymentMethod === 'credit_card' ? ['credit_card'] : ['credit_card', 'pix'];
    body.options = {
      single_payment: true,
      valid_until: validUntil,
      require_delivery_address: false,
      payment_methods_enabled: methods
    };
    const d = Number(pixDiscountPct) || 0;
    if (d > 0 && d < 100 && methods.includes('pix')) body.options.discounts = { pix: d };
  }
  return body;
}

export async function createCheckoutLink(args) {
  const body = buildLinkBody(args);
  let res;
  try {
    res = await fetch(`${API}/links`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  } catch (e) {
    throw new HttpError(502, 'Não foi possível falar com a InfinitePay. Tente de novo em instantes.');
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error('[infinitepay] erro ao criar link', res.status, text.slice(0, 500));
    if (/external_checkout_not_enabled/.test(text)) {
      throw new HttpError(502, 'O checkout da loja ainda não está habilitado. Fale com a gente pelo WhatsApp.');
    }
    throw new HttpError(502, 'A InfinitePay recusou a criação do pagamento. Fale com a gente pelo WhatsApp.');
  }
  const url = pickCheckoutUrl(data);
  if (!url) {
    console.error('[infinitepay] resposta sem URL', text.slice(0, 500));
    throw new HttpError(502, 'A InfinitePay não retornou o link de pagamento.');
  }
  return { url, raw: data };
}

// Confirma no servidor da InfinitePay se o pagamento foi realmente aprovado.
export async function paymentCheck({ orderNsu, transactionNsu, slug }) {
  const res = await fetch(`${API}/payment_check`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      handle: handleTag(),
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug
    })
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new HttpError(502, `InfinitePay payment_check respondeu ${res.status}`);
  }
  return data;
}
