// POST /api/infinitepay/webhook — recebe os avisos de pagamento da InfinitePay.
// O webhook da InfinitePay não tem assinatura, então NADA é liberado com base
// só no aviso: cada notificação é conferida em /payment_check antes de aprovar.
import { json, UUID_RE } from '../lib/http.mjs';
import { getOrder, confirmPayment } from '../lib/orders.mjs';
// Eventos assinados na criação do link: paid, refunded, canceled, payment_failed.

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });

  let payload;
  try { payload = await req.json(); } catch { return json(400, { error: 'JSON inválido' }); }

  const orderNsu = String(payload?.order_nsu || '');
  if (!UUID_RE.test(orderNsu)) return json(400, { error: 'order_nsu inválido' });

  try {
    const order = await getOrder(orderNsu);
    if (!order) return json(400, { error: 'Pedido não encontrado' });

    const result = await confirmPayment(order, {
      transactionNsu: payload.transaction_nsu,
      slug: payload.invoice_slug || payload.slug,
      source: 'webhook',
      payload
    });
    // 200 = recebido. Não pagos também recebem 200 para não gerar reenvios infinitos.
    return json(200, { ok: true, status: result.status, verified: result.verified });
  } catch (err) {
    console.error('[webhook] erro', err);
    // Erro temporário (banco ou InfinitePay fora): 500 faz a InfinitePay tentar de novo.
    return json(500, { error: 'Erro temporário' });
  }
};

export const config = { path: '/api/infinitepay/webhook' };
