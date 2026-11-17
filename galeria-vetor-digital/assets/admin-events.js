// Painel: eventos, envio em lote, organização das fotos e dados faciais.
import { sb, el, ICONS, money, dateBR, plural, publicUrl, toast, loadSettings } from './core.js';
import { buildVariants, canvasFromBlob } from './watermark.js';
import { photoFaces, vectorLiteral, loadFaceApi } from './face.js';
import { saveSigned } from './vd-client.js';

const ADMIN_PAGE = 120;
const CONCURRENCY = 3;

export const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const centsFromInput = (v) => Math.round(parseFloat(String(v).replace(/\./g, '').replace(',', '.')) * 100);
const centsToInput = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

let uploading = false;
window.addEventListener('beforeunload', (e) => { if (uploading) { e.preventDefault(); e.returnValue = ''; } });
export const isUploading = () => uploading;

async function countPhotos(eventId, extra) {
  let q = sb.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
  if (extra) q = extra(q);
  const { count } = await q;
  return count || 0;
}

// ---------------------------------------------------------------- lista
export async function viewEvents() {
  const { data: events, error } = await sb.from('events').select('*').order('event_date', { ascending: false, nullsFirst: true });
  if (error) throw error;
  const tbody = el('tbody');
  for (const ev of events) {
    const n = el('td', { class: 'num' }, '…');
    countPhotos(ev.id).then((c) => { n.textContent = c.toLocaleString('pt-BR'); });
    tbody.append(el('tr', { class: 'click', onclick: () => { location.hash = `#/eventos/${ev.id}`; } },
      el('td', {}, ev.cover_path ? el('img', { src: publicUrl(ev.cover_path), alt: '' }) : el('div', { style: { width: '44px', height: '56px', borderRadius: '6px', background: 'var(--surface-2)' } })),
      el('td', {}, el('b', {}, ev.name), el('div', { class: 'muted', style: { fontSize: '12px' } }, ev.category)),
      el('td', {}, dateBR(ev.event_date)),
      el('td', {}, ev.location || '—'),
      n,
      el('td', { class: 'num' }, money(ev.price_cents)),
      el('td', {}, el('span', { class: 'tag ' + (ev.published ? 'on' : 'off') }, ev.published ? 'Publicado' : 'Rascunho'))));
  }
  return [
    el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, 'Eventos'), el('h1', {}, 'Galerias de eventos')),
      el('a', { class: 'btn btn-primary', href: '#/eventos/novo', html: ICONS.plus + ' Novo evento' })),
    events.length
      ? el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Evento'), el('th', {}, 'Data'), el('th', {}, 'Local'), el('th', { class: 'num' }, 'Fotos'), el('th', { class: 'num' }, 'Preço'), el('th', {}, 'Status'))),
          tbody))
      : el('div', { class: 'empty' }, el('b', {}, 'Nenhum evento ainda'), 'Crie o primeiro evento e envie as fotografias.')
  ];
}

