// Arquivos (prévias e originais) no Netlify Blobs, em partes de até 4 MB
// (o limite de uma requisição ou resposta de função do Netlify é 6 MB).
import { kv } from './blobstore.mjs';
import { HttpError } from './http.mjs';

export const BUCKETS = new Set(['previews', 'originals']);
export const PART_MAX = 4 * 1024 * 1024 + 1024;

export function cleanPath(p) {
  const s = String(p || '').replace(/^\/+/, '');
  if (!s || s.length > 400 || s.includes('..') || !/^[\w\-./]+$/.test(s)) throw new HttpError(400, 'Caminho de arquivo inválido.');
  return s;
}

export async function fileMeta(bucket, path) {
  return (await kv('vd-files')).getJSON(`m/${bucket}/${path}`);
}

export async function putPart(bucket, path, part, parts, type, bytes, upsert) {
  const store = await kv('vd-files');
  if (part === 0 && !upsert && (await store.getJSON(`m/${bucket}/${path}`))) {
    throw new HttpError(409, 'O arquivo já existe.');
  }
  await store.setBytes(`f/${bucket}/${path}/${part}`, bytes);
  if (part === parts - 1) {
    const have = await store.list(`f/${bucket}/${path}/`);
    if (have.length < parts) throw new HttpError(400, 'Envio incompleto: faltam partes do arquivo.');
    let size = 0;
    for (let i = 0; i < parts; i++) size += (await store.getBytes(`f/${bucket}/${path}/${i}`))?.length || 0;
    await store.setJSON(`m/${bucket}/${path}`, { parts, type: type || 'application/octet-stream', size, at: Date.now() });
  }
}

export async function getPart(bucket, path, part) {
  return (await kv('vd-files')).getBytes(`f/${bucket}/${path}/${part}`);
}

export async function removeFile(bucket, path) {
  const store = await kv('vd-files');
  for (const k of await store.list(`f/${bucket}/${path}/`)) await store.del(k);
  await store.del(`m/${bucket}/${path}`);
}
