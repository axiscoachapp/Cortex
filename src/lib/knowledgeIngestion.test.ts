// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';

const documentId = '82000000-0000-4000-8000-000000000001';
function ingestion(options: { unreviewed?: boolean; malformedEmbedding?: boolean; retiredDuringIndex?: boolean } = {}) {
  let run!: (req: Request) => Promise<Response>;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'begin_knowledge_index') return { data: options.unreviewed ? null : { source_text: 'Original approved protocol only.', index_revision: 3 }, error: options.unreviewed ? { code: '42501' } : null };
    return { data: true, error: options.retiredDuringIndex && args.p_failed === false ? { code: '42501' } : null };
  });
  const reserve = vi.fn(async () => ({ reservationId: 'reservation' }));
  const settle = vi.fn(async () => {});
  const embed = vi.fn(async () => options.malformedEmbedding ? [[]] : [Array.from({ length: 768 }, () => 0.1)]);
  const modules: Record<string, unknown> = {
    '../_shared/http.ts': http,
    '../_shared/auth.ts': { requireUser: async () => ({ userId: 'owner' }), AuthError: class extends Error {}, authResponse: () => new Response(null, { status: 401 }) },
    '../_shared/quota.ts': { checkQuota: reserve, recordUsage: settle, quotaResponse: () => new Response(null, { status: 429 }), QuotaExceededError: class extends Error {} },
    '../_shared/gemini.ts': { chunkText: (source: string) => [source], embedBatch: embed },
  };
  const source = readFileSync(new URL('../../supabase/functions/ingest-knowledge/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => { run = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => ({ rpc }) };
    if (id in modules) return modules[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic' } });
  return { rpc, reserve, settle, embed, run: (body: Record<string, unknown>) => run(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) })) };
}
describe('reviewed knowledge ingestion', () => {
  it('rejects patient attachments and ad hoc request text before quota or embedding', async () => {
    for (const body of [{ documentId, fileId: 'patient-file' }, { documentId, text: 'patient chart' }]) {
      const handler = ingestion();
      expect((await handler.run(body)).status).toBe(400);
      expect(handler.rpc).not.toHaveBeenCalled(); expect(handler.reserve).not.toHaveBeenCalled(); expect(handler.embed).not.toHaveBeenCalled();
    }
  });
  it('requires approval of the stored source before reserving paid usage', async () => {
    const handler = ingestion({ unreviewed: true });
    expect((await handler.run({ documentId })).status).toBe(403);
    expect(handler.reserve).not.toHaveBeenCalled(); expect(handler.embed).not.toHaveBeenCalled();
  });
  it('indexes only the preserved approved text and commits under the exact lease revision', async () => {
    const handler = ingestion();
    expect((await handler.run({ documentId })).status).toBe(200);
    expect(handler.embed).toHaveBeenCalledWith('synthetic', ['Original approved protocol only.']);
    expect(handler.rpc).toHaveBeenCalledWith('finish_knowledge_index', expect.objectContaining({ p_document_id: documentId, p_index_revision: 3, p_failed: false, p_chunks: [expect.objectContaining({ content: 'Original approved protocol only.' })] }));
  });
  it('does not activate an incomplete embedding and leaves a retryable failed lease', async () => {
    const handler = ingestion({ malformedEmbedding: true });
    expect((await handler.run({ documentId })).status).toBe(503);
    expect(handler.rpc).not.toHaveBeenCalledWith('finish_knowledge_index', expect.objectContaining({ p_failed: false }));
    expect(handler.rpc).toHaveBeenLastCalledWith('finish_knowledge_index', expect.objectContaining({ p_failed: true, p_index_revision: 3 }));
  });
  it('does not restore a source whose approval was withdrawn during indexing', async () => {
    const handler = ingestion({ retiredDuringIndex: true });
    expect((await handler.run({ documentId })).status).toBe(409);
    expect(handler.settle).not.toHaveBeenCalled();
  });
});
