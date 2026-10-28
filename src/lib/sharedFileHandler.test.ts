// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as storage from '../../supabase/functions/_shared/storage';

function handler(options: { initiallyDenied?: boolean; revokedDuringDownload?: boolean } = {}) {
  let run!: (req: Request) => Promise<Response>;
  const download = vi.fn(async () => ({ data: new Blob(['synthetic file']), error: null }));
  const rpc = vi.fn(async (_name: string, args: { p_record_access: boolean }) => ({
    data: options.initiallyDenied ? null : { storage_path: 'patients/owner/patient/file.pdf', owner_user_id: 'owner', patient_id: 'patient' },
    error: options.initiallyDenied || (options.revokedDuringDownload && args.p_record_access) ? { code: '42501' } : null,
  }));
  const db = { rpc, storage: { from: () => ({ download }) } };
  const source = readFileSync(new URL('../../supabase/functions/shared-patient-file/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => { run = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id === '../_shared/http.ts') return http;
    if (id === '../_shared/storage.ts') return storage;
    if (id === '../_shared/auth.ts') return { requireUser: async () => ({ userId: 'recipient' }), AuthError: class extends Error {}, authResponse: () => new Response(null, { status: 401 }) };
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic' } });
  return { download, rpc, run: (body = { fileId: '72000000-0000-4000-8000-000000000001' }) => run(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) })) };
}
describe('shared file authenticated delivery', () => {
  it('does not fetch storage before explicit current download authorization', async () => {
    const edge = handler({ initiallyDenied: true });
    expect((await edge.run()).status).toBe(403);
    expect(edge.download).not.toHaveBeenCalled();
  });
  it('suppresses delivery if access is revoked during storage loading', async () => {
    const edge = handler({ revokedDuringDownload: true });
    const response = await edge.run();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('synthetic file');
    expect(edge.rpc).toHaveBeenLastCalledWith('authorize_shared_file', expect.objectContaining({ p_record_access: true }));
  });
  it('delivers an attachment with no-store and without returning storage or signed URLs', async () => {
    const edge = handler();
    const response = await edge.run();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(await response.text()).toBe('synthetic file');
    expect(edge.rpc).toHaveBeenCalledTimes(2);
  });
});