// ---------------------------------------------------------------- formulário
export async function viewEventForm(id) {
  const s = await loadSettings();
  let ev = { name: '', slug: '', category: 'Corrida de rua', event_date: '', location: '', description: '', price_cents: s.default_price_cents || 1500, published: false, face_search: true };
  if (id) {
    const { data, error } = await sb.from('events').select('*').eq('id', id).single();
    if (error) throw error;
    ev = data;
  }
  const f = {
    name: el('input', { class: 'input', required: true, value: ev.name }),
    slug: el('input', { class: 'input', required: true, value: ev.slug, pattern: '[a-z0-9\\-]+' }),
    category: el('input', { class: 'input', value: ev.category, list: 'cats' }),
    event_date: el('input', { class: 'input', type: 'date', value: ev.event_date || '' }),
    location: el('input', { class: 'input', value: ev.location || '', placeholder: 'Cidade - UF' }),
    description: el('textarea', { class: 'input' }, ev.description || ''),
    price: el('input', { class: 'input', inputmode: 'decimal', value: centsToInput(ev.price_cents) }),
    published: el('input', { type: 'checkbox', checked: ev.published }),
    face_search: el('input', { type: 'checkbox', checked: ev.face_search })
  };
  let slugTouched = Boolean(id);
  f.slug.addEventListener('input', () => { slugTouched = true; });
  f.name.addEventListener('input', () => { if (!slugTouched) f.slug.value = slugify(f.name.value); });
  const err = el('div', { class: 'alert err', hidden: true });
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar alterações' : 'Criar evento');
  const form = el('form', { class: 'card stack' },
    el('datalist', { id: 'cats' }, ['Corrida de rua', 'Futebol', 'Futsal', 'Peteca', 'Vôlei', 'Basquete', 'Trail run', 'Ciclismo', 'Triathlon', 'Natação'].map((c) => el('option', { value: c }))),
    el('div', { class: 'form-grid two' },
      el('div', { class: 'field' }, el('label', {}, 'Nome do evento'), f.name),
      el('div', { class: 'field' }, el('label', {}, 'Endereço da galeria (slug)'), f.slug),
      el('div', { class: 'field' }, el('label', {}, 'Categoria'), f.category),
      el('div', { class: 'field' }, el('label', {}, 'Data do evento'), f.event_date),
      el('div', { class: 'field' }, el('label', {}, 'Local'), f.location),
      el('div', { class: 'field' }, el('label', {}, 'Preço por foto (R$)'), f.price)),
    el('div', { class: 'field' }, el('label', {}, 'Descrição'), f.description),
    el('label', { class: 'switch' }, f.published, 'Galeria publicada (visível no site)'),
    el('label', { class: 'switch' }, f.face_search, 'Permitir busca pelo rosto neste evento'),
    err, el('div', { class: 'row' }, save, el('a', { class: 'btn btn-ghost', href: id ? `#/eventos/${id}` : '#/eventos' }, 'Cancelar')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const price = centsFromInput(f.price.value);
    const row = {
      name: f.name.value.trim(), slug: slugify(f.slug.value), category: f.category.value.trim() || 'Corrida de rua',
      event_date: f.event_date.value || null, location: f.location.value.trim() || null,
      description: f.description.value.trim() || null, price_cents: price,
      published: f.published.checked, face_search: f.face_search.checked
    };
    if (!row.name) { err.textContent = 'Informe o nome.'; err.hidden = false; return; }
    if (!row.slug) { err.textContent = 'Informe o endereço (slug).'; err.hidden = false; return; }
    if (!Number.isFinite(price) || price < 100) { err.textContent = 'O preço mínimo é R$ 1,00 (exigência da InfinitePay).'; err.hidden = false; return; }
    save.disabled = true;
    const q = id ? sb.from('events').update(row).eq('id', id).select().single() : sb.from('events').insert(row).select().single();
    const { data, error } = await q;
    save.disabled = false;
    if (error) {
      err.textContent = error.code === '23505' ? 'Já existe um evento com esse endereço (slug).' : error.message;
      err.hidden = false; return;
    }
    toast('Evento salvo');
    location.hash = `#/eventos/${data.id}`;
  });

  const out = [el('div', { class: 'page-head' }, el('div', {}, el('p', { class: 'eyebrow' }, id ? 'Editar evento' : 'Novo evento'), el('h1', {}, id ? ev.name : 'Criar evento'))), form];
  if (id) out.push(dangerZone(ev));
  return out;
}

function dangerZone(ev) {
  const btn = el('button', { class: 'btn btn-danger', html: ICONS.trash + ' Excluir evento e todas as fotos' });
  btn.addEventListener('click', async () => {
    const { count: sold } = await sb.from('order_items').select('id', { count: 'exact', head: true }).eq('event_id', ev.id);
    const warn = sold ? `\n\nATENÇÃO: ${sold} foto(s) deste evento já foram vendidas. Os clientes perderão o acesso ao download.` : '';
    const typed = prompt(`Para excluir definitivamente, digite o nome do evento:\n${ev.name}${warn}`);
    if (typed == null) return;
    if (typed.trim() !== ev.name.trim()) { toast('Nome não confere. Nada foi excluído.'); return; }
    btn.disabled = true; btn.textContent = 'Excluindo arquivos…';
    try {
      await deletePhotoFiles(ev.id);
      const { error } = await sb.from('events').delete().eq('id', ev.id);
      if (error) throw error;
      toast('Evento excluído');
      location.hash = '#/eventos';
    } catch (e) {
      toast('Erro ao excluir: ' + e.message, 5000);
      btn.disabled = false;
    }
  });
  return el('div', { class: 'card stack danger-zone' }, el('h3', {}, 'Zona de perigo'),
    el('p', { class: 'muted', style: { margin: 0 } }, 'Exclui o evento, as prévias, os arquivos originais e os dados faciais. Não pode ser desfeito.'), el('div', {}, btn));
}

