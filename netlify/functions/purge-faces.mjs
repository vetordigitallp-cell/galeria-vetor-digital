// Agendado: apaga diariamente os dados faciais vencidos (LGPD), como o pg_cron fazia.
import { rpc } from '../lib/db.mjs';

export default async () => {
  if ((process.env.SUPABASE_URL || '').trim()) return new Response('supabase');
  const n = await rpc('purge_expired_faces', {}, 'server');
  console.log('[faces] apagados', n);
  return new Response(String(n));
};

export const config = { schedule: '15 9 * * *' };
