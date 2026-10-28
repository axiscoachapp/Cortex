export interface SupabaseEnvironment { url: string; key: string; isolated: boolean }

/** Validate explicit configuration without ever choosing a real backend. */
export function validateSupabaseEnvironment(urlValue: unknown, keyValue: unknown): SupabaseEnvironment {
  if (typeof urlValue !== 'string' || !urlValue.trim() || typeof keyValue !== 'string' || !keyValue.trim()) {
    throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY explicitamente.');
  }
  let url: URL;
  try { url = new URL(urlValue); } catch { throw new Error('VITE_SUPABASE_URL inválida.'); }
  const isolated = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.invalid');
  if ((!isolated && url.protocol !== 'https:') || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('VITE_SUPABASE_URL deve identificar um backend HTTPS válido.');
  }
  const key = keyValue.trim();
  if (key.startsWith('sb_secret_')) throw new Error('Use apenas a chave pública do Supabase no navegador.');
  if (key.split('.').length === 3) {
    let claims: Record<string, unknown>;
    try { claims = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { throw new Error('Chave pública do Supabase inválida.'); }
    if (claims.role !== 'anon') throw new Error('Use apenas a chave pública anônima do Supabase no navegador.');
    if (url.hostname.endsWith('.supabase.co') && claims.ref !== url.hostname.split('.')[0]) throw new Error('A URL e a chave pública pertencem a projetos diferentes.');
  } else if (!isolated && !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) {
    throw new Error('Chave pública do Supabase inválida.');
  }
  return { url: url.origin, key, isolated };
}