async function removeObjects(paths) {
  const byBucket = { originals: [], previews: [] };
  paths.forEach(([b, p]) => p && byBucket[b].push(p));
  for (const [bucket, list] of Object.entries(byBucket)) {
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await sb.storage.from(bucket).remove(list.slice(i, i + 100));
      if (error) throw error;
    }
  }
}

async function deletePhotoFiles(eventId, ids) {
  for (let from = 0; ; from += 1000) {
    let q = sb.from('photos').select('id,original_path,preview_path,thumb_path').eq('event_id', eventId).range(from, from + 999);
    if (ids) q = q.in('id', ids);
    const { data, error } = await q;
    if (error) throw error;
    await removeObjects(data.flatMap((p) => [['originals', p.original_path], ['previews', p.preview_path], ['previews', p.thumb_path]]));
    if (data.length < 1000) break;
  }
}

// ---------------------------------------------------------------- detalhe do evento
export async function viewEvent(id) {
  const { data: ev, error } = await sb.from('events').select('*').eq('id', id).single();
  if (error) throw error;
  const s = await loadSettings();
  const total = await countPhotos(id);
  const indexed = await countPhotos(id, (q) => q.eq('faces_indexed', true));
  const { count: faceRows } = await sb.from('photo_faces').select('id', { count: 'exact', head: true }).eq('event_id', id);

  const pubBtn = el('button', { class: 'btn ' + (ev.published ? '' : 'btn-primary') }, ev.published ? 'Despublicar galeria' : 'Publicar galeria');
  pubBtn.addEventListener('click', async () => {
    const { error: e } = await sb.from('events').update({ published: !ev.published }).eq('id', id);
    if (e) return toast(e.message);
    toast(ev.published ? 'Galeria despublicada' : 'Galeria publicada');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('p', { class: 'eyebrow' }, (ev.category || '').toUpperCase()),
      el('h1', {}, ev.name),
      el('div', { class: 'row muted', style: { marginTop: '8px', fontSize: '14px', gap: '6px 16px' } },
        el('span', { class: 'tag ' + (ev.published ? 'on' : 'off') }, ev.published ? 'Publicado' : 'Rascunho'),
        ev.event_date ? el('span', {}, dateBR(ev.event_date)) : null,
        ev.location ? el('span', {}, ev.location) : null,
        el('span', {}, money(ev.price_cents) + ' por foto'),
        el('span', {}, plural(total, 'foto', 'fotos')))),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: `#/eventos/${id}/editar` }, 'Editar'),
      ev.published ? el('a', { class: 'btn', href: `./#/e/${ev.slug}`, target: '_blank' }, 'Ver no site') : null,
      pubBtn));

  const uploader = uploadPanel(ev, s);
  const faces = facesPanel(ev, total, indexed, faceRows || 0);
  const gallery = await photosPanel(ev);
  return [head, uploader, gallery, faces];
}

