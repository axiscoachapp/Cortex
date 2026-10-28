// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithDeadline, readJsonObject } from '../../supabase/functions/_shared/http';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('bounded external operations', () => {
  it('rejects an oversized request even with no Content-Length header', async () => {
    const req = new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ text: 'a'.repeat(200) }) });
    await expect(readJsonObject(req, 100)).rejects.toThrow('grande');
  });
  it('rejects a non-object JSON envelope', async () => {
    await expect(readJsonObject(new Request('https://local.invalid', { method:'POST', body:'[]' }))).rejects.toThrow('objeto');
  });
  it('aborts a provider that never responds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const result = fetchWithDeadline('https://local.invalid', {}, 10);
    const check = expect(result).rejects.toThrow('Tempo limite');
    await vi.advanceTimersByTimeAsync(11);
    await check;
  });
});
