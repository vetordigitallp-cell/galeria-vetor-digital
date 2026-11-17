// Site público da Galeria Vetor Digital (página única com rotas #/...).
import {
  sb, CONFIGURED, el, ICONS, LOGO, money, dateBR, plural, publicUrl, toast, cart, myOrders,
  photoItem, header, footer, loadSettings, mountWhatsApp, setWaContext, setupScreen, store, waLink, supportLink, backBar, trackNav
} from './core.js';
import { selfieDescriptor, vectorLiteral } from './face.js';
import { apiOrder, renderOrder } from './order-ui.js';
import { priceCart, parseTip, TIP_OPTIONS_CENTS } from './pricing.js';

const app = document.getElementById('app');
const PAGE = 60;
const EVENT_COLS = 'id,slug,name,category,event_date,location,description,cover_path,price_cents,face_search';
const PHOTO_COLS = 'id,code,preview_path,thumb_path,width,height,price_cents';

let renderId = 0;
let pageCtl = new AbortController();

async function mount(active, nodes) {
  app.replaceChildren(header(active), el('main', {}, nodes), await footer());
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- dados
const cache = { events: null };
async function fetchEvents() {
  if (cache.events) return cache.events;
  const { data, error } = await sb.from('events').select(EVENT_COLS).eq('published', true)
    .order('event_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  cache.events = data || [];
  return cache.events;
}
async function fetchEvent(slug) {
  const { data, error } = await sb.from('events').select(EVENT_COLS).eq('slug', slug).eq('published', true).maybeSingle();
  if (error) throw error;
  return data;
}
async function photoCount(eventId) {
  const { count } = await sb.from('photos').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('published', true);
  return count || 0;
}
async function fetchPhotos(eventId, from) {
  const { data, error } = await sb.from('photos').select(PHOTO_COLS)
    .eq('event_id', eventId).eq('published', true).order('code').range(from, from + PAGE - 1);
  if (error) throw error;
  return data || [];
}
async function fetchPhotosByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from('photos').select(PHOTO_COLS + ',event_id').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

// ---------------------------------------------------------------- componentes
function eventCard(ev, count) {
  const cover = publicUrl(ev.cover_path);
  return el('a', { class: 'event-card', href: `#/e/${ev.slug}` },
    el('div', { class: 'cover' + (cover ? '' : ' cover-empty'), style: cover ? { backgroundImage: `url("${cover}")` } : null, html: cover ? '' : LOGO },
      el('span', { class: 'cat' }, ev.category || 'Esporte')),
    el('div', { class: 'body' },
      count != null ? el('span', { class: 'count' }, plural(count, 'foto', 'fotos')) : null,
      el('h3', {}, ev.name),
      el('div', { class: 'meta' },
        ev.event_date ? el('span', { html: ICONS.calendar }, dateBR(ev.event_date)) : null,
        ev.location ? el('span', { html: ICONS.pin }, ev.location) : null)));
}

function eventsGrid(events) {
  const grid = el('div', { class: 'events' });
  events.forEach((ev) => {
    const card = eventCard(ev, null);
    grid.append(card);
    photoCount(ev.id).then((n) => {
      card.querySelector('.body').prepend(el('span', { class: 'count' }, plural(n, 'foto', 'fotos')));
    }).catch(() => {});
  });
  return grid;
}

function photoCard(p, ev, list, idx, opts = {}) {
  const item = photoItem(p, ev);
  const card = el('div', { class: 'ph' + (cart.has(p.id) ? ' in-cart' : '') });
  const addBtn = el('button', { class: 'add', 'aria-label': 'Adicionar ao carrinho', title: 'Comprar foto', html: cart.has(p.id) ? ICONS.check : ICONS.plus });
  const sync = () => {
    const inCart = cart.has(p.id);
    card.classList.toggle('in-cart', inCart);
    addBtn.innerHTML = inCart ? ICONS.check : ICONS.plus;
    addBtn.setAttribute('aria-label', inCart ? 'Remover do carrinho' : 'Adicionar ao carrinho');
  };
  addBtn.addEventListener('click', () => { const added = cart.toggle(item); toast(added ? 'Foto adicionada ao carrinho' : 'Foto removida do carrinho'); sync(); });
  window.addEventListener('cart:change', sync, { signal: pageCtl.signal });

  card.append(
    el('button', { class: 'img', 'aria-label': `Ampliar foto ${p.code}`, onclick: () => openLightbox(list, idx, ev) },
      el('img', { src: publicUrl(p.thumb_path), alt: `Foto ${p.code}`, loading: 'lazy', width: 480, height: 640, oncontextmenu: (e) => e.preventDefault() })),
    el('div', { class: 'bar' }, el('span', { class: 'code' }, '#' + p.code), el('span', { class: 'price' }, money(item.price_cents)), addBtn));

  if (opts.selectable) {
    const chk = el('button', { class: 'check', 'aria-label': 'Selecionar foto', html: ICONS.check });
    const toggle = () => { opts.selected.has(p.id) ? opts.selected.delete(p.id) : opts.selected.add(p.id); card.classList.toggle('selected', opts.selected.has(p.id)); opts.onChange && opts.onChange(); };
    chk.addEventListener('click', toggle);
    card.classList.toggle('selected', opts.selected.has(p.id));
    card.append(chk);
  }
  return card;
}

// ---------------------------------------------------------------- visualizador
let lb = null;
function openLightbox(list, idx, ev) {
  closeLightbox();
  let i = idx;
  const img = el('img', { alt: '', oncontextmenu: (e) => e.preventDefault() });
  const code = el('span', { class: 'code' });
  const price = el('span', { class: 'price' });
  const buy = el('button', { class: 'btn btn-primary' });
  const goCart = el('a', { class: 'btn', href: '#/carrinho', html: ICONS.cart + ' Ver carrinho' });
  const box = el('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visualizar foto' },
    el('div', { class: 'lb-top' }, code,
      el('button', { class: 'icon-btn', 'aria-label': 'Ampliar', html: ICONS.zoom, onclick: () => box.classList.toggle('zoomed') }),
      el('button', { class: 'icon-btn', 'aria-label': 'Fechar', html: ICONS.close, onclick: closeLightbox })),
    el('div', { class: 'lb-stage' }, img,
      el('button', { class: 'icon-btn nav-arrow prev', 'aria-label': 'Foto anterior', html: ICONS.left, onclick: () => show(i - 1) }),
      el('button', { class: 'icon-btn nav-arrow next', 'aria-label': 'Próxima foto', html: ICONS.right, onclick: () => show(i + 1) })),
    el('div', { class: 'lb-bottom' }, price, buy, goCart,
      el('p', { class: 'note' }, 'Prévia protegida com marca-d\'água. Após o pagamento você recebe o arquivo original em alta resolução, sem marca-d\'água.')));

  function show(n) {
    i = (n + list.length) % list.length;
    const p = list[i];
    const item = photoItem(p, ev);
    box.classList.remove('zoomed');
    img.src = publicUrl(p.preview_path);
    img.alt = `Foto ${p.code} — ${ev.name}`;
    code.textContent = `#${p.code} · ${i + 1} de ${list.length}`;
    price.textContent = money(item.price_cents);
    const inCart = cart.has(p.id);
    buy.innerHTML = inCart ? ICONS.check + ' No carrinho' : ICONS.cart + ' COMPRAR FOTO';
    buy.onclick = () => { if (!cart.has(p.id)) { cart.add(item); toast('Foto adicionada ao carrinho'); } else { cart.remove(p.id); toast('Foto removida do carrinho'); } show(i); };
    setWaContext(`Foto ${p.code} do evento ${ev.name}`);
  }
  img.addEventListener('click', () => box.classList.toggle('zoomed'));
  let x0 = null;
  img.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', (e) => { if (x0 == null || box.classList.contains('zoomed')) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  document.addEventListener('keydown', onKey);
  lb = { box, onKey };
  document.body.append(box);
  document.body.style.overflow = 'hidden';
  show(i);
}
function closeLightbox() {
  if (!lb) return;
  document.removeEventListener('keydown', lb.onKey);
  lb.box.remove(); lb = null;
  document.body.style.overflow = '';
  setWaContext('');
}

// ---------------------------------------------------------------- páginas
// No celular: o "V" fica pequeno, flutuando no canto direito, e ao rolar a página ele voa e se encaixa no logo do topo.
function flyingMark(hero) {
  const SIZE = 58;
  const fly = el('div', { class: 'v-fly idle', 'aria-hidden': 'true' }, el('span', { html: LOGO }));
  hero.append(fly);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let ticking = false;
  const frame = () => {
    ticking = false;
    if (!fly.isConnected) { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); return; }
    const target = document.querySelector('.brand svg');
    const btn = hero.querySelector('.hero-actions .btn:last-child');
    if (!target || !btn) return;
    const t = target.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const y = window.scrollY;
    const startTop = b.top + y + b.height / 2 - SIZE / 2;
    const startLeft = document.documentElement.clientWidth - SIZE - 16;
    const dist = Math.max(120, startTop - t.top);
    const p = Math.min(1, Math.max(0, y / dist));
    const e = reduce ? (p > 0.5 ? 1 : 0) : ease(p);
    const top = startTop + (t.top - startTop) * e;
    const left = startLeft + (t.left - startLeft) * e;
    const scale = 1 + (t.width / SIZE - 1) * e;
    fly.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${scale})`;
    fly.style.opacity = p >= 1 ? '0' : '1';
    fly.classList.toggle('idle', p === 0);
    target.closest('.brand')?.classList.toggle('v-docked', p >= 1);
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  requestAnimationFrame(() => requestAnimationFrame(frame));
  setTimeout(frame, 400);
}

async function viewHome() {
  const s = await loadSettings();
  const hero = el('section', { class: 'hero' }, el('div', { class: 'grid-lines' }), el('div', { class: 'container' },
    el('div', {},
      el('p', { class: 'eyebrow' }, 'Galeria Vetor Digital · Fotografia esportiva'),
      el('h1', {}, 'Você em ação,', el('span', { class: 'accent' }, 'em alta resolução.')),
      el('p', { class: 'lead' }, 'Encontre suas fotos do evento pelo rosto, veja as prévias e compre os arquivos originais com Pix ou cartão. Download liberado logo após a confirmação do pagamento.'),
      el('div', { class: 'hero-actions' },
        el('a', { class: 'btn btn-primary', href: '#/eventos' }, 'Ver eventos e galerias'),
        el('a', { class: 'btn', href: '#/eventos', html: ICONS.face + ' Encontrar pelo rosto' })),
      el('div', { class: 'pay-badges' },
        el('span', { class: 'pill', html: ICONS.pix + ' Pix' }),
        el('span', { class: 'pill', html: ICONS.card + ' Cartão de crédito em parcelas' }),
        el('span', { class: 'pill', html: ICONS.lock + ' Pagamento seguro InfinitePay' }))),
    el('div', { class: 'hero-mark', html: LOGO })));

  const steps = [
    ['Escolha o evento', 'Abra a galeria da prova em que você correu.'],
    ['Encontre suas fotos', 'Envie uma selfie e o sistema localiza as fotos em que você aparece.'],
    ['Veja as prévias', 'Amplie as fotos com marca-d\'água e escolha as que quiser.'],
    ['Pague com Pix ou cartão', 'Checkout seguro da InfinitePay, com parcelamento no cartão.'],
    ['Receba os originais', 'Baixe os arquivos em alta resolução, sem marca-d\'água, assim que o pagamento for confirmado.']
  ];
  const how = el('section', { class: 'section' }, el('div', { class: 'container' },
    el('div', { class: 'section-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Como funciona'), el('h2', {}, 'Da linha de chegada para o seu celular'))),
    el('div', { class: 'steps' }, steps.map(([t, d]) => el('div', { class: 'step' }, el('h3', {}, t), el('p', {}, d))))));

  const evWrap = el('div', {}, el('div', { class: 'events' }, [1, 2, 3].map(() => el('div', { class: 'event-card skeleton', style: { height: '300px' } }))));
  const evSection = el('section', { class: 'section' }, el('div', { class: 'container' },
    el('div', { class: 'section-head' },
      el('div', {}, el('p', { class: 'eyebrow' }, 'Eventos disponíveis'), el('h2', {}, 'Galerias abertas')),
      el('a', { class: 'btn', href: '#/eventos' }, 'Ver todos os eventos')),
    evWrap));
  fetchEvents().then((evs) => {
    evWrap.replaceChildren(evs.length ? eventsGrid(evs.slice(0, 6))
      : el('div', { class: 'empty' }, el('b', {}, 'Novas galerias em breve'), 'Assim que as fotos do próximo evento forem publicadas, elas aparecem aqui.'));
  }).catch(() => evWrap.replaceChildren(el('div', { class: 'alert err' }, 'Não foi possível carregar os eventos agora.')));

  const company = s.company_name || 'Vetor Digital';
  const ig = s.instagram ? String(s.instagram).replace(/^@/, '') : '';
  const about = el('section', { class: 'section' }, el('div', { class: 'container about' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'Sobre'), el('h2', {}, company)),
    el('div', {},
      s.about ? el('p', { style: { whiteSpace: 'pre-line', marginTop: 0 } }, s.about) : null,
      el('p', {}, 'A Galeria Vetor Digital é a plataforma da ', company, ' para você encontrar e comprar as fotografias dos seus eventos esportivos: corrida, futebol, peteca e muito mais.'),
      el('div', { class: 'row' },
        ig ? el('a', { class: 'btn', href: `https://www.instagram.com/${ig}/`, target: '_blank', rel: 'noopener', html: ICONS.instagram + ' @' + ig }) : null))));

  // Suporte: pagamento, foto não encontrada ou outra dúvida -> WhatsApp da Vetor Digital
  const supportBtns = [
    supportLink(s, 'não consegui fazer o pagamento', 'Não consegui pagar', 'btn btn-primary'),
    supportLink(s, 'não encontrei minha foto', 'Não encontrei minha foto'),
    supportLink(s, 'tenho uma dúvida sobre a galeria', 'Outra dúvida')
  ].filter(Boolean);
  const support = supportBtns.length ? el('section', { class: 'section', id: 'suporte' }, el('div', { class: 'container' },
    el('div', { class: 'card support-card' },
      el('div', {}, el('p', { class: 'eyebrow' }, 'Suporte'), el('h2', {}, 'Precisa de ajuda?'),
        el('p', { class: 'muted', style: { margin: '8px 0 0' } }, 'Não conseguiu pagar ou não encontrou sua foto? Fale direto com a equipe da Vetor Digital pelo WhatsApp.')),
      el('div', { class: 'support-actions' }, supportBtns)))) : null;

  if (window.matchMedia('(max-width: 959px)').matches) flyingMark(hero);
  return [hero, evSection, how, about, support];
}

