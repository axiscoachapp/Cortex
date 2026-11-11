import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadWhatsAppMedia, mediaFileName, MEDIA_MAX_BYTES, previewKind } from './whatsappMedia';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));
vi.mock('@/integrations/supabase/environment', () => ({ validateSupabaseEnvironment: () => ({ url: 'http://supabase.synthetic.invalid', key: 'synthetic-publishable-key', isolated: true }) }));

const messageId = '44444444-4444-4444-8444-444444444444';
const file = (body: BodyInit, headers: Record<string, string>, status = 200) => new Response(body, { status, headers });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-access-token' } } });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('received WhatsApp media through the media action', () => {
  it('posts only the message id with the session token and returns the bytes with their type', async () => {
    mocks.fetch.mockResolvedValue(file(new Uint8Array([1, 2, 3]), { 'Content-Type': 'image/jpeg' }));
    const result = await downloadWhatsAppMedia(messageId.toUpperCase());
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('http://supabase.synthetic.invalid/functions/v1/whatsapp-api', {
      method: 'POST', signal: undefined,
      headers: { Authorization: 'Bearer synthetic-access-token', apikey: 'synthetic-publishable-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'media', messageId }),
    });
    expect(result.mime).toBe('image/jpeg');
    expect(result.blob.size).toBe(3);
    expect(result.blob.type).toBe('image/jpeg');
  });

  it.each(['not-a-uuid', ''])('refuses an invalid message id before any request (%j)', async value => {
    await expect(downloadWhatsAppMedia(value)).rejects.toMatchObject({ code: 'invalid' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(downloadWhatsAppMedia(messageId)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'Este arquivo não está mais disponível no WhatsApp.'],
    ['forbidden', 403, 'Você não tem acesso a esta conversa.'],
    ['not_connected', 409, 'O WhatsApp da clínica não está conectado. Avise o administrador da clínica.'],
    ['graph_131052', 502, 'O WhatsApp não entregou o arquivo agora. Tente de novo em instantes.'],
    ['surprise', 500, 'Não foi possível baixar o arquivo. Verifique a conexão e tente de novo.'],
  ])('maps the server code %s without its raw text', async (code, status, text) => {
    mocks.fetch.mockResolvedValue(file(JSON.stringify({ error: 'PRIVATE RAW TEXT', code }), { 'Content-Type': 'application/json' }, status));
    const error = await downloadWhatsAppMedia(messageId).catch(failure => failure);
    expect(error.message).toBe(text);
    expect(error.message).not.toContain('PRIVATE');
  });

  it.each([
    [{ 'Content-Type': 'application/json' }],
    [{ 'Content-Type': 'application/json; charset=utf-8' }],
    [{ 'Content-Type': 'not a type' }],
  ])('refuses an answer that is not a file (%j)', async headers => {
    mocks.fetch.mockResolvedValue(file('{"ok":true}', headers));
    await expect(downloadWhatsAppMedia(messageId)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses an empty or oversized file', async () => {
    mocks.fetch.mockResolvedValue(file(new Uint8Array(), { 'Content-Type': 'application/pdf' }));
    await expect(downloadWhatsAppMedia(messageId)).rejects.toMatchObject({ code: 'not_found' });
    mocks.fetch.mockResolvedValue(file('x', { 'Content-Type': 'application/pdf', 'Content-Length': String(MEDIA_MAX_BYTES + 1) }));
    await expect(downloadWhatsAppMedia(messageId)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('reports a network failure and a cancellation separately', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('PRIVATE NETWORK'));
    await expect(downloadWhatsAppMedia(messageId)).rejects.toMatchObject({ code: 'unavailable' });
    const controller = new AbortController(); controller.abort();
    await expect(downloadWhatsAppMedia(messageId, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('previews only safe image, audio and video types and names downloads safely', () => {
    expect(previewKind('image/jpeg')).toBe('image');
    expect(previewKind('image/svg+xml')).toBeNull();
    expect(previewKind('audio/ogg')).toBe('audio');
    expect(previewKind('application/pdf')).toBeNull();
    expect(mediaFileName('../exame:final.pdf', 'application/pdf', 'document')).toBe('.._exame_final.pdf');
    expect(mediaFileName(null, 'image/jpeg', 'image')).toBe('imagem-whatsapp.jpeg');
  });
});
