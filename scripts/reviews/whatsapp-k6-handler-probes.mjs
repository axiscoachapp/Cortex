// Frozen C4 handlers, fake dependencies and Request objects; no network calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import ts from 'typescript';

const baseline = process.argv[2];
assert.equal(process.argv.length, 3); assert.match(baseline ?? '', /^[0-9a-f]{40}$/);
const sources = [];
const read = path => {
  const text = execFileSync('git', ['show', baseline + ':' + path], { encoding: 'utf8', windowsHide: true });
  sources.push({ path, sha256: createHash('sha256').update(text).digest('hex') }); return text;
};
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const pure = moduleUrl(read('supabase/functions/_shared/whatsapp.ts'));
const psc = moduleUrl(read('supabase/functions/_shared/psc.ts'));
const handlers = read('supabase/functions/_shared/whatsappHandlers.ts').replaceAll("'./psc.ts'", JSON.stringify(psc)).replaceAll("'./whatsapp.ts'", JSON.stringify(pure));
const { apiHandler, webhookHandler } = await import(moduleUrl(handlers)), { parseWebhook } = await import(pure);
const id = '55555555-5555-4555-8555-555555555555';
let seen;
const deps = { corsHeaders: {}, config: { appSecret: 'SYNTHETIC-SECRET', verifyToken: 'SYNTHETIC', keys: null, webhookUrl: 'SYNTHETIC' }, authorize: async () => ({ userId: id, clinicId: '11111111-1111-4111-8111-111111111111', admin: true, reception: false }), authFailure: () => null, store: { conversations: async query => { seen = query.before; return []; } }, rpc: async () => null, graph: {} };
const before = '2026-11-06T12:00:00.123456+00:00|' + id;
const response = await apiHandler(new Request('https://example.invalid/api', { method: 'POST', body: JSON.stringify({ action: 'conversations', before }) }), deps);
assert.equal(response.status, 200); assert.ok(seen?.at, 'Cursor transport fixture failed');
const cursor = { input: before, storeBefore: seen, precisionPreserved: seen.at === before.split('|')[0] };
const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '200000000001' }, messages: [
  { from: '5541999990000', id: 'wamid.MALFORMED_SYNTHETIC', type: 'location', location: { latitude: { toString: 0 }, longitude: 0 } },
  { from: '5541999990000', id: 'wamid.VALID_SYNTHETIC', type: 'text', text: { body: 'Synthetic sibling' } },
] } }] }] };
const control = structuredClone(payload); control.entry[0].changes[0].value.messages[0].location.latitude = 1;
const parsedControl = parseWebhook(control);
assert.ok(Object.values(parsedControl).some(value => Array.isArray(value) && value.length === 2), 'Valid sibling control missing');
let parseError = null;
try { parseWebhook(payload); } catch (error) { parseError = { name: error.name, message: error.message }; }
const calls = [];
deps.rpc = async (name, args) => { calls.push({ name, error: name === 'whatsapp_finish_event' ? args.p_error : null }); return name === 'whatsapp_record_event' ? { new: true, processed: false } : null; };
const raw = JSON.stringify(payload), key = await crypto.subtle.importKey('raw', new TextEncoder().encode(deps.config.appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))).toString('hex');
const hook = await webhookHandler(new Request('https://example.invalid/hook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + signature }, body: raw }), deps);
const webhook = { status: hook.status, parseError, calls, validSiblingIngested: calls.some(call => call.name === 'whatsapp_ingest_inbound') };
const report = { baseline, syntheticOnly: true, networkUsed: false, sources, cursor, webhook, accepted: cursor.precisionPreserved && webhook.validSiblingIngested };
await writeFile('docs/reviews/2026-11-06/whatsapp-k6/HANDLER_PROBES_' + baseline.slice(0, 7).toUpperCase() + '.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report)); if (!report.accepted) process.exitCode = 1;
