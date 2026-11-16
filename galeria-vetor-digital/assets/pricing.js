// Regras de preço da Galeria Vetor Digital — o MESMO arquivo é usado pelo carrinho (para mostrar)
// e pelo servidor (para cobrar), então o valor exibido é sempre o valor cobrado.
// Sem DOM e sem dependências: funciona no navegador e no Node.

// Desconto progressivo por álbum: vale a maior faixa atingida (não soma).
export const DISCOUNT_TIERS = [
  { min: 10, pct: 20 },
  { min: 5, pct: 10 },
  { min: 2, pct: 5 }
];
export const TIP_MAX_CENTS = 50000; // R$ 500,00
export const TIP_OPTIONS_CENTS = [500, 1000, 2000];

export function tierFor(count) {
  return DISCOUNT_TIERS.find((t) => count >= t.min) || { min: 0, pct: 0 };
}

export function nextTier(count) {
  return [...DISCOUNT_TIERS].reverse().find((t) => t.min > count) || null;
}

/**
 * Agrupa por álbum (evento) e aplica o desconto de cada álbum separadamente.
 * items: [{ event_id, event_name, price_cents }]
 */
export function priceCart(items, tipCents = 0) {
  const albums = new Map();
  for (const it of items) {
    const key = String(it.event_id);
    const a = albums.get(key) || { event_id: it.event_id, event_name: it.event_name, count: 0, subtotal_cents: 0 };
    a.count += 1;
    a.subtotal_cents += Math.round(Number(it.price_cents) || 0);
    albums.set(key, a);
  }
  const list = [...albums.values()].map((a) => {
    const { pct } = tierFor(a.count);
    const discount = Math.round((a.subtotal_cents * pct) / 100);
    const nx = nextTier(a.count);
    return {
      ...a,
      discount_pct: pct,
      discount_cents: discount,
      total_cents: a.subtotal_cents - discount,
      next: nx ? { missing: nx.min - a.count, pct: nx.pct } : null
    };
  });
  const subtotal = list.reduce((s, a) => s + a.subtotal_cents, 0);
  const discount = list.reduce((s, a) => s + a.discount_cents, 0);
  const tip = Math.max(0, Math.round(Number(tipCents) || 0));
  return { albums: list, subtotal_cents: subtotal, discount_cents: discount, photos_total_cents: subtotal - discount, tip_cents: tip, total_cents: subtotal - discount + tip };
}

/**
 * Converte o texto digitado ("12", "12,50", "R$ 7,5") em centavos.
 * Retorna { cents } ou { error }. Recusa letras, negativos, mais de 2 casas e acima do limite.
 */
export function parseTip(text) {
  const raw = String(text ?? '').trim().replace(/^R\$\s*/i, '');
  if (!raw) return { cents: 0 };
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(raw)) return { error: 'Digite só números, como 15 ou 15,50.' };
  const cents = Math.round(parseFloat(raw.replace(',', '.')) * 100);
  if (cents <= 0) return { error: 'O valor da gorjeta precisa ser maior que zero.' };
  if (cents > TIP_MAX_CENTS) return { error: 'A gorjeta máxima é R$ 500,00.' };
  return { cents };
}

export function validTipCents(cents) {
  return Number.isInteger(cents) && cents >= 0 && cents <= TIP_MAX_CENTS;
}
