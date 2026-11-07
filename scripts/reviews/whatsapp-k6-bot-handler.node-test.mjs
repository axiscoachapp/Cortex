import test from 'node:test';
import assert from 'node:assert/strict';
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