// ---------------------------------------------------------------- envio em lote
function uploadPanel(ev, settings) {
  const input = el('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const indexFaces = el('input', { type: 'checkbox', checked: ev.face_search });
  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Selecionar fotos para enviar', html: ICONS.download.replace('M12 4v11m0 0l-4-4m4 4l4-4', 'M12 20V9m0 0l-4 4m4-4l4 4') },
    el('b', {}, 'Arraste as fotografias aqui ou clique para selecionar'),
    el('span', { class: 'muted', style: { fontSize: '14px' } }, 'JPG, PNG ou WebP. Envie centenas ou milhares de uma vez; fotos já enviadas (mesmo nome de arquivo) são puladas.'));
  const stats = el('div', { class: 'up-stats' });
  const bar = el('i');
  const log = el('div', { class: 'up-log', hidden: true });
  const stop = el('button', { class: 'btn btn-sm btn-danger', hidden: true }, 'Parar envio');
  let cancel = false;

  drop.addEventListener('click', () => !uploading && input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !uploading && input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (!uploading) run([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; run(files); });
  stop.addEventListener('click', () => { cancel = true; stop.disabled = true; stop.textContent = 'Parando…'; });

  const addLog = (t) => { log.hidden = false; log.append(el('div', {}, t)); log.scrollTop = log.scrollHeight; };

  async function existingNames() {
    const names = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('photos').select('original_name').eq('event_id', ev.id).range(from, from + 999);
      if (error) throw error;
      data.forEach((r) => names.add(r.original_name));
      if (data.length < 1000) break;
    }
    return names;
  }

  async function run(files) {
    files = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (!files.length) return toast('Nenhuma imagem JPG, PNG ou WebP selecionada.');
    uploading = true; cancel = false;
    stop.hidden = false; stop.disabled = false; stop.textContent = 'Parar envio';
    drop.style.pointerEvents = 'none'; drop.style.opacity = '.5';
    log.replaceChildren();
    const st = { total: files.length, done: 0, ok: 0, skip: 0, fail: 0, faces: 0, start: Date.now() };
    const draw = () => {
      const pct = st.total ? (st.done / st.total) * 100 : 0;
      bar.style.width = pct.toFixed(1) + '%';
      const el2 = (Date.now() - st.start) / 1000;
      const eta = st.done ? Math.round((el2 / st.done) * (st.total - st.done)) : 0;
      stats.replaceChildren(
        el('span', {}, el('b', {}, `${st.done}/${st.total}`), ' processadas'),
        el('span', {}, el('b', {}, st.ok), ' enviadas'),
        el('span', {}, el('b', {}, st.skip), ' já existiam'),
        el('span', {}, el('b', {}, st.fail), ' com erro'),
        indexFaces.checked ? el('span', {}, el('b', {}, st.faces), ' rostos indexados') : null,
        st.done < st.total ? el('span', {}, 'restam ~', el('b', {}, eta > 90 ? Math.round(eta / 60) + ' min' : eta + ' s')) : null);
    };
    draw();
    let names;
    try {
      names = await existingNames();
      if (indexFaces.checked) { addLog('Carregando reconhecimento facial…'); await loadFaceApi('ssd'); }
    } catch (e) {
      addLog('Erro: ' + e.message); uploading = false; return;
    }
    let coverSet = Boolean(ev.cover_path);
    const queue = files.slice();
    async function worker() {
      while (queue.length && !cancel) {
        const file = queue.shift();
        if (names.has(file.name)) { st.skip++; st.done++; draw(); continue; }
        names.add(file.name);
        try {
          const r = await uploadOne(ev, file, settings, indexFaces.checked);
          st.ok++; st.faces += r.faces;
          if (!coverSet) {
            coverSet = true;
            await sb.from('events').update({ cover_path: r.preview_path }).eq('id', ev.id);
            ev.cover_path = r.preview_path;
          }
        } catch (e) {
          st.fail++; names.delete(file.name);
          addLog(`${file.name}: ${e.message || e}`);
        }
        st.done++; draw();
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    uploading = false;
    stop.hidden = true;
    drop.style.pointerEvents = ''; drop.style.opacity = '';
    addLog(cancel ? 'Envio interrompido.' : 'Envio concluído.');
    toast(`${st.ok} fotos enviadas${st.fail ? `, ${st.fail} com erro` : ''}`, 4000);
    window.dispatchEvent(new CustomEvent('photos:refresh'));
  }

  return el('div', { class: 'card stack' },
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h3', {}, 'Enviar fotografias'), stop),
    drop, input,
    el('label', { class: 'switch' }, indexFaces, 'Indexar rostos durante o envio (necessário para a busca pelo rosto)'),
    el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } },
      `Marca-d'água aplicada nas prévias: "${settings.watermark_text || 'VETOR DIGITAL'}" (altere em Configurações). O original vai para o armazenamento privado sem alteração. Mantenha esta aba aberta durante o envio.`),
    el('div', { class: 'progress' }, bar), stats, log);
}

