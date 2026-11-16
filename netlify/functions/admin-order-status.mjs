// POST /api/admin/order-status — ações manuais da equipe sobre um pedido.
// Estorno e cancelamento são feitos no App/Conta Web da InfinitePay (a API não estorna);
// aqui a equipe só reflete isso no sistema para bloquear ou reativar os downloads.
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { requireAdmin, rest } from '../lib/supabase.mjs';
import { getOrder } from '../lib/orders.mjs';

const ACTIONS = {
  refund: { from: ['paid'], body: () => ({ status: 'refunded', refunded_at: new Date().toISOString(), needs_review: false, review_note: 'Marcado como estornado pela equipe.' }) },
  reactivate: { from: ['refunded'], body: () => ({ status: 'paid', refunded_at: null, needs_review: false, review_note: 'Reativado pela equipe.' }) },
  clear_review: { from: ['paid', 'refunded', 'pending', 'canceled', 'failed'], body: () => ({ needs_review: false }) }
};

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  const admin = await requireAdmin(req);
  const body = await readJson(req);
  const action = ACTIONS[body.action];
  if (!action) throw new HttpError(400, 'Ação inválida.');
  const order = await getOrder(body.order_id);
  if (!order) throw new HttpError(404, 'Pedido não encontrado.');
  if (!action.from.includes(order.status)) throw new HttpError(409, `Não é possível aplicar esta ação a um pedido "${order.status}".`);
  await rest(`orders?id=eq.${order.id}&status=eq.${order.status}`, { method: 'PATCH', prefer: 'return=minimal', body: action.body() });
  await rest('payment_events', { method: 'POST', prefer: 'return=minimal', body: { order_id: order.id, source: 'admin', event: body.action, verified: true, payload: { by: admin?.user?.id || null } } });
  return json(200, { ok: true });
});

export const config = { path: '/api/admin/order-status' };
