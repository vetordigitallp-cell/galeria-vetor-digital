// Núcleo compartilhado: configuração, acesso aos dados, marca, carrinho, WhatsApp.
// Dados: "netlify" (funções do próprio site, Netlify Blobs) ou "supabase" (se URL e chave pública forem configuradas).
import { createClient as netlifyClient } from './vd-client.js';

export const CFG = window.VD_CONFIG || {};
export const BACKEND = CFG.supabaseUrl && CFG.supabaseAnonKey ? 'supabase' : CFG.backend === 'netlify' ? 'netlify' : null;
export const CONFIGURED = Boolean(BACKEND);
export const sb = BACKEND === 'supabase'
  ? (await import('https://esm.sh/@supabase/supabase-js@2')).createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : BACKEND === 'netlify' ? netlifyClient() : null;

export const LOGO = '<svg viewBox="0 0 336 329" aria-hidden="true"><polygon fill="#f4f6fa" points="0,78 90,78 145,178 145,328"/><polygon fill="#c6ef3e" points="145,178 246,0 335,0 145,328"/></svg>';

export const ICONS = {
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.2L21 8H6.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  face: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="9.5" cy="10" r=".6" fill="currentColor"/><circle cx="14.5" cy="10" r=".6" fill="currentColor"/><path d="M9 14.5c1.6 1.4 4.4 1.4 6 0"/></svg>',
  pix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8l3.6 3.6-3.6 3.6-3.6-3.6zM12 14l3.6 3.6-3.6 3.6-3.6-3.6zM2.8 12l3.6-3.6L10 12l-3.6 3.6zM14 12l3.6-3.6 3.6 3.6-3.6 3.6z"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.29z"/></svg>'
};

