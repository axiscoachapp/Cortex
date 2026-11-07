import test from 'node:test';
import assert from 'node:assert/strict';
import {createWhatsAppReadFixture,whatsappReadIds} from './whatsapp-read-api.mjs';
import {ids,startReceptionFixture} from './reception-api.mjs';
const command={action:'act',operation:'assign',conversationId:whatsappReadIds.second,revision:1};
test('claim fixture is opt-in and refuses target/actor injection',async()=>{
  await assert.rejects(startReceptionFixture({whatsappClaimReview:true}),/claim requires/);
  const read=createWhatsAppReadFixture(ids);assert.equal(read.handle(ids.a,command).status,400);assert.throws(()=>read.resetClaims());
  const claim=createWhatsAppReadFixture(ids,{claimReview:true}),original=claim.snapshotRows();
  for(const extra of [{targetUserId:ids.b},{actorId:ids.admin},{clinicId:ids.clinic},{operation:'close'}])assert.equal(claim.handle(ids.a,{...command,...extra}).status,400);
  assert.deepEqual(claim.snapshotRows(),original);assert.equal(claim.claimCalls.length,0);
});
test('claim fixture models CAS, unconfirmed reply and competitor changes without external operations',()=>{
  const fixture=createWhatsAppReadFixture(ids,{claimReview:true});
  const receipt=fixture.handle(ids.a,command);assert.equal(receipt.status,200);assert.deepEqual(receipt.data,{revision:2,status:'open',assignedTo:ids.a});assert.equal(fixture.handle(ids.b,command).status,409);
  fixture.resetClaims();const before=fixture.claimCalls.length;fixture.setClaimMode('unconfirmed');assert.equal(fixture.handle(ids.a,command).data.unexpected,true);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.a);assert.equal(fixture.claimCalls.slice(before).filter(c=>c.applied).length,1);
  fixture.resetClaims();const after=fixture.claimCalls.length;fixture.setClaimMode('stale');assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.b);assert.equal(fixture.claimCalls.slice(after).filter(c=>c.applied).length,0);
});
