// Página do pedido: /pedido/<id>/<token>  (retorno do checkout da InfinitePay)
import { CONFIGURED, el, header, footer, mountWhatsApp, setWaContext, myOrders, setupScreen } from './core.js';
import { apiOrder, renderOrder } from './order-ui.js';

const app = document.getElementById('app');
const [, , id, token] = location.pathname.split('/');
const q = new URLSearchParams(location.search);
// Parâmetros que a InfinitePay acrescenta ao voltar do checkout. Eles só servem para
// pedir a conferência ao servidor — sozinhos nunca liberam as fotos.
const ret = {
  transaction_nsu: q.get('transaction_nsu') || undefined,
  slug: q.get('slug') || undefined,
  capture_method: q.get('capture_method') || undefined,
  receipt_url: q.get('receipt_url') || undefined
};

const box = el('div', { class: 'container order-box' });
let tries = 0;
let timer;

async function load() {
  try {
    const data = await apiOrder({ id, token, ...ret });
    box.replaceChildren(
      el('div', {}, el('p', { class: 'eyebrow' }, 'Galeria Vetor Digital'), el('h1', { style: { fontSize: 'clamp(30px,6vw,52px)' } },
        data.order.status === 'paid' ? 'Fotos liberadas!' : 'Seu pedido')),
      ...await renderOrder(data));
    myOrders.add({ id, token, code: data.order.code, total_cents: data.order.total_cents });
    setWaContext(`Pedido ${data.order.code}`);
    // Enquanto pendente, confere de novo (o webhook pode chegar alguns segundos depois)
    clearTimeout(timer);
    if (data.order.status === 'pending' && tries < 60) {
      tries++;
      timer = setTimeout(load, tries < 15 ? 4000 : 10000);
    }
  } catch (e) {
    box.replaceChildren(el('div', { class: 'alert err' }, e.message));
  }
}

async function start() {
  if (!CONFIGURED) { app.replaceChildren(setupScreen()); return; }
  app.replaceChildren(header(), el('main', {}, box), await footer());
  if (!id || !token) {
    box.replaceChildren(el('div', { class: 'alert err' }, 'Link do pedido incompleto. Abra pela área Minhas compras.'), el('a', { class: 'btn', href: '/#/compras' }, 'Minhas compras'));
    return;
  }
  box.replaceChildren(el('div', { class: 'row' }, el('span', { class: 'spinner' }), el('span', {}, 'Conferindo seu pagamento com a InfinitePay…')));
  await load();
  // Remove os parâmetros de retorno da barra de endereço (o link continua válido)
  if (location.search) history.replaceState(null, '', location.pathname);
  mountWhatsApp();
}
start();
