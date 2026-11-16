// GET /api/file?t=<link assinado>            -> arquivo inteiro (se couber em uma resposta)
// GET /api/file?t=<link assinado>&info=1     -> { parts, size, type, name }
// GET /api/file?t=<link assinado>&part=N     -> parte N (o navegador junta as partes)
// O link assinado é gerado só para pedidos pagos (ou pelo painel) e expira.
import { json } from '../lib/http.mjs';
import { verify } from '../lib/auth.mjs';
import { fileMeta, getPart } from '../lib/files.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const tok = await verify(url.searchParams.get('t'));
  if (!tok || tok.k !== 'file') return json(403, { error: 'Link expirado ou inválido. Recarregue a página do pedido.' });
  const meta = await fileMeta(tok.b, tok.p);
  if (!meta) return json(404, { error: 'Arquivo não encontrado.' });
  const name = (url.searchParams.get('download') || tok.dl || tok.p.split('/').pop()).replace(/[^\w.\- ]+/g, '_');
  if (url.searchParams.get('info')) return json(200, { parts: meta.parts, size: meta.size, type: meta.type, name });
  const headers = { 'Content-Type': meta.type || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (url.searchParams.has('part')) {
    const i = parseInt(url.searchParams.get('part'), 10);
    if (!(i >= 0 && i < meta.parts)) return json(400, { error: 'Parte inválida.' });
    return new Response(await getPart(tok.b, tok.p, i), { headers });
  }
  if (meta.parts > 1) return json(409, { error: 'Arquivo grande: use o botão de download da página.', parts: meta.parts });
  return new Response(await getPart(tok.b, tok.p, 0), { headers: { ...headers, 'Content-Disposition': `attachment; filename="${name}"` } });
};

export const config = { path: '/api/file' };
