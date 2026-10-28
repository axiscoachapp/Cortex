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
  it('keeps the deadline active while a response body stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const check = expect(fetchWithDeadline('https://local.invalid', {}, 10)).rejects.toThrow('Tempo limite');
    await vi.advanceTimersByTimeAsync(11);
    await check;
    expect(cancel).toHaveBeenCalled();
  });
  it('rejects an oversized streamed response without trusting Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9)); c.close(); } }))));
    await expect(fetchWithDeadline('https://local.invalid', {}, 100, 8)).rejects.toThrow('grande');
  });
  it('honors caller cancellation after headers arrived', async () => {
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream())));
    const pending = fetchWithDeadline('https://local.invalid', { signal: caller.signal });
    const check = expect(pending).rejects.toThrow('cancelled');
    caller.abort(new Error('cancelled'));
    await check;
  });
  it('returns a complete body and releases its timer on success', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'x-result': 'ready' } })));
    const response = await fetchWithDeadline('https://local.invalid', {}, 10);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('x-result')).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });
});