async function viewEvents() {
  const evs = await fetchEvents();
  const q = el('input', { class: 'input', type: 'search', placeholder: 'Buscar evento pelo nome ou local', 'aria-label': 'Buscar evento', style: { maxWidth: '360px' } });
  const wrap = el('div', {});
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const list = evs.filter((e) => !term || `${e.name} ${e.location || ''}`.toLowerCase().includes(term));
    wrap.replaceChildren(list.length ? eventsGrid(list) : el('div', { class: 'empty' }, el('b', {}, 'Nenhum evento encontrado'), term ? 'Tente outro nome.' : 'As galerias publicadas aparecem aqui.'));
  };
  q.addEventListener('input', draw);
  draw();
  return [el('section', { class: 'section' }, el('div', { class: 'container' },
    el('div', { class: 'section-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Eventos'), el('h2', {}, 'Escolha o seu evento')), q),
    wrap))];
}

function eventHeader(ev, count, withFaceCta = true) {
  return el('section', { class: 'ev-head' }, el('div', { class: 'container' },
    el('p', { class: 'eyebrow' }, (ev.category || 'Esporte').toUpperCase()),
    el('h1', { style: { fontSize: 'clamp(32px,6vw,60px)' } }, ev.name),
    el('div', { class: 'meta' },
      ev.event_date ? el('span', { html: ICONS.calendar }, dateBR(ev.event_date)) : null,
      ev.location ? el('span', { html: ICONS.pin }, ev.location) : null,
      count != null ? el('span', { class: 'mono' }, plural(count, 'foto', 'fotos')) : null,
      el('span', {}, 'A partir de ', el('b', { style: { color: 'var(--fg)', marginLeft: '4px' } }, money(ev.price_cents)), ' por foto')),
    ev.description ? el('p', { class: 'desc' }, ev.description) : null,
    withFaceCta && ev.face_search ? el('div', { class: 'face-cta' },
      el('div', { class: 'ico', html: ICONS.face }),
      el('div', {}, el('b', {}, 'ENCONTRE SUAS FOTOS PELO ROSTO'), el('p', {}, 'Envie uma selfie (ou digite seu número de peito) e veja só as fotos em que você aparece. A selfie não sai do seu celular.')),
      el('a', { class: 'btn btn-primary', href: `#/e/${ev.slug}/rosto`, html: ICONS.camera + ' Enviar selfie' })) : null,
    withFaceCta && !ev.face_search ? el('div', { class: 'face-cta' },
      el('div', { class: 'ico', html: ICONS.face }),
      el('div', {}, el('b', {}, 'ENCONTRE SUAS FOTOS PELO NÚMERO'), el('p', {}, 'Digite o seu número de peito para ver as fotos que o fotógrafo separou para você.')),
      el('a', { class: 'btn btn-primary', href: `#/e/${ev.slug}/rosto` }, 'Buscar pelo número')) : null));
}

