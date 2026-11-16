// POST /api/admin/order-check — a equipe confere um pedido direto na InfinitePay.
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { requireAdmin } from '../lib/supabase.mjs';
import { getOrder, confirmPayment } from '../lib/orders.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  await requireAdmin(req);
  const body = await readJson(req);
  const order = await getOrder(body.order_id);
  if (!order) throw new HttpError(404, 'Pedido não encontrado.');
  if (!order.transaction_nsu || !order.invoice_slug) {
    return json(200, {
      status: order.status,
      message: 'Ainda não chegou nenhuma transação da InfinitePay para este pedido (cliente não concluiu o pagamento).'
    });
  }
  const r = await confirmPayment(order, {
    transactionNsu: order.transaction_nsu,
    slug: order.invoice_slug,
    source: 'admin_check'
  });
  return json(200, { status: r.status, message: r.reason });
});

export const config = { path: '/api/admin/order-check' };
