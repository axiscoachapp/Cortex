/** Restore a same-origin destination without allowing a login redirect loop. */
export function authDestination(next: string | null): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\') || [...next].some(char=>char.charCodeAt(0)<32)) return '/';
  const url = new URL(next, 'https://cortex.invalid');
  if (url.origin !== 'https://cortex.invalid' || url.pathname === '/auth') return '/';
  return url.pathname + url.search + url.hash;
}