async function viewEvent(slug, rid) {
  const ev = await fetchEvent(slug);
  if (!ev) return notFound('Evento não encontrado ou ainda não publicado.');
  setWaContext(`Evento: ${ev.name}`);
  const total = await photoCount(ev.id);
  const list = [];
  const grid = el('div', { class: 'photos' });
  const more = el('button', { class: 'btn' }, 'Carregar mais fotos');
  const moreWrap = el('div', { class: 'load-more' }, more);
  const counter = el('span', { class: 'count' });

  async function loadMore() {
    more.disabled = true; more.textContent = 'Carregando…';
    const batch = await fetchPhotos(ev.id, list.length);
    if (rid !== renderId) return;
    const start = list.length;
    list.push(...batch);
    batch.forEach((p, k) => grid.append(photoCard(p, ev, list, start + k)));
    counter.textContent = `${list.length.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} fotos`;
    moreWrap.hidden = list.length >= total || batch.length < PAGE;
    more.disabled = false; more.textContent = 'Carregar mais fotos';
  }
  more.addEventListener('click', loadMore);
  // Carrega mais automaticamente ao chegar perto do fim
  const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !more.disabled && !moreWrap.hidden) loadMore(); }, { rootMargin: '600px' });
  io.observe(moreWrap);
  pageCtl.signal.addEventListener('abort', () => io.disconnect());

  const body = total
    ? [el('div', { class: 'toolbar' }, counter, el('a', { class: 'btn btn-sm', href: '#/carrinho', html: ICONS.cart + ' Ir para o carrinho' })), grid, moreWrap]
    : [el('div', { class: 'empty', style: { margin: '32px 0' } }, el('b', {}, 'As fotos ainda estão sendo publicadas'), 'Volte em breve ou fale com a gente pelo WhatsApp.')];
  if (total) loadMore();
  return [eventHeader(ev, total), el('section', {}, el('div', { class: 'container', style: { paddingBottom: '56px' } }, body))];
}

