// POST /api/auth/login — entrada no painel com ADMIN_EMAIL e ADMIN_PASSWORD.
import { handle, json, readJson, HttpError } from '../lib/http.mjs';
import { login } from '../lib/auth.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido');
  const b = await readJson(req);
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  return json(200, await login(b.email, b.password, ip));
});

export const config = { path: '/api/auth/login' };