async function uploadOne(ev, file, settings, withFaces) {
  const v = await buildVariants(file, settings.watermark_text);
  const id = crypto.randomUUID();
  const ext = (file.name.match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg').toLowerCase();
  const code = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || id.slice(0, 8);
  const paths = {
    original_path: `${ev.id}/${id}.${ext}`,
    preview_path: `${ev.id}/${id}.jpg`,
    thumb_path: `${ev.id}/t/${id}.jpg`
  };
  let faces = [];
  if (withFaces) {
    try { faces = await photoFaces(v.detect); } catch (e) { console.warn('rosto', e); }
  }
  const up = async (bucket, path, body, type) => {
    const { error } = await sb.storage.from(bucket).upload(path, body, { contentType: type, upsert: false, cacheControl: bucket === 'previews' ? '31536000' : '3600' });
    if (error) throw new Error(`upload ${bucket}: ${error.message}`);
  };
  try {
    await up('originals', paths.original_path, file, file.type);
    await up('previews', paths.preview_path, v.preview, 'image/jpeg');
    await up('previews', paths.thumb_path, v.thumb, 'image/jpeg');
    const { error } = await sb.from('photos').insert({
      id, event_id: ev.id, code, original_name: file.name, ...paths,
      width: v.width, height: v.height, bytes: file.size, published: true,
      faces_indexed: withFaces, face_count: faces.length
    });
    if (error) throw new Error(error.code === '23505' ? 'já enviada' : error.message);
  } catch (e) {
    await removeObjects([['originals', paths.original_path], ['previews', paths.preview_path], ['previews', paths.thumb_path]]).catch(() => {});
    throw e;
  }
  if (faces.length) {
    const { error } = await sb.from('photo_faces').insert(faces.map((f) => ({ photo_id: id, event_id: ev.id, embedding: vectorLiteral(f.descriptor), box: f.box })));
    if (error) {
      await sb.from('photos').update({ faces_indexed: false, face_count: 0 }).eq('id', id);
      throw new Error('foto enviada, mas falhou ao salvar rostos: ' + error.message);
    }
  }
  return { faces: faces.length, preview_path: paths.preview_path };
}


// ---------------------------------------------------------------- download dos originais (somente administradores)
export async function downloadOriginal(photo) {
  if (!photo.original_path) throw new Error('Foto sem arquivo original registrado');
  const ext = (photo.original_path.split('.').pop() || 'jpg').toLowerCase();
  const fname = photo.original_name || `${photo.code}.${ext}`;
  const { data, error } = await sb.storage.from('originals').createSignedUrl(photo.original_path, 300, { download: fname });
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Não foi possível gerar o link do original');
  if (data.signedUrl.startsWith('/api/file')) return saveSigned(data.signedUrl, fname);
  const a = document.createElement('a');
  a.href = data.signedUrl; a.rel = 'noopener'; a.download = fname;
  document.body.append(a); a.click(); a.remove();
}

export async function downloadMany(list) {
  if (list.length > 15 && !confirm(`Serão ${list.length} downloads seguidos. O navegador pode pedir permissão para baixar vários arquivos. Continuar?`)) return;
  let ok = 0;
  for (const ph of list) {
    try { await downloadOriginal(ph); ok++; } catch (e) { toast(`Foto ${ph.code}: ${e.message}`, 5000); }
    await new Promise((r) => setTimeout(r, 800));
  }
  toast(`${ok} de ${list.length} download(s) iniciado(s)`);
}

// Entrega: cola a mensagem do WhatsApp (ou os códigos) e baixa os originais depois de conferir o Pix.
export async function viewDelivery() {
  const box = el('textarea', { class: 'input', rows: 8, placeholder: 'Cole aqui a mensagem do pedido recebida no WhatsApp (ou digite os códigos das fotos, um por linha).' });
  const out = el('div', { class: 'stack' });
  const btn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Localizar fotos');

  btn.addEventListener('click', async () => {
    const text = box.value;
    const found = [];
    const seen = new Set();
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/#\s*([A-Za-z0-9_-]+)(?:\s*[—–-]\s*(.+?)(?:\s*[—–-]\s*R\$.*)?)?\s*$/);
      if (!m) continue;
      const key = m[1] + '|' + (m[2] || '');
      if (!seen.has(key)) { seen.add(key); found.push({ code: m[1], event: (m[2] || '').trim() }); }
    }
    if (!found.length) { out.replaceChildren(el('div', { class: 'alert warn' }, 'Nenhum código de foto encontrado. Os códigos aparecem como #CÓDIGO na mensagem.')); return; }
    btn.disabled = true; out.replaceChildren(el('span', { class: 'spinner' }));
    try {
      const codes = [...new Set(found.map((f) => f.code))];
      const { data, error } = await sb.from('photos').select('id,code,thumb_path,original_path,original_name,event_id,events(name)').in('code', codes).limit(500);
      if (error) throw error;
      const norm = (x) => String(x || '').trim().toLowerCase();
      const matched = []; const missing = [];
      found.forEach((f) => {
        let hits = data.filter((p) => p.code === f.code);
        if (f.event) { const byEv = hits.filter((p) => norm(p.events?.name) === norm(f.event)); if (byEv.length) hits = byEv; }
        if (!hits.length) missing.push(f); else matched.push(...hits.slice(0, f.event ? 1 : hits.length));
      });
      const uniq = [...new Map(matched.map((p) => [p.id, p])).values()];
      const ambiguous = found.some((f) => !f.event && data.filter((p) => p.code === f.code).length > 1);
      const all = el('button', { class: 'btn btn-primary', onclick: () => downloadMany(uniq) }, `Baixar todas (${uniq.length})`);
      out.replaceChildren(
        el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('b', {}, `${uniq.length} foto(s) localizada(s)`), uniq.length ? all : null),
        ambiguous ? el('div', { class: 'alert warn' }, 'Alguns códigos existem em mais de um evento. Confira o evento de cada foto antes de enviar.') : null,
        missing.length ? el('div', { class: 'alert err' }, 'Não encontradas: ' + missing.map((m) => '#' + m.code + (m.event ? ' (' + m.event + ')' : '')).join(', ')) : null,
        el('div', { class: 'agrid' }, uniq.map((p) => el('div', { class: 'athumb' },
          el('img', { src: publicUrl(p.thumb_path), alt: p.code }),
          el('div', { class: 'cap' }, el('span', { class: 'mono' }, p.code), el('span', { class: 'muted', style: { fontSize: '11px' } }, p.events?.name || '')),
          el('button', { class: 'btn btn-sm', style: { margin: '6px' }, onclick: () => downloadOriginal(p).catch((e) => toast(e.message, 5000)) }, 'Baixar original')))));
    } catch (e) {
      out.replaceChildren(el('div', { class: 'alert err' }, 'Erro: ' + e.message));
    } finally { btn.disabled = false; }
  });

  return [
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h1', { style: { fontSize: '34px' } }, 'Entrega de fotos')),
    el('div', { class: 'alert warn' }, 'Só baixe e envie os originais depois de confirmar o pagamento no seu banco/Pix.'),
    el('div', { class: 'card stack' }, box, el('div', {}, btn), out)
  ];
}

