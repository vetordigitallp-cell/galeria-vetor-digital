// Utilitários HTTP compartilhados pelas funções de servidor.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

export function env(name, required = true) {
  const v = process.env[name];
  if (required && (!v || !String(v).trim())) {
    throw new HttpError(500, `Configuração ausente no servidor: ${name}`);
  }
  return v ? String(v).trim() : v;
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Corpo da requisição inválido.');
  }
}

export function handle(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[erro]', err);
      return json(status, { error: err.message || 'Erro interno', ...(err.extra || {}) });
    }
  };
}

export function siteUrl(req) {
  const fromEnv = process.env.SITE_URL || process.env.URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
