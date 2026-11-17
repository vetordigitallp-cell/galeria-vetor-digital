// Armazenamento de fotos para o painel (somente administradores).
//   POST /api/storage/upload?bucket=&path=&part=&parts=&type=&upsert=  (corpo = bytes da parte)
//   POST /api/storage/remove  { bucket, paths: [] }
//   POST /api/storage/sign    { bucket, path, expiresIn, download }
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { adminFromRequest, fileToken } from '../lib/auth.mjs';
import { BUCKETS, PART_MAX, cleanPath, putPart, removeFile } from '../lib/files.mjs';
import { mapLimit } from '../lib/blobstore.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  if (!(await adminFromRequest(req))) throw new HttpError(401, 'Faça login no painel.');
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop();

  if (action === 'upload') {
    const bucket = url.searchParams.get('bucket');
    if (!BUCKETS.has(bucket)) throw new HttpError(400, 'Bucket inválido.');
    const path = cleanPath(url.searchParams.get('path'));
    const parts = Math.max(1, Math.min(2000, parseInt(url.searchParams.get('parts') || '1', 10)));
    const part = parseInt(url.searchParams.get('part') || '0', 10);
    if (!(part >= 0 && part < parts)) throw new HttpError(400, 'Parte inválida.');
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > PART_MAX) throw new HttpError(400, 'Parte vazia ou grande demais.');
    const type = (url.searchParams.get('type') || '').slice(0, 80);
    if (bucket === 'previews' && !/^image\//.test(type)) throw new HttpError(400, 'A prévia precisa ser uma imagem.');
    await putPart(bucket, path, part, parts, type, bytes, url.searchParams.get('upsert') === '1');
    return json(200, { path, part });
  }
  const b = await readJson(req);
  if (!BUCKETS.has(b.bucket)) throw new HttpError(400, 'Bucket inválido.');
  if (action === 'remove') {
    const paths = (Array.isArray(b.paths) ? b.paths : []).slice(0, 200).map(cleanPath);
    await mapLimit(paths, 12, (p) => removeFile(b.bucket, p));
    return json(200, { data: paths.map((name) => ({ name })) });
  }
  if (action === 'sign') {
    const path = cleanPath(b.path);
    const secs = Math.min(Math.max(parseInt(b.expiresIn, 10) || 300, 30), 7 * 86400);
    const t = await fileToken(b.bucket, path, secs, typeof b.download === 'string' ? b.download.slice(0, 120) : null);
    return json(200, { signedUrl: `/api/file?t=${t}` });
  }
  throw new HttpError(404, 'Ação desconhecida.');
});

export const config = { path: ['/api/storage/upload', '/api/storage/remove', '/api/storage/sign'] };