// replaceChildren(null) escreveria "null" na tela: ignora valores vazios em todo o site.
if (!Element.prototype.__vdSafe) {
  const orig = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...k) { return orig.apply(this, k.flat(Infinity).filter((c) => c != null && c !== false)); };
  Element.prototype.__vdSafe = true;
}

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dateBR = (d) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
};
export const dateTimeBR = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
export const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export function publicUrl(path) {
  if (!path || !CONFIGURED) return '';
  if (BACKEND === 'netlify') return `/api/img/${path.split('/').map(encodeURIComponent).join('/')}`;
  return `${CFG.supabaseUrl}/storage/v1/object/public/previews/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export const store = {
  get(k, d = null) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } }
};

let toastTimer;
export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- configurações institucionais ----------
let settingsPromise;
export function loadSettings() {
  if (!sb) return Promise.resolve({});
  settingsPromise ||= sb.from('settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => data || {});
  return settingsPromise;
}

export function waLink(settings, extra) {
  const num = String(settings?.whatsapp || '').replace(/\D/g, '');
  if (!num) return null;
  const msg = [settings.whatsapp_message || 'Olá! Preciso de ajuda na Galeria Vetor Digital.', extra].filter(Boolean).join('\n');
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

// Botão de suporte pelo WhatsApp da Vetor Digital com o motivo já escrito na mensagem.
export function supportLink(settings, reason, label, cls = 'btn btn-sm') {
  const href = waLink(settings, `Suporte: ${reason}`);
  return href ? el('a', { class: cls, href, target: '_blank', rel: 'noopener', html: ICONS.whatsapp + ' ' + label }) : null;
}

let waContext = '';
export function setWaContext(text) {
  waContext = text || '';
  const a = document.getElementById('waFab');
  if (a && a.dataset.base) a.href = waLink(JSON.parse(a.dataset.base), waContext);
}
export async function mountWhatsApp() {
  const s = await loadSettings();
  const href = waLink(s, waContext);
  if (!href) return;
  const a = el('a', { id: 'waFab', class: 'wa-fab', href, target: '_blank', rel: 'noopener', 'aria-label': 'Atendimento pelo WhatsApp', html: ICONS.whatsapp }, el('span', {}, 'Precisa de ajuda?'));
  a.dataset.base = JSON.stringify({ whatsapp: s.whatsapp, whatsapp_message: s.whatsapp_message });
  document.body.append(a);
}

// ---------- carrinho (fica no aparelho do cliente; o preço final é sempre recalculado no servidor) ----------
const CART_KEY = 'vd_cart_v1';
export const cart = {
  items() { return store.get(CART_KEY, []); },
  save(list) { store.set(CART_KEY, list); window.dispatchEvent(new CustomEvent('cart:change')); },
  has(id) { return this.items().some((i) => i.id === id); },
  add(item) { if (!this.has(item.id)) this.save([...this.items(), item]); },
  addMany(list) { const cur = this.items(); const ids = new Set(cur.map((i) => i.id)); this.save([...cur, ...list.filter((i) => !ids.has(i.id))]); },
  remove(id) { this.save(this.items().filter((i) => i.id !== id)); },
  toggle(item) { if (this.has(item.id)) { this.remove(item.id); return false; } this.add(item); return true; },
  clear() { this.save([]); },
  total() { return this.items().reduce((s, i) => s + (i.price_cents || 0), 0); }
};

// Pedidos feitos neste aparelho (área "Minhas compras")
export const myOrders = {
  list() { return store.get('vd_orders_v1', []); },
  add(o) {
    const list = this.list().filter((x) => x.id !== o.id);
    list.unshift({ ...o, saved_at: new Date().toISOString() });
    store.set('vd_orders_v1', list.slice(0, 50));
  }
};

export function photoItem(p, ev) {
  return {
    id: p.id,
    code: p.code,
    event_id: ev.id,
    event_name: ev.name,
    event_slug: ev.slug,
    thumb_path: p.thumb_path,
    price_cents: p.price_cents ?? ev.price_cents
  };
}

// ---------- estrutura comum das páginas ----------
export function header(active) {
  const badge = el('span', { class: 'badge', id: 'cartCount' }, String(cart.items().length));
  const update = () => { badge.textContent = String(cart.items().length); };
  window.removeEventListener('cart:change', header._u || (() => {}));
  window.removeEventListener('storage', header._u || (() => {}));
  header._u = update;
  window.addEventListener('cart:change', update);
  window.addEventListener('storage', update);
  const link = (href, text, key, cls) => el('a', { href, class: cls, 'aria-current': active === key ? 'page' : false }, text);
  return el('header', { class: 'nav' }, el('div', { class: 'container' },
    el('a', { class: 'brand', href: './#/', html: LOGO }, el('div', {}, el('b', {}, 'Vetor Digital'), el('span', {}, 'Galeria'))),
    el('nav', { class: 'nav-links', 'aria-label': 'Principal' },
      link('/#/eventos', 'Eventos', 'eventos', 'hide-sm'),
      link('/#/compras', 'Minhas compras', 'compras', 'hide-sm')),
    el('a', { class: 'cart-btn', href: './#/carrinho', 'aria-label': 'Carrinho', html: ICONS.cart }, badge)
  ));
}

export async function footer() {
  const s = await loadSettings();
  const wa = waLink(s);
  const ig = s.instagram ? String(s.instagram).replace(/^@/, '') : '';
  return el('footer', { class: 'footer' }, el('div', { class: 'container' },
    el('div', { class: 'stack' },
      el('a', { class: 'brand', href: './#/', html: LOGO }, el('div', {}, el('b', {}, s.company_name || 'Vetor Digital'), el('span', {}, 'Galeria'))),
      s.tagline ? el('p', { class: 'small', style: { margin: 0 } }, s.tagline) : null,
      el('p', { class: 'small', style: { margin: 0 } }, [s.cnpj ? `CNPJ ${s.cnpj}` : null, s.city].filter(Boolean).join(' · '))),
    el('div', {}, el('h4', {}, 'Galeria'),
      el('a', { href: './#/eventos' }, 'Eventos'),
      el('a', { href: './#/compras' }, 'Minhas compras'),
      el('a', { href: './#/privacidade' }, 'Privacidade e dados faciais')),
    el('div', {}, el('h4', {}, 'Contato'),
      wa ? el('a', { href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      ig ? el('a', { href: `https://www.instagram.com/${ig}/`, target: '_blank', rel: 'noopener' }, '@' + ig) : null,
      s.email ? el('a', { href: `mailto:${s.email}` }, s.email) : null)
  ));
}

export function setupScreen() {
  return el('div', { class: 'setup card' },
    el('p', { class: 'eyebrow' }, 'Configuração pendente'),
    el('h2', {}, 'Conecte o Supabase'),
    el('p', { class: 'muted' }, 'A galeria ainda não foi configurada para este endereço. O passo a passo está no arquivo SETUP.md do projeto.'));
}
