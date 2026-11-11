// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callClinicalText, transcribeClinicalAudio } from '../../supabase/functions/_shared/clinicalAi';
import { creditsFromUsage } from '../../supabase/functions/_shared/quota';
import { fetchWithDeadline } from '../../supabase/functions/_shared/http';

const schema = { type: 'object', properties: { note: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }, required: ['note', 'items'] };
const complete = (text = 'Synthetic note', extra = {}) => ({ status: 'completed', model: 'gpt-6.1-terra', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], ...extra });
const env: Record<string, string> = {};
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(env, { AI_ENABLED: 'true', AI_PROVIDER: 'openai' });
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  request = vi.fn().mockImplementation(async () => new Response(JSON.stringify(complete())));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('OpenAI boundary', () => {
  it('blocks a final raw OpenAI Request when inactive and never falls back to Gemini during an OpenAI test', async () => {
    env.AI_PROVIDER = 'disabled';
    await expect(fetchWithDeadline(new Request('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' }))).rejects.toThrow(/IA/);
    env.AI_PROVIDER = 'openai';
    await expect(fetchWithDeadline('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { method: 'POST', body: '{}' })).rejects.toThrow(/legada/);
    await expect(fetchWithDeadline('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', { method: 'POST', body: '{}' })).rejects.toThrow(/legada/);
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a substituted or untrusted model without logging its arbitrary model string', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('Synthetic', { model: 'Private synthetic upstream identifier' }))));
    await expect(callClinicalText('key', [{ text: 'Synthetic' }])).rejects.toThrow(/inválid/);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('Private synthetic');
  });
  it.each(['AI_ENABLED', 'AI_PROVIDER'])('refuses missing %s before any request', async (key) => {
    delete env[key];
    await expect(callClinicalText('synthetic-secret', [{ text: 'Private synthetic text' }])).rejects.toThrow(/IA/);
    await expect(transcribeClinicalAudio('synthetic-secret', new Blob(['audio']), 'audio/webm')).rejects.toThrow(/IA/);
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses a missing key and oversized prompt without any request', async () => {
    await expect(callClinicalText('', [{ text: 'Synthetic' }])).rejects.toThrow();
    await expect(callClinicalText('key', [{ text: 'x'.repeat(128 * 1024 + 1) }])).rejects.toThrow(/grande/);
    expect(request).not.toHaveBeenCalled();
  });
  it('uses exact Terra model, stateless Responses, explicit output bound and no tools or implicit history', async () => {
    const result = await callClinicalText('synthetic-secret', [{ text: 'Private synthetic text' }], { systemInstruction: 'Clinical rules', maxOutputTokens: 600 });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-secret');
    expect(JSON.parse(init.body)).toEqual({ model: 'gpt-6.1-terra', store: false, reasoning: { effort: 'none' }, max_output_tokens: 600, instructions: 'Clinical rules', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Private synthetic text' }] }] });
    expect(result.text).toBe('Synthetic note');
    expect(result.metadata).toMatchObject({ provider: 'openai', requestedModel: 'gpt-6.1-terra', effectiveModel: 'gpt-6.1-terra' });
  });
  it('makes nested JSON strict and still validates the returned shape', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('{"note":"Synthetic","items":[{"name":"item"}]}'))));
    await callClinicalText('key', [{ text: 'Synthetic' }], { responseSchema: schema });
    const format = JSON.parse(request.mock.calls[0][1].body).text.format;
    expect(format).toMatchObject({ type: 'json_schema', strict: true, schema: { additionalProperties: false, properties: { items: { items: { additionalProperties: false } } } } });
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('{"note":5,"items":[]}'))));
    await expect(callClinicalText('key', [{ text: 'Synthetic' }], { responseSchema: schema })).rejects.toThrow(/inválid/);
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('{"note":"ok","items":[],"hidden":"extra"}'))));
    await expect(callClinicalText('key', [{ text: 'Synthetic' }], { responseSchema: schema })).rejects.toThrow(/inválid/);
  });
  it.each([
    { status: 'incomplete' }, { incomplete_details: { reason: 'max_output_tokens' } }, { error: { message: 'Private error' } },
    { output: [] }, { output: [{ type: 'message', status: 'incomplete', content: [{ type: 'output_text', text: 'partial' }] }] },
    { output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: 'Private refusal' }] }] },
    { output: [{ type: 'function_call', name: 'unexpected_tool' }] },
  ])('rejects incomplete/refused/unsupported output without exposing content %#', async (extra) => {
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('Private partial', extra))));
    await expect(callClinicalText('key', [{ text: 'Private input' }])).rejects.toThrow(/inválid|incomplet/);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/Private|synthetic-secret/);
  });
  it('does not retry or fall back on an upstream failure or transport error', async () => {
    request.mockResolvedValueOnce(new Response('Private upstream body', { status: 401 }));
    await expect(callClinicalText('synthetic-secret', [{ text: 'Private input' }])).rejects.toThrow(/IA/);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new Error('Private URL and credential'));
    await expect(callClinicalText('synthetic-secret', [{ text: 'Private input' }])).rejects.toThrow(/Referência/);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/Private|synthetic-secret/);
  });
  it('bounds stalled response bodies and records only metadata', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } })));
    const assertion = expect(callClinicalText('key', [{ text: 'Synthetic' }])).rejects.toThrow(/Referência/);
    await vi.advanceTimersByTimeAsync(90_001);
    await assertion;
  });
  it('sends PDF/image bytes inline using technical names and no remote file URL or upload', async () => {
    await callClinicalText('key', [{ document: { data: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' } }, { document: { data: new Uint8Array([1]), mimeType: 'image/png' } }, { text: 'Synthetic' }]);
    const content = JSON.parse(request.mock.calls[0][1].body).input[0].content;
    expect(content[0]).toMatchObject({ type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,AQID' });
    expect(content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,AQ==' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses multipart gpt-transcribe with a real extension and preserves literal text without inventing labels', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Synthetic speech.', usage: { type: 'duration', seconds: 60 } })));
    const result = await transcribeClinicalAudio('key', new Blob(['voice']), 'audio/webm;codecs=opus');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    const file = form.get('file') as File;
    expect(file.name).toBe('consultation.webm'); expect(file.type).toBe('audio/webm'); expect(await file.text()).toBe('voice');
    expect(form.has('language')).toBe(false);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(result).toMatchObject({ text: 'Synthetic speech.', metadata: { requestedModel: 'gpt-transcribe', effectiveModel: null, diarization: 'unavailable' } });
    expect(creditsFromUsage(result.usage)).toBeCloseTo(4.5);
  });
  it('returns genuine empty speech for manual review and refuses malformed transcription', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ text: '' })));
    expect((await transcribeClinicalAudio('key', new Blob(['voice']), 'audio/webm')).text).toBe('');
    request.mockResolvedValueOnce(new Response(JSON.stringify({ text: 5 })));
    await expect(transcribeClinicalAudio('key', new Blob(['voice']), 'audio/webm')).rejects.toThrow(/inválid/);
  });
  it('validates audio bytes, MIME and limit before network', async () => {
    for (const [blob, mime] of [[new Blob([]), 'audio/webm'], [new Blob(['x']), 'text/plain'], [new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), 'audio/webm']] as const) {
      await expect(transcribeClinicalAudio('key', blob, mime)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('prices OpenAI usage separately, never counts reasoning twice and retains reservation for partial metering', async () => {
    expect(creditsFromUsage({ provider: 'openai', model: 'gpt-6.1-terra', inputTokens: 300_000, outputTokens: 1000 })).toBeCloseTo(607.5);
    request.mockResolvedValueOnce(new Response(JSON.stringify(complete('Synthetic', { usage: { input_tokens: 1000, output_tokens: 200, output_tokens_details: { reasoning_tokens: 50 } } }))));
    const result = await callClinicalText('key', [{ text: 'Synthetic' }]);
    expect(creditsFromUsage(result.usage)).toBeCloseTo(2);
    for (const usage of [undefined, { input_tokens: 1000 }, { input_tokens: -1, output_tokens: 2 }, { input_tokens: '1', output_tokens: 2 }]) {
      request.mockResolvedValueOnce(new Response(JSON.stringify(complete('Synthetic', { usage }))));
      const unknown = await callClinicalText('key', [{ text: 'Synthetic' }]);
      expect(unknown.usage).toBeUndefined(); expect(unknown.metadata.usageStatus).toBe('unavailable');
      expect(creditsFromUsage(unknown.usage)).toBe(0);
    }
  });
});