async function viewFace(slug, rid) {
  const ev = await fetchEvent(slug);
  if (!ev) return notFound('Evento não encontrado.');
  setWaContext(`Busca pelo rosto no evento ${ev.name}`);
  const flow = el('div', { class: 'face-flow' });
  // O botão Voltar do topo da página leva de volta às fotos do evento.

  const status = el('div', { class: 'card stack', hidden: true });
  const results = el('div', {});

  // Busca pelo número de peito: encontra a pasta que o fotógrafo montou para o atleta.
  const bibIn = el('input', { class: 'input', inputmode: 'numeric', placeholder: 'Ex.: 1234', 'aria-label': 'Número de peito', style: { maxWidth: '180px' } });
  const bibBtn = el('button', { class: 'btn' }, 'Buscar pelo número');
  const bibForm = el('form', { class: 'card stack bib-card' },
    el('b', {}, 'Ou procure pelo número de peito'),
    el('p', { class: 'muted', style: { margin: 0, fontSize: '14px' } }, 'Funciona quando o fotógrafo já separou suas fotos numa pasta com o seu número.'),
    el('div', { class: 'row' }, bibIn, bibBtn));
  bibForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bib = bibIn.value.replace(/\D+/g, '');
    if (!bib) return bibIn.focus();
    bibBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc('search_bib', { p_event: ev.id, p_bib: bib });
      if (error) throw new Error('Não foi possível buscar agora. Tente novamente.');
      const ids = (data || []).map((r) => r.photo_id);
      const photos = ids.length ? await fetchPhotosByIds(ids) : [];
      if (rid !== renderId) return;
      status.hidden = false;
      status.replaceChildren(el('div', {}, el('b', { style: { fontSize: '20px' } }, photos.length ? `${plural(photos.length, 'foto', 'fotos')} com o número ${bib}` : `Nenhuma pasta com o número ${bib}`),
        el('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '14px' } }, photos.length ? 'Confira as fotos e adicione ao carrinho.' : 'Tente pelo rosto ou veja todas as fotos do evento.')));
      results.replaceChildren(...(photos.length ? faceResults(photos, ev) : []));
      status.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      status.hidden = false; status.replaceChildren(el('div', { class: 'alert err' }, err.message));
    } finally { bibBtn.disabled = false; }
  });
  if (!ev.face_search) {
    flow.append(el('div', { class: 'alert' }, 'A busca pelo rosto não está disponível para este evento.'), bibForm, status, results);
    return [eventHeader(ev, null, false), el('div', { class: 'container' }, flow)];
  }

  const agree = el('input', { type: 'checkbox', id: 'consent' });
  const start = el('button', { class: 'btn btn-primary', disabled: true, html: ICONS.camera + ' Enviar selfie' });
  const input = el('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: true });
  agree.addEventListener('change', () => { start.disabled = !agree.checked; });
  start.addEventListener('click', () => input.click());

  const consent = el('div', { class: 'card consent' },
    el('p', { class: 'eyebrow', style: { margin: 0 } }, 'Antes de começar'),
    el('h2', { style: { fontSize: '28px' } }, 'Encontre suas fotos pelo rosto'),
    el('ul', {},
      el('li', {}, 'Sua selfie é analisada aqui no seu aparelho. A imagem da selfie não é enviada nem armazenada.'),
      el('li', {}, 'Só uma sequência de números que representa o rosto é usada para comparar com as fotos deste evento, e é descartada logo após a busca.'),
      el('li', {}, 'Os dados faciais das fotos do evento são excluídos automaticamente após o prazo informado na política de privacidade.'),
      el('li', {}, 'A busca é opcional: você também pode ver todas as fotos do evento sem enviar selfie.')),
    el('label', { class: 'check-row', for: 'consent' }, agree,
      el('span', {}, 'Li a ', el('a', { href: '#/privacidade', target: '_blank' }, 'política de privacidade'), ' e autorizo, de forma livre e explícita, o uso da minha selfie para localizar minhas fotos neste evento.')),
    el('div', { class: 'row' }, start, input));

  flow.append(consent, bibForm, status, results);

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    consent.hidden = true; status.hidden = false; results.replaceChildren();
    const bar = el('i');
    const msg = el('span', {}, 'Carregando o reconhecimento facial…');
    status.replaceChildren(el('div', { class: 'row' }, el('span', { class: 'spinner' }), msg), el('div', { class: 'progress' }, bar));
    bar.style.width = '15%';
    try {
      const slow = setTimeout(() => { msg.textContent = 'Primeira vez pode levar alguns segundos…'; }, 4000);
      const { descriptor, canvas } = await selfieDescriptor(file);
      clearTimeout(slow);
      bar.style.width = '70%'; msg.textContent = 'Procurando você nas fotos do evento…';
      const { data, error } = await sb.rpc('search_faces', { p_event: ev.id, p_embedding: vectorLiteral(descriptor), p_threshold: 0.5 });
      descriptor.fill(0);
      if (error) throw new Error('Não foi possível fazer a busca agora. Tente novamente.');
      const ids = (data || []).map((r) => r.photo_id);
      const viaFolder = (data || []).filter((r) => r.via === 'pasta').length;
      const photos = ids.length ? await fetchPhotosByIds(ids) : [];
      if (rid !== renderId) return;
      const order = new Map(ids.map((id, n) => [id, n]));
      photos.sort((a, b) => order.get(a.id) - order.get(b.id));
      bar.style.width = '100%';
      const thumb = el('img', { class: 'selfie-preview', alt: 'Sua selfie (só neste aparelho)' });
      thumb.src = canvas.toDataURL('image/jpeg', 0.7);
      status.replaceChildren(el('div', { class: 'row' }, thumb,
        el('div', {}, el('b', { style: { fontSize: '20px' } }, photos.length ? plural(photos.length, 'foto encontrada', 'fotos encontradas') : 'Nenhuma foto encontrada'),
          el('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '14px' } }, photos.length ? 'Confira as fotos, desmarque as que não são suas e adicione ao carrinho.' : 'Tente outra selfie (de frente, boa luz, sem boné ou óculos escuros) ou veja todas as fotos do evento.'),
          viaFolder && photos.length ? el('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '14px' } }, `Inclui ${plural(viaFolder, 'foto', 'fotos')} que o fotógrafo separou na sua pasta (de costas, de longe…).`) : null)),
        el('div', { class: 'row' }, el('button', { class: 'btn btn-sm', onclick: () => input.click(), html: ICONS.camera + ' Tentar outra selfie' }), el('a', { class: 'btn btn-sm', href: `#/e/${ev.slug}` }, 'Ver todas as fotos'),
          photos.length ? null : supportLink(await loadSettings(), `não encontrei minha foto no evento ${ev.name}`, 'Não achou? Fale com o suporte')));
      if (photos.length) results.replaceChildren(...faceResults(photos, ev));
    } catch (e) {
      status.replaceChildren(el('div', { class: 'alert err' }, e.message || 'Erro na busca.'),
        el('div', { class: 'row' }, el('button', { class: 'btn btn-primary btn-sm', onclick: () => input.click(), html: ICONS.camera + ' Tentar novamente' })));
    }
  });

  return [eventHeader(ev, null, false), el('div', { class: 'container' }, flow)];
}

function faceResults(photos, ev) {
  const selected = new Set(photos.map((p) => p.id));
  const addBtn = el('button', { class: 'btn btn-primary' });
  const allBtn = el('button', { class: 'btn btn-sm' });
  const update = () => {
    addBtn.innerHTML = `${ICONS.cart} Adicionar ${selected.size} ${selected.size === 1 ? 'foto' : 'fotos'} ao carrinho`;
    addBtn.disabled = !selected.size;
    allBtn.textContent = selected.size === photos.length ? 'Desmarcar todas' : 'Selecionar todas';
  };
  const grid = el('div', { class: 'photos' });
  const draw = () => grid.replaceChildren(...photos.map((p, i) => photoCard(p, ev, photos, i, { selectable: true, selected, onChange: update })));
  allBtn.addEventListener('click', () => { if (selected.size === photos.length) selected.clear(); else photos.forEach((p) => selected.add(p.id)); draw(); update(); });
  addBtn.addEventListener('click', () => {
    cart.addMany(photos.filter((p) => selected.has(p.id)).map((p) => photoItem(p, ev)));
    toast(`${selected.size} ${selected.size === 1 ? 'foto adicionada' : 'fotos adicionadas'} ao carrinho`);
    location.hash = '#/carrinho';
  });
  draw(); update();
  return [el('div', { class: 'toolbar' }, allBtn, addBtn), grid];
}

async function viewCart() {
  setWaContext('Estou com dificuldade para finalizar a compra');
  const wrap = el('div', { class: 'container cart-layout' });
  const s = await loadSettings();

  // Confere preços e disponibilidade atuais no banco
  let items = cart.items();
  let notice = null;
  if (items.length) {
    const fresh = await fetchPhotosByIds(items.map((i) => i.id)).catch(() => null);
    if (fresh) {
      const evs = await fetchEvents().catch(() => []);
      const evById = new Map(evs.map((e) => [e.id, e]));
      const byId = new Map(fresh.map((p) => [p.id, p]));
      const kept = [];
      items.forEach((i) => {
        const p = byId.get(i.id); const ev = p && evById.get(p.event_id);
        if (p && ev) kept.push(photoItem(p, ev));
      });
      if (kept.length !== items.length) notice = el('div', { class: 'alert warn' }, 'Algumas fotos não estão mais disponíveis e foram retiradas do carrinho.');
      cart.save(kept); items = kept;
    }
  }

  if (!items.length) {
    return [el('div', { class: 'container', style: { padding: '48px 18px 72px' } }, el('div', { class: 'empty' },
      el('b', {}, 'Seu carrinho está vazio'), el('p', {}, 'Escolha um evento e adicione as fotos que quiser comprar.'),
      el('a', { class: 'btn btn-primary', href: '#/eventos' }, 'Ver eventos')))];
  }

  const rows = items.map((i) => el('tr', {},
    el('td', { style: { width: '76px' } }, el('img', { src: publicUrl(i.thumb_path), alt: '' })),
    el('td', {}, el('div', { class: 'mono' }, '#' + i.code), el('div', { class: 'muted', style: { fontSize: '13px' } }, i.event_name)),
    el('td', { class: 'num hide-xs' }, '1'),
    el('td', { class: 'num' }, money(i.price_cents)),
    el('td', { class: 'num' }, el('button', { class: 'icon-btn', 'aria-label': 'Remover', html: ICONS.trash, onclick: () => { cart.remove(i.id); route(); } }))));

  const list = el('div', { class: 'card' },
    el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '14px' } },
      el('h2', { style: { fontSize: '28px' } }, 'Carrinho'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm('Esvaziar o carrinho?')) { cart.clear(); route(); } } }, 'Esvaziar')),
    notice,
    el('table', { class: 'cart-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Foto'), el('th', {}, ''), el('th', { class: 'num hide-xs' }, 'Qtd.'), el('th', { class: 'num' }, 'Valor'), el('th', {}, ''))),
      el('tbody', {}, rows)));

  const last = store.get('vd_buyer_v1', {});
  const name = el('input', { class: 'input', name: 'name', autocomplete: 'name', required: true, value: last.name || '' });
  const email = el('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', required: true, value: last.email || '' });
  const phone = el('input', { class: 'input', name: 'phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(00) 00000-0000', value: last.phone || '' });
  const terms = el('input', { type: 'checkbox', required: true });
  const err = el('div', { class: 'alert err', hidden: true });
  const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit', style: { minHeight: '54px', fontSize: '16px' }, html: ICONS.lock + ' FINALIZAR COMPRA' });
  const disc = Number(s.pix_discount_pct) || 0;
  const discTxt = disc > 0 ? ` · ${String(disc).replace('.', ',')}% de desconto` : '';
  const payRadio = (value, label, icon, checked) => el('label', { class: 'pill', style: { cursor: 'pointer', gap: '8px' } },
    el('input', { type: 'radio', name: 'pay', value, checked }), el('span', { html: icon + ' ' + label }));
  const payBox = el('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
    payRadio('pix', 'Pix' + discTxt, ICONS.pix, true), payRadio('credit_card', 'Cartão de crédito / parcelado', ICONS.card, false));
  const waHelp = el('a', { href: '#', class: 'muted', style: { fontSize: '13px', textAlign: 'center', display: 'block' } }, 'Prefere combinar o pagamento pelo WhatsApp?');

  // ---- desconto progressivo por álbum + gorjeta (mesma regra usada pelo servidor na cobrança)
  let tipCents = 0;
  const pctTxt = (n) => `${n}%`;
  const summaryBox = el('div', { class: 'stack', style: { gap: '10px' } });
  const tipErr = el('div', { class: 'field-err', hidden: true });
  const tipInput = el('input', { class: 'input', inputmode: 'decimal', placeholder: 'Ex.: 15,00', maxlength: '8', 'aria-label': 'Valor da gorjeta em reais', hidden: true });
  const tipChip = (value, label, checked) => el('label', { class: 'pill tip-chip' }, el('input', { type: 'radio', name: 'tip', value, checked }), el('span', {}, label));
  const tipBox = el('div', { class: 'tip-chips' },
    tipChip('0', 'Sem gorjeta', true),
    ...TIP_OPTIONS_CENTS.map((c) => tipChip(String(c), money(c).replace(',00', ''), false)),
    tipChip('outro', 'Outro valor', false));
  const readTip = () => {
    const v = form.querySelector('input[name=tip]:checked')?.value || '0';
    tipInput.hidden = v !== 'outro';
    if (v !== 'outro') { tipErr.hidden = true; return { cents: Number(v) }; }
    const r = parseTip(tipInput.value);
    tipErr.textContent = r.error || ''; tipErr.hidden = !r.error;
    return r;
  };
  const renderSummary = () => {
    const p = priceCart(cart.items(), tipCents);
    const rows = [];
    for (const a of p.albums) {
      rows.push(el('div', { class: 'album-sum' },
        el('div', { class: 'row', style: { justifyContent: 'space-between' } },
          el('b', {}, a.event_name), el('span', { class: 'muted' }, plural(a.count, 'foto', 'fotos'))),
        el('div', { class: 'sum-line' }, el('span', {}, 'Subtotal'), el('span', {}, money(a.subtotal_cents))),
        a.discount_pct ? el('div', { class: 'sum-line disc' }, el('span', {}, `Desconto de ${pctTxt(a.discount_pct)} aplicado`), el('span', {}, '− ' + money(a.discount_cents))) : null,
        a.next && a.next.missing <= 3 ? el('div', { class: 'disc-hint' }, `Adicione mais ${plural(a.next.missing, 'foto', 'fotos')} deste álbum e ganhe ${pctTxt(a.next.pct)} de desconto`) : null));
    }
    if (p.albums.length > 1) rows.push(el('div', { class: 'sum-line' }, el('span', {}, 'Subtotal'), el('span', {}, money(p.subtotal_cents))));
    if (p.discount_cents && p.albums.length > 1) rows.push(el('div', { class: 'sum-line disc' }, el('span', {}, 'Descontos'), el('span', {}, '− ' + money(p.discount_cents))));
    if (p.tip_cents) rows.push(el('div', { class: 'sum-line' }, el('span', {}, 'Gorjeta ao fotógrafo'), el('span', {}, money(p.tip_cents))));
    rows.push(el('div', { class: 'total-row' }, el('span', {}, 'Total'), el('b', {}, money(p.total_cents))));
    summaryBox.replaceChildren(...rows);
    return p;
  };
  const onTip = () => { const r = readTip(); tipCents = r.error ? 0 : r.cents; renderSummary(); };

  const form = el('form', { class: 'card stack summary', novalidate: true },
    el('h3', {}, 'Resumo do pedido'),
    el('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, 'Desconto automático por álbum: 2 fotos 5% · 5 fotos 10% · 10 fotos 20%.'),
    summaryBox,
    el('div', { class: 'field tip-field' }, el('label', {}, 'Quer deixar uma gorjeta para o fotógrafo?'), tipBox, tipInput, tipErr,
      el('span', { class: 'muted', style: { fontSize: '12px' } }, 'Opcional. O desconto não incide sobre a gorjeta. Máximo R$ 500,00.')),
    disc > 0 ? el('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, `No Pix, o desconto de ${String(disc).replace('.', ',')}% é aplicado na página de pagamento.`) : null,
    el('div', { class: 'field' }, el('label', {}, 'Nome completo'), name),
    el('div', { class: 'field' }, el('label', {}, 'E-mail'), email),
    el('div', { class: 'field' }, el('label', {}, 'WhatsApp (opcional)'), phone),
    el('div', { class: 'field' }, el('label', {}, 'Forma de pagamento'), payBox),
    el('label', { class: 'check-row' }, terms, el('span', {}, 'Concordo com a ', el('a', { href: '#/privacidade', target: '_blank' }, 'política de privacidade'), ' e entendo que os arquivos são digitais, liberados após a confirmação do pagamento.')),
    err, submit,
    el('p', { class: 'muted', style: { fontSize: '13px', margin: 0, textAlign: 'center' } }, 'Você será levado ao checkout seguro da InfinitePay. O parcelamento no cartão segue as condições da InfinitePay. Os originais são liberados assim que o pagamento é confirmado.'),
    waHelp,
    supportLink(s, 'não estou conseguindo fazer o pagamento das fotos', 'Problema para pagar? Fale com o suporte', 'btn btn-sm btn-block'));

  tipBox.addEventListener('change', () => { onTip(); if (!tipInput.hidden) tipInput.focus(); });
  tipInput.addEventListener('input', () => { tipInput.value = tipInput.value.replace(/[^\d,.]/g, ''); onTip(); });
  renderSummary();

  const validate = () => {
    err.hidden = true;
    const t = readTip();
    if (t.error) return 'Gorjeta: ' + t.error;
    tipCents = t.cents;
    if (name.value.trim().length < 3) return 'Informe seu nome completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) return 'Informe um e-mail válido.';
    if (!terms.checked) return 'Para continuar, aceite a política de privacidade.';
    return null;
  };
  const fail = (m) => { err.textContent = m; err.hidden = false; };

  waHelp.addEventListener('click', async (e) => {
    e.preventDefault();
    const v = validate(); if (v) return fail(v);
    const settings = await loadSettings();
    const pay = form.querySelector('input[name=pay]:checked')?.value === 'credit_card' ? 'Cartão' : 'Pix';
    const buyer = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() };
    const cur = cart.items();
    const p = priceCart(cur, tipCents);
    const lines = ['*NOVO PEDIDO DE FOTOS*'];
    for (const a of p.albums) {
      lines.push('', `*Álbum: ${a.event_name}*`, ...cur.filter((i) => String(i.event_id) === String(a.event_id)).map((i) => `• Foto #${i.code} — ${money(i.price_cents)}`),
        `Quantidade: ${plural(a.count, 'foto', 'fotos')}`, `Subtotal: ${money(a.subtotal_cents)}`,
        `Desconto: ${a.discount_pct}% (− ${money(a.discount_cents)})`, `Total do álbum: ${money(a.total_cents)}`);
    }
    lines.push('', `Subtotal geral: ${money(p.subtotal_cents)}`, `Descontos: − ${money(p.discount_cents)}`, `Gorjeta: ${money(p.tip_cents)}`,
      `*TOTAL A PAGAR: ${money(p.total_cents)}*`, `Pagamento: ${pay}`, '', `Nome: ${buyer.name}`, `E-mail: ${buyer.email}`);
    if (buyer.phone) lines.push(`WhatsApp: ${buyer.phone}`);
    const msg = lines.join('\n');
    const href = waLink({ whatsapp: settings.whatsapp, whatsapp_message: msg });
    if (!href) return fail('O WhatsApp da loja ainda não foi configurado.');
    window.open(href, '_blank', 'noopener') || (location.href = href);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validate(); if (v) return fail(v);
    submit.disabled = true; submit.innerHTML = '<span class="spinner"></span> Gerando pagamento seguro…';
    const buyer = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() };
    store.set('vd_buyer_v1', buyer);
    const paymentMethod = form.querySelector('input[name=pay]:checked')?.value === 'credit_card' ? 'credit_card' : 'pix';
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_ids: cart.items().map((i) => i.id), customer: buyer, payment_method: paymentMethod, tip_cents: tipCents })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível iniciar o pagamento.');
      myOrders.add({ id: data.order_id, token: data.token, code: data.code, total_cents: data.total_cents });
      cart.clear();
      location.href = data.checkout_url;
    } catch (ex) {
      fail(ex.message);
      submit.disabled = false; submit.innerHTML = ICONS.lock + ' FINALIZAR COMPRA';
    }
  });

  wrap.append(el('div', { class: 'stack' }, list, el('a', { class: 'muted', href: '#/eventos', style: { fontSize: '14px' } }, '← Continuar escolhendo fotos')), form);
  return [wrap];
}

