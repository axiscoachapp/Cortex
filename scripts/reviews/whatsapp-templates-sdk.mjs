// Installed SDK and immutable source snapshots; fetch never leaves memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const sources = [];
const digest = text => createHash('sha256').update(text).digest('hex');
function read(path) {
  const source = readFileSync(path, 'utf8');
  sources.push({ path, sha256: digest(source) });
  return source;
}
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');
const row = { name: 'consulta_sintetica', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Texto <b>literal</b> {{1}}.', paramCount: 1 };
const calls = [], unexpected = [], checks = [];
let mode = 'success', lateController;
const memoryFetch = async (resource, init) => {
  const request = new Request(resource, init), url = new URL(request.url);
  if (url.origin !== 'http://127.0.0.1:9999' || url.pathname !== '/functions/v1/whatsapp-api') {
    unexpected.push({ method: request.method, path: url.pathname });
    throw new Error('Unexpected synthetic SDK resource');
  }
  assert.equal(request.method, 'POST');
  const body = await request.json();
  calls.push({ method: request.method, path: url.pathname, body });
  assert.deepEqual(body, { action: 'templates' });
  if (mode === 'lost') throw new TypeError('SYNTHETIC PRIVATE network detail');
  if (mode === 'cancel-after') lateController.abort();
  const status = mode === 'forbidden' ? 403 : mode === 'server_not_ready' ? 503 : 200;
  const data = status !== 200 ? { code: mode, error: 'SYNTHETIC PRIVATE detail' }
    : mode === 'empty' ? { templates: [] }
    : mode === 'duplicate' ? { templates: [row, row] }
    : mode === 'oversized' ? { templates: [{ ...row, body: 'a'.repeat(4097) }] }
    : mode === 'extra' ? { templates: [{ ...row, consented: true }] }
    : { templates: [{ ...row, language: 'en_US', status: '' }, { ...row, status: 'FUTURE_STATUS' }] };
  return new Response(mode === 'truncated' ? '{"templates":[' : JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
};
const client = createClient('http://127.0.0.1:9999', 'synthetic-not-a-key', {
  global: { fetch: memoryFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const slot = '__cortexTemplatesSdk_' + process.pid;
globalThis[slot] = client;
try {
  const clientUrl = moduleUrl('export const supabase=globalThis[' + JSON.stringify(slot) + '];');
  const errorsUrl = moduleUrl(read('src/lib/functionErrors.ts'));
  let source = read('src/features/reception/whatsappTemplates.ts');
  for (const [from, to] of [["'@/integrations/supabase/client'", JSON.stringify(clientUrl)], ["'@/lib/functionErrors'", JSON.stringify(errorsUrl)], ["'zod'", JSON.stringify(import.meta.resolve('zod'))]]) {
    assert.equal(source.split(from).length, 2);
    source = source.replace(from, to);
  }
  const { readWhatsAppTemplates, WhatsAppTemplateReadError } = await import(moduleUrl(source));
  for (const sample of [
    { mode: 'success', code: null }, { mode: 'empty', code: null },
    { mode: 'duplicate', code: 'INVALID_RESPONSE' }, { mode: 'oversized', code: 'INVALID_RESPONSE' },
    { mode: 'extra', code: 'INVALID_RESPONSE' }, { mode: 'truncated', code: 'unavailable' },
    { mode: 'forbidden', code: 'forbidden' }, { mode: 'server_not_ready', code: 'server_not_ready' },
    { mode: 'lost', code: 'unavailable' },
  ]) {
    mode = sample.mode;
    const before = calls.length;
    if (sample.code) {
      const error = await readWhatsAppTemplates().catch(error => error);
      assert.ok(error instanceof WhatsAppTemplateReadError);
      assert.equal(error.code, sample.code);
      assert.ok(!error.message.includes('SYNTHETIC PRIVATE'));
    } else {
      assert.deepEqual(await readWhatsAppTemplates(), mode === 'empty' ? { templates: [] } : {
        templates: [{ ...row, language: 'en_US', status: '' }, { ...row, status: 'FUTURE_STATUS' }],
      });
    }
    assert.equal(calls.length - before, 1);
    checks.push({ case: mode, calls: 1, outcome: sample.code ?? 'catalog' });
  }
  const before = calls.length, pre = new AbortController();
  pre.abort();
  await assert.rejects(readWhatsAppTemplates(pre.signal), error => error.code === 'cancelled');
  assert.equal(calls.length, before);
  checks.push({ case: 'pre-aborted', calls: 0, outcome: 'cancelled' });
  mode = 'cancel-after'; lateController = new AbortController();
  await assert.rejects(readWhatsAppTemplates(lateController.signal), error => error.code === 'cancelled');
  assert.equal(calls.length, before + 1);
  checks.push({ case: mode, calls: 1, outcome: 'cancelled' });
  const sourceHashesStable = sources.every(item => digest(readFileSync(item.path, 'utf8')) === item.sha256);
  assert.equal(sourceHashesStable, true); assert.deepEqual(unexpected, []);
  const report = {
    syntheticOnly: true, nativeNetworkCalls: 0, sdkVersion: JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8')).version,
    checks, calls, unexpected, sources, sourceHashesStable,
    limits: 'Read adapter only. No UI, real Auth, DB, channel completeness, Meta approval or send validation.',
  };
  const output = resolve('docs/reviews/2026-11-07/whatsapp-templates/SDK.json');
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, checks: checks.length, calls: calls.length, sourceHashesStable, unexpected: unexpected.length }) + '\n');
} finally {
  delete globalThis[slot];
}
