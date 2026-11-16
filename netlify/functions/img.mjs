// GET /api/img/<caminho> — prévias com marca-d'água (públicas), com cache longo no Netlify.
import { cleanPath, fileMeta, getPart } from '../lib/files.mjs';

export default async (req) => {
  let path;
  try { path = cleanPath(decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/img\//, ''))); } catch { return new Response('Not found', { status: 404 }); }
  const meta = await fileMeta('previews', path);
  if (!meta) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const chunks = [];
  for (let i = 0; i < meta.parts; i++) chunks.push(await getPart('previews', path, i));
  const body = Buffer.concat(chunks.filter(Boolean).map((c) => Buffer.from(c)));
  return new Response(body, {
    headers: {
      'Content-Type': meta.type || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};

export const config = { path: '/api/img/*' };
