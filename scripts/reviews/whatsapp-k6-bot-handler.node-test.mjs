import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { probeBotHandler } from './whatsapp-k6-bot-handler.mjs';

test('a handler that ignores every message reports all seven scenarios',async()=>{
  const proofs=await probeBotHandler({source:path=>path.endsWith('whatsappHandlers.ts')?'export async function runBot() {}':''});
  assert.equal(proofs.length,7);
  assert.equal(proofs.filter(row=>row.category==='contract_failure').length,5);
  assert.deepEqual(proofs.filter(row=>row.passed).map(row=>row.name),['already_handed_off','quiet_opt_out']);
});

test('a throwing handler records failures without discarding later scenarios',async()=>{
  const proofs=await probeBotHandler({source:path=>path.endsWith('whatsappHandlers.ts')?'export async function runBot() { throw new Error("Synthetic handler regression"); }':''});
  assert.equal(proofs.length,7);
  assert.ok(proofs.every(row=>!row.passed&&row.category==='contract_failure'&&row.error==='Synthetic handler regression'));
});

test('source initialization failure is explicit and distinct from contract failures',async()=>{
  const proofs=await probeBotHandler({source:()=>{throw new Error('Synthetic missing source');}});
  assert.deepEqual(proofs,[{name:'handler_initialization',passed:false,category:'fixture_failure',error:'Synthetic missing source'}]);
});

const frozen=baseline=>path=>execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'}).trim();

test('window-guard contract distinguishes all quiet cases from reachable output steps',async()=>{
  const proofs=await probeBotHandler({expectWindowGuard:true,source:path=>path.endsWith('whatsappHandlers.ts')?'export async function runBot() {}':''});
  assert.equal(proofs.length,10);
  assert.deepEqual(proofs.filter(row=>row.passed).map(row=>row.name),['expired_window','already_handed_off','quiet_opt_out','missing_window','window_exactly_24h']);
  assert.equal(proofs.filter(row=>row.category==='contract_failure').length,5);
});

test('be5b794 satisfies the guarded window contract including the positive boundary control',async()=>{
  const proofs=await probeBotHandler({expectWindowGuard:true,source:frozen('be5b794dcdf6aea51cde7cc896c5a44204e6cfee')});
  assert.equal(proofs.length,10);
  assert.ok(proofs.every(row=>row.passed),JSON.stringify(proofs.filter(row=>!row.passed)));
  assert.equal(proofs.find(row=>row.name==='window_inside_24h').guardCalled,true);
});

test('f837c57 remains reachable under its old contract and fails the three new window guards',async()=>{
  const source=frozen('f837c5769322579c145cb9c6f2588b5d00a77643');
  const legacy=await probeBotHandler({source});
  assert.equal(legacy.length,7);
  assert.ok(legacy.every(row=>row.passed));
  const guarded=await probeBotHandler({expectWindowGuard:true,source});
  assert.equal(guarded.length,10);
  assert.deepEqual(guarded.filter(row=>!row.passed).map(row=>row.name),['expired_window','missing_window','window_exactly_24h']);
});
