// Regras do desconto progressivo por álbum e da gorjeta (mesmo arquivo usado no carrinho e no servidor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceCart, parseTip, tierFor } from '../galeria-vetor-digital/assets/pricing.js';

const fotos = (ev, n, preco = 1500) => Array.from({ length: n }, () => ({ event_id: ev, event_name: `Álbum ${ev}`, price_cents: preco }));

test('faixas: maior faixa atingida, sem somar', () => {
  assert.deepEqual([1, 2, 4, 5, 7, 9, 10, 15].map((n) => tierFor(n).pct), [0, 5, 5, 10, 10, 10, 20, 20]);
});

test('desconto calculado separadamente por álbum', () => {
  const p = priceCart([...fotos('A', 7), ...fotos('B', 1)]);
  const A = p.albums.find((a) => a.event_id === 'A'); const B = p.albums.find((a) => a.event_id === 'B');
  assert.equal(A.discount_pct, 10); assert.equal(A.discount_cents, 1050);
  assert.equal(B.discount_pct, 0, '1 foto de outro álbum não ganha desconto');
  assert.equal(p.total_cents, 8 * 1500 - 1050);
});

test('incentivo para a próxima faixa', () => {
  assert.deepEqual(priceCart(fotos('A', 3)).albums[0].next, { missing: 2, pct: 10 });
  assert.equal(priceCart(fotos('A', 12)).albums[0].next, null);
});

test('gorjeta somada depois do desconto', () => {
  const p = priceCart(fotos('A', 10), 1000);
  assert.equal(p.discount_cents, 3000);
  assert.equal(p.total_cents, 15000 - 3000 + 1000);
});

test('validação da gorjeta', () => {
  assert.deepEqual(parseTip('15,50'), { cents: 1550 });
  assert.deepEqual(parseTip('R$ 7'), { cents: 700 });
  for (const bad of ['-5', 'abc', '10,555', '0', '600', '1e3']) assert.ok(parseTip(bad).error, bad);
});
