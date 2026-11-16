// Armazenamento no próprio Netlify (Netlify Blobs), sem serviço externo.
// Em testes (VD_STORE=memory) usa memória, com a mesma interface.
//   kv('vd-db')     -> registros (JSON)
//   kv('vd-files')  -> arquivos (prévias e originais, em partes de até 4 MB)

const mem = (globalThis.__VD_MEM ||= new Map());

function memoryStore(name) {
  const k = (key) => `${name}:${key}`;
  return {
    async getJSON(key) { const v = mem.get(k(key)); return v === undefined ? null : JSON.parse(v); },
    async setJSON(key, value) { mem.set(k(key), JSON.stringify(value)); },
    async getBytes(key) { const v = mem.get(k(key)); return v === undefined ? null : v; },
    async setBytes(key, buf) { mem.set(k(key), new Uint8Array(buf)); },
    async del(key) { mem.delete(k(key)); },
    async list(prefix) {
      const p = k(prefix);
      return [...mem.keys()].filter((x) => x.startsWith(p)).map((x) => x.slice(name.length + 1)).sort();
    }
  };
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
