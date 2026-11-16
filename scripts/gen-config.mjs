// Gera galeria-vetor-digital/assets/config.js no deploy, a partir das variáveis de ambiente do Netlify.
// Só vão para o navegador as chaves PÚBLICAS (URL do Supabase e chave anon/publishable).
import { writeFileSync } from 'node:fs';

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const anon = (process.env.SUPABASE_ANON_KEY || '').trim();
const service = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !anon) {
  console.log('[config] Sem Supabase: dados no próprio Netlify (Netlify Blobs).');
}
if (service && service === anon) {
  console.error('[config] ERRO: a chave anon é igual à service role. Corrija as variáveis de ambiente.');
  process.exit(1);
}

const cfg = url && anon ? { backend: 'supabase', supabaseUrl: url, supabaseAnonKey: anon } : { backend: 'netlify' };
writeFileSync('galeria-vetor-digital/assets/config.js', `window.VD_CONFIG = ${JSON.stringify(cfg)};\n`);
console.log('[config] galeria-vetor-digital/assets/config.js gerado');
