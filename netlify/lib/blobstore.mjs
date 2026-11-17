// Armazenamento no próprio Netlify (Netlify Blobs), sem serviço externo.
// Em testes (VD_STORE=memory) usa memória, com a mesma interface.
//   kv('vd-db')     -> registros (JSON)
//   kv('vd-files')  -> arquivos (prévias e originais, em partes de até 4 MB)

const mem = (globalThis.__VD_MEM ||= new Map());
const etags = (globalThis.__VD_ETAG ||= new Map());
let etagSeq = 0;

function memoryStore(name) {
  const k = (key) => `${name}:${key}`;
  // Só para testes de carga: simula a latência do Netlify Blobs (ex.: VD_STORE_LATENCY_MS=40).
  const s = {
    async getJSON(key) { const v = mem.get(k(key)); return v === undefined ? null : JSON.parse(v); },
    async setJSON(key, value) { mem.set(k(key), JSON.stringify(value)); etags.set(k(key), `e${++etagSeq}`); },
    async getBytes(key) { const v = mem.get(k(key)); return v === undefined ? null : v; },
    async setBytes(key, buf) { mem.set(k(key), new Uint8Array(buf)); etags.set(k(key), `e${++etagSeq}`); },
    async del(key) { mem.delete(k(key)); etags.delete(k(key)); },
    async list(prefix) {
      const p = k(prefix);
      return [...mem.keys()].filter((x) => x.startsWith(p)).map((x) => x.slice(name.length + 1)).sort();
    },
    async listMeta(prefix) {
      const p = k(prefix);
      return [...mem.keys()].filter((x) => x.startsWith(p)).sort().map((x) => ({ key: x.slice(name.length + 1), etag: etags.get(x) || '' }));
    }
  };
  if (!process.env.VD_STORE_LATENCY_MS) return s;
  const wait = () => { const lat = Number(process.env.VD_STORE_LATENCY_MS || 0); return lat ? new Promise((r) => setTimeout(r, lat * (0.6 + Math.random() * 0.8))) : null; };
  for (const f of Object.keys(s)) {
    const fn = s[f];
    s[f] = async (...a) => {
      await wait();
      const r = await fn(...a);
      if (Array.isArray(r)) for (let p = 1000; p < r.length; p += 1000) await wait(); // listagem paginada de 1000 em 1000
      return r;
    };
  }
  return s;
}

const cache = new Map();

export async function kv(name) {
  if (process.env.VD_STORE === 'memory') return memoryStore(name);
  if (cache.has(name)) return cache.get(name);
  const { getStore } = await import('@netlify/blobs');
  const s = getStore({ name, consistency: 'strong' });
  const api = {
    async getJSON(key) { return (await s.get(key, { type: 'json' })) ?? null; },
    async setJSON(key, value) { await s.setJSON(key, value); },
    async getBytes(key) { const b = await s.get(key, { type: 'arrayBuffer' }); return b ? new Uint8Array(b) : null; },
    async setBytes(key, buf) { await s.set(key, buf); },
    async del(key) { await s.delete(key); },
    async list(prefix) {
      const out = [];
      for await (const page of s.list({ prefix, paginate: true })) for (const b of page.blobs) out.push(b.key);
      return out.sort();
    },
    // Lista com etag: permite atualizar o retrato de uma tabela buscando só o que mudou.
    async listMeta(prefix) {
      const out = [];
      for await (const page of s.list({ prefix, paginate: true })) for (const b of page.blobs) out.push({ key: b.key, etag: b.etag || '' });
      return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }
  };
  cache.set(name, api);
  return api;
}

export async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  const worker = async () => { while (i < list.length) { const j = i++; out[j] = await fn(list[j], j); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}