async function viewPurchases() {
  setWaContext('Preciso de ajuda com uma compra');
  const mine = myOrders.list();
  const out = el('div', { class: 'stack' });
  const code = el('input', { class: 'input', placeholder: 'VD-XXXXXXXX', autocomplete: 'off', style: { textTransform: 'uppercase' } });
  const email = el('input', { class: 'input', type: 'email', placeholder: 'E-mail usado na compra', autocomplete: 'email' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Abrir pedido');
  const form = el('form', { class: 'card stack' },
    el('h3', {}, 'Buscar um pedido'),
    el('p', { class: 'muted', style: { margin: 0, fontSize: '14px' } }, 'Use o código do pedido e o e-mail informado na compra.'),
    el('div', { class: 'form-grid two' }, el('div', { class: 'field' }, el('label', {}, 'Código do pedido'), code), el('div', { class: 'field' }, el('label', {}, 'E-mail'), email)),
    el('div', { class: 'row' }, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Buscando…';
    try {
      const data = await apiOrder({ code: code.value, email: email.value });
      out.replaceChildren(...await renderOrder(data));
    } catch (ex) {
      out.replaceChildren(el('div', { class: 'alert err' }, ex.message));
    }
    btn.disabled = false; btn.textContent = 'Abrir pedido';
  });

  const local = mine.length ? el('div', { class: 'card stack' },
    el('h3', {}, 'Pedidos feitos neste aparelho'),
    mine.map((o) => el('a', { class: 'row', href: `/pedido/${o.id}/${o.token}`, style: { justifyContent: 'space-between', textDecoration: 'none', padding: '10px 0', borderTop: '1px solid var(--line)' } },
      el('span', { class: 'mono' }, o.code), el('span', { class: 'muted' }, money(o.total_cents)), el('span', { class: 'accent' }, 'Abrir →')))) : null;

  return [el('div', { class: 'container order-box' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'Área do cliente'), el('h1', { style: { fontSize: 'clamp(32px,6vw,52px)' } }, 'Minhas compras')),
    local, form, out)];
}

async function viewPrivacy() {
  const s = await loadSettings();
  const company = s.company_name || 'Vetor Digital';
  const days = s.face_retention_days || 90;
  const contact = [s.email, s.whatsapp ? `WhatsApp +${s.whatsapp}` : null].filter(Boolean).join(' ou ');
  const ed = (txt) => el('span', { class: 'editable' }, txt);
  return [el('div', { class: 'container' }, el('article', { class: 'legal' },
    el('p', { class: 'eyebrow' }, 'Privacidade'),
    el('h1', { style: { fontSize: 'clamp(32px,6vw,52px)' } }, 'Política de privacidade e dados faciais'),
    el('p', {}, `Esta política explica como a ${company} trata os dados pessoais na Galeria Vetor Digital, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).`),
    el('h2', {}, 'Controlador'),
    el('p', {}, company, s.cnpj ? `, CNPJ ${s.cnpj}` : '', '. Contato: ', contact || ed('[preencher e-mail ou WhatsApp de contato no painel]'), '.'),
    el('h2', {}, 'Dados que tratamos'),
    el('ul', {},
      el('li', {}, 'Compra: nome, e-mail, WhatsApp (opcional) e dados do pedido, para processar o pagamento e entregar as fotos.'),
      el('li', {}, 'Pagamento: é processado pela InfinitePay. Não recebemos nem armazenamos dados de cartão.'),
      el('li', {}, 'Fotografias dos eventos: imagens feitas durante as provas, publicadas com marca-d\'água para venda.')),
    el('h2', {}, 'Busca pelo rosto (dados biométricos)'),
    el('ul', {},
      el('li', {}, 'A busca pelo rosto é opcional e só acontece depois do seu consentimento explícito.'),
      el('li', {}, 'A selfie é analisada no seu próprio aparelho. A imagem da selfie não é enviada aos nossos servidores nem armazenada.'),
      el('li', {}, 'Apenas um vetor numérico do rosto é enviado para comparação com as fotos do evento selecionado e é descartado após a busca, sem ficar gravado.'),
      el('li', {}, `Para permitir a busca, geramos vetores faciais das fotos do evento. Eles ficam em área restrita, nunca são exibidos publicamente e são excluídos automaticamente em até ${days} dias após o evento, ou antes, por solicitação.`)),
    el('h2', {}, 'Seus direitos'),
    el('p', {}, 'Você pode pedir acesso, correção, exclusão dos seus dados ou a retirada de uma foto em que aparece, e revogar o consentimento a qualquer momento, pelos contatos acima.'),
    el('h2', {}, 'Compartilhamento'),
    el('p', {}, 'Compartilhamos dados apenas com os serviços necessários para o funcionamento da plataforma: InfinitePay (pagamentos), Supabase (banco de dados e armazenamento), Netlify (hospedagem) e WhatsApp (atendimento).'),
    el('p', { class: 'muted', style: { fontSize: '13px', marginTop: '28px' } }, 'Recomendamos revisar este texto com um advogado antes da publicação definitiva.')))];
}

function notFound(msg) {
  return [el('div', { class: 'container', style: { padding: '72px 18px' } }, el('div', { class: 'empty' }, el('b', {}, msg || 'Página não encontrada'), el('a', { class: 'btn', href: '#/' }, 'Voltar ao início')))];
}

// ---------------------------------------------------------------- roteador
let lastEventSlug = '';
// Tela "pai" de cada página, usada pelo botão Voltar quando não há tela anterior nesta aba.
function backFor(parts) {
  if (!parts.length) return null; // página inicial não tem Voltar
  const [p0, p1, p2] = parts;
  if (p0 === 'e' && p1 && p2 === 'rosto') return backBar(`#/e/${encodeURIComponent(p1)}`, 'Voltar para as fotos do evento');
  if (p0 === 'e' && p1) return backBar('#/eventos', 'Voltar');
  if (p0 === 'carrinho') return backBar(lastEventSlug ? `#/e/${encodeURIComponent(lastEventSlug)}` : '#/eventos', 'Voltar');
  return backBar('#/', 'Voltar');
}

async function route() {
  const rid = ++renderId;
  pageCtl.abort(); pageCtl = new AbortController();
  closeLightbox();
  setWaContext('');
  if (!CONFIGURED) { app.replaceChildren(setupScreen()); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  let active = 'home';
  let view;
  try {
    if (!parts.length) view = viewHome();
    else if (parts[0] === 'eventos') { active = 'eventos'; view = viewEvents(); }
    else if (parts[0] === 'e' && parts[1] && parts[2] === 'rosto') { active = 'eventos'; view = viewFace(parts[1], rid); }
    else if (parts[0] === 'e' && parts[1]) { active = 'eventos'; view = viewEvent(parts[1], rid); }
    else if (parts[0] === 'carrinho') { active = 'carrinho'; view = viewCart(); }
    else if (parts[0] === 'compras') { active = 'compras'; view = viewPurchases(); }
    else if (parts[0] === 'privacidade') view = viewPrivacy();
    else view = notFound();
    trackNav();
    if (parts[0] === 'e' && parts[1]) lastEventSlug = parts[1];
    const nodes = await view;
    if (rid !== renderId) return;
    const back = backFor(parts);
    await mount(active, back ? [el('div', { class: 'container' }, back), ...[nodes].flat()] : nodes);
  } catch (e) {
    console.error(e);
    if (rid !== renderId) return;
    await mount(active, [el('div', { class: 'container' }, backFor(parts) || backBar('#/', 'Voltar')), el('div', { class: 'container', style: { padding: '40px 18px' } }, el('div', { class: 'alert err' }, 'Não foi possível carregar esta página. Verifique sua conexão e tente de novo.'))]);
  }
}

window.addEventListener('hashchange', route);
route();
mountWhatsApp();