// ---------------------------------------------------------------- organização das fotos
async function photosPanel(ev) {
  const grid = el('div', { class: 'agrid' });
  const info = el('span', { class: 'muted', style: { fontSize: '14px' } });
  const pager = el('div', { class: 'row', style: { justifyContent: 'center' } });
  const selected = new Set();
  let filter = 'all';
  let page = 0;
  let rows = [];
  const selbar = el('div', { class: 'selbar', hidden: true });

  const filters = [['all', 'Todas'], ['pub', 'Publicadas'], ['hidden', 'Ocultas'], ['noface', 'Sem rosto indexado']];
  const tabs = el('div', { class: 'tabs-row' }, filters.map(([k, t]) => {
    const b = el('button', { 'aria-pressed': String(k === filter) }, t);
    b.addEventListener('click', () => { filter = k; page = 0; tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
    return b;
  }));

  function query(head) {
    let q = sb.from('photos').select(head ? 'id' : 'id,code,thumb_path,preview_path,published,price_cents,face_count,faces_indexed,original_path,original_name', head ? { count: 'exact', head: true } : undefined).eq('event_id', ev.id);
    if (filter === 'pub') q = q.eq('published', true);
    if (filter === 'hidden') q = q.eq('published', false);
    if (filter === 'noface') q = q.eq('faces_indexed', false);
    return q;
  }

  function drawSelbar() {
    selbar.hidden = !selected.size;
    if (!selected.size) return;
    const act = (label, fn, cls = 'btn btn-sm') => el('button', { class: cls, onclick: fn }, label);
    selbar.replaceChildren(
      el('b', {}, `${selected.size} selecionada(s)`),
      act('Selecionar página', () => { rows.forEach((r) => selected.add(r.id)); draw(); }),
      act('Limpar', () => { selected.clear(); draw(); }),
      act('Baixar original', () => downloadMany(rows.filter((r) => selected.has(r.id)))),
      act('Publicar', () => bulk({ published: true })),
      act('Ocultar', () => bulk({ published: false })),
      act('Definir preço', async () => {
        const v = prompt('Preço destas fotos em R$ (deixe vazio para usar o preço do evento):', '');
        if (v == null) return;
        if (!v.trim()) return bulk({ price_cents: null });
        const c = centsFromInput(v);
        if (!Number.isFinite(c) || c < 100) return toast('Preço mínimo R$ 1,00');
        bulk({ price_cents: c });
      }),
      selected.size === 1 ? act('Usar como capa', async () => {
        const r = rows.find((x) => selected.has(x.id));
        await sb.from('events').update({ cover_path: r.preview_path }).eq('id', ev.id);
        toast('Capa atualizada');
      }) : null,
      act('Excluir', async () => {
        if (!confirm(`Excluir ${selected.size} foto(s) definitivamente, incluindo os originais?`)) return;
        try {
          const ids = [...selected];
          await deletePhotoFiles(ev.id, ids);
          for (let i = 0; i < ids.length; i += 100) {
            const { error } = await sb.from('photos').delete().in('id', ids.slice(i, i + 100));
            if (error) throw error;
          }
          selected.clear(); toast('Fotos excluídas'); load();
        } catch (e) { toast('Erro: ' + e.message, 5000); }
      }, 'btn btn-sm btn-danger'));
  }

  async function bulk(patch) {
    const ids = [...selected];
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await sb.from('photos').update(patch).in('id', ids.slice(i, i + 100));
      if (error) return toast('Erro: ' + error.message, 5000);
    }
    toast('Fotos atualizadas'); load();
  }

  function draw() {
    grid.replaceChildren(...rows.map((p) => {
      const card = el('div', { class: 'athumb' + (selected.has(p.id) ? ' sel' : '') + (p.published ? '' : ' hidden-photo') },
        el('img', { src: publicUrl(p.thumb_path), alt: p.code, loading: 'lazy' }),
        el('span', { class: 'box', html: ICONS.check }),
        el('div', { class: 'flags' },
          !p.published ? el('span', {}, 'oculta') : null,
          p.faces_indexed ? el('span', { title: 'Rostos indexados' }, `☺ ${p.face_count}`) : null,
          p.price_cents ? el('span', { class: 'accent' }, money(p.price_cents)) : null),
        el('div', { class: 'cap' }, el('span', { class: 'mono' }, p.code)));
      card.addEventListener('click', () => { selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id); card.classList.toggle('sel'); drawSelbar(); });
      return card;
    }));
    drawSelbar();
  }

  async function load() {
    const { count } = await query(true);
    const total = count || 0;
    const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE));
    page = Math.min(page, pages - 1);
    const { data, error } = await query(false).order('code').range(page * ADMIN_PAGE, page * ADMIN_PAGE + ADMIN_PAGE - 1);
    if (error) return toast(error.message);
    rows = data;
    info.textContent = `${total.toLocaleString('pt-BR')} foto(s) · página ${page + 1} de ${pages}`;
    pager.replaceChildren(
      el('button', { class: 'btn btn-sm', disabled: page === 0, onclick: () => { page--; load(); } }, '← Anterior'),
      el('button', { class: 'btn btn-sm', disabled: page >= pages - 1, onclick: () => { page++; load(); } }, 'Próxima →'));
    draw();
  }
  if (window.__vdRefresh) window.removeEventListener('photos:refresh', window.__vdRefresh);
  window.__vdRefresh = load;
  window.addEventListener('photos:refresh', load);
  await load();

  return el('div', { class: 'card stack' },
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h3', {}, 'Fotografias do evento'), info),
    tabs,
    el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Clique nas fotos para selecionar e use a barra de ações para publicar, ocultar, definir preço, escolher a capa ou excluir.'),
    grid, pager, selbar);
}

