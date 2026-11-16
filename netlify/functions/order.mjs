// POST /api/order — consulta um pedido e entrega os links dos originais (só se pago).
// Acesso por { id, token } (link secreto do pedido) ou { code, email } (área "Minhas compras").
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { rest } from '../lib/supabase.mjs';
import { getOrder, tokenMatches, confirmPayment, orderView } from '../lib/orders.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  const body = await readJson(req);

  let order = null;
  if (body.id && body.token) {
    order = await getOrder(body.id);
    if (!order || !tokenMatches(body.token, order.access_token_hash)) {
      throw new HttpError(404, 'Pedido não encontrado. Confira o link.');
    }
  } else if (body.code && body.email) {
    const code = String(body.code).trim().toUpperCase().replace(/^(VD-?)?/, 'VD-');
    const email = String(body.email).trim().toLowerCase();
    if (!/^VD-[A-Z0-9]{8}$/.test(code)) throw new HttpError(400, 'Código do pedido inválido.');
    const rows = await rest(`orders?code=eq.${encodeURIComponent(code)}&select=*,customer:customers(email)`);
    const found = rows && rows[0];
    if (!found || (found.customer?.email || '').toLowerCase() !== email) {
      throw new HttpError(404, 'Não encontramos um pedido com esse código e e-mail.');
    }
    order = found;
  } else {
    throw new HttpError(400, 'Informe o pedido.');
  }

  // Conferência ativa: ao voltar do checkout, a InfinitePay envia transaction_nsu e slug.
  // Mesmo assim, a aprovação só acontece depois da consulta oficial em /payment_check.
  if (order.status !== 'paid') {
    const tx = body.transaction_nsu || order.transaction_nsu;
    const slug = body.slug || order.invoice_slug;
    if (tx && slug) {
      const r = await confirmPayment(order, {
        transactionNsu: String(tx).slice(0, 120),
        slug: String(slug).slice(0, 120),
        source: 'redirect',
        payload: body.transaction_nsu
          ? { transaction_nsu: body.transaction_nsu, slug: body.slug, capture_method: body.capture_method, receipt_url: body.receipt_url }
          : null
      });
      if (r.verified) order = await getOrder(order.id);
    }
  }

  return json(200, await orderView(order));
});

export const config = { path: '/api/order' };
