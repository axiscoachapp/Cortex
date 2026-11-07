import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppReadFixture } from './whatsapp-read-api.mjs';
import { ids, startReceptionFixture } from './reception-api.mjs';

test('stored template read is exact and leaves conversations untouched', () => {
 const fixture=createWhatsAppReadFixture(ids), before=fixture.snapshotRows(), result=fixture.handle(ids.a,{action:'templates'});
 assert.equal(result.status,200); assert.equal(result.data.templates.length,3);
 assert.deepEqual(fixture.snapshotRows(),before);
 assert.equal(result.data.templates[0].name,result.data.templates[1].name);
 assert.notEqual(result.data.templates[0].language,result.data.templates[1].language);
});
test('templates reject authority, send inputs and unauthorized callers', () => {
 const fixture=createWhatsAppReadFixture(ids);
 for(const extra of [{clinicId:ids.clinic},{conversationId:ids.a},{params:[]},{before:null}]) assert.equal(fixture.handle(ids.a,{action:'templates',...extra}).status,400);
 assert.equal(fixture.handle('anonymous',{action:'templates'}).status,403);
 for(const action of ['syncTemplates','send','mark_read','act'])assert.equal(fixture.handle(ids.a,{action}).status,400);
});
test('template fixture snapshots are isolated and can represent empty results', () => {
 const fixture=createWhatsAppReadFixture(ids), first=fixture.handle(ids.a,{action:'templates'}).data;
 first.templates[0].body='MUTATED SYNTHETIC'; assert.notEqual(fixture.handle(ids.a,{action:'templates'}).data.templates[0].body,first.templates[0].body);
 fixture.setTemplates([]);assert.deepEqual(fixture.handle(ids.a,{action:'templates'}).data,{templates:[]});
});
test('template failure modes are independent of conversation reads', () => {
 const fixture=createWhatsAppReadFixture(ids); fixture.setFailure('templates','forbidden');
 assert.equal(fixture.handle(ids.a,{action:'templates'}).status,403);
 assert.equal(fixture.handle(ids.a,{action:'conversations',filter:'open',search:'',before:null,limit:50}).status,200);
 fixture.setFailure('templates',null);assert.equal(fixture.handle(ids.a,{action:'templates'}).status,200);
});
test('template HTTP read is opt-in and exercises loopback only', async () => {
 for(const enabled of [false,true]){const api=await startReceptionFixture({whatsappReadReview:enabled});try{
 const token='synthetic.'+Buffer.from(JSON.stringify({sub:ids.a})).toString('base64url')+'.synthetic';
 const result=await fetch(api.origin+'/functions/v1/whatsapp-api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'templates'})});assert.equal(result.status,enabled?200:503);
 }finally{await api.close();}}
});