// ---------------------------------------------------------------- dados faciais (LGPD)
function facesPanel(ev, total, indexed, faceRows) {
  const msg = el('div', { class: 'up-stats' },
    el('span', {}, el('b', {}, indexed.toLocaleString('pt-BR')), ` de ${total.toLocaleString('pt-BR')} fotos indexadas`),
    el('span', {}, el('b', {}, faceRows.toLocaleString('pt-BR')), ' rostos armazenados'),
    el('span', {}, 'Exclusão automática em ', el('b', {}, ev.faces_purge_at ? dateBR(ev.faces_purge_at) : '—')));
  const bar = el('i');
  const log = el('div', { class: 'muted', style: { fontSize: '13px' } });
  const reindex = el('button', { class: 'btn btn-sm' }, 'Indexar fotos pendentes');
  const purge = el('button', { class: 'btn btn-sm btn-danger' }, 'Apagar dados faciais agora');

  purge.addEventListener('click', async () => {
    if (!confirm('Apagar todos os dados faciais deste evento? A busca pelo rosto deixa de funcionar até reindexar.')) return;
    const { data, error } = await sb.rpc('purge_event_faces', { p_event: ev.id });
    if (error) return toast(error.message);
    toast(`${data} rostos apagados`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  reindex.addEventListener('click', async () => {
    if (uploading) return toast('Aguarde o envio terminar.');
    uploading = true; reindex.disabled = true;
    try {
      await loadFaceApi('ssd');
      let done = 0; let found = 0;
      const pending = await countPhotos(ev.id, (q) => q.eq('faces_indexed', false));
      while (true) {
        const { data, error } = await sb.from('photos').select('id,original_path').eq('event_id', ev.id).eq('faces_indexed', false).limit(30);
        if (error) throw error;
        if (!data.length) break;
        for (const p of data) {
          const { data: blob, error: e1 } = await sb.storage.from('originals').download(p.original_path);
          if (e1) throw new Error(e1.message);
          const canvas = await canvasFromBlob(blob, 1920);
          const faces = await photoFaces(canvas);
          await sb.from('photo_faces').delete().eq('photo_id', p.id);
          if (faces.length) {
            const { error: e2 } = await sb.from('photo_faces').insert(faces.map((f) => ({ photo_id: p.id, event_id: ev.id, embedding: vectorLiteral(f.descriptor), box: f.box })));
            if (e2) throw e2;
          }
          const { error: e3 } = await sb.from('photos').update({ faces_indexed: true, face_count: faces.length }).eq('id', p.id);
          if (e3) throw e3;
          done++; found += faces.length;
          bar.style.width = ((done / Math.max(1, pending)) * 100).toFixed(1) + '%';
          log.textContent = `${done} de ${pending} fotos · ${found} rostos`;
        }
      }
      toast('Indexação concluída');
    } catch (e) {
      toast('Erro: ' + e.message, 5000);
    }
    uploading = false; reindex.disabled = false;
  });

  return el('div', { class: 'card stack' },
    el('h3', {}, 'Busca pelo rosto e dados faciais (LGPD)'),
    msg,
    el('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Os vetores faciais ficam em área restrita do banco, nunca aparecem no site e são apagados automaticamente na data acima (prazo definido em Configurações). As selfies dos atletas não são armazenadas.'),
    el('div', { class: 'progress' }, bar), log,
    el('div', { class: 'row' }, reindex, purge));
}
