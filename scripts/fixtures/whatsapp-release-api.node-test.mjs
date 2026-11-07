import test from 'node:test';
import assert from 'node:assert/strict';
import {createWhatsAppReadFixture,whatsappReadIds} from './whatsapp-read-api.mjs';
import {ids,startReceptionFixture} from './reception-api.mjs';
async function refused(options){let api;try{await assert.rejects(async()=>{api=await startReceptionFixture(options);},/release requires/);}finally{if(api)await api.close();}}
const command={action:'act',operation:'unassign',conversationId:whatsappReadIds.first,revision:1};
test('release fixture requires isolated opt-in and refuses claim/injected authority',async()=>{
 await refused({whatsappReleaseReview:true});
 await refused({whatsappReadReview:true,whatsappReleaseReview:true,whatsappClaimReview:true});
 assert.throws(()=>createWhatsAppReadFixture(ids,{claimReview:true,releaseReview:true}));
 const read=createWhatsAppReadFixture(ids);assert.equal(read.handle(ids.a,command).status,400);
 const claim=createWhatsAppReadFixture(ids,{claimReview:true});assert.equal(claim.handle(ids.a,command).status,400);
 const fixture=createWhatsAppReadFixture(ids,{releaseReview:true}),original=fixture.snapshotRows();
 for(const extra of [{targetUserId:ids.b},{assignedTo:ids.a},{actorId:ids.admin},{clinicId:ids.clinic},{operation:'assign'},{operation:'close'}])assert.equal(fixture.handle(ids.a,{...command,...extra}).status,400);
 assert.deepEqual(fixture.snapshotRows(),original);assert.equal(fixture.releaseCalls.length,0);
});
test('release fixture only clears owner and increments revision; reset preserves ledger',()=>{
 const fixture=createWhatsAppReadFixture(ids,{releaseReview:true}),before=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(fixture.handle(ids.a,command),{status:200,data:{revision:2,status:'open',assignedTo:null}});const after=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(after,{...before,revision:2,assignedTo:null,assignedAt:null});assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.releaseCalls.filter(row=>row.applied).length,1);
 fixture.resetReleases();assert.deepEqual(fixture.snapshotRows().find(row=>row.id===command.conversationId),before);assert.equal(fixture.releaseCalls.length,2);assert.equal(fixture.claimCalls.length,0);
});
test('release fixture models conflict, forbidden and applied-but-unconfirmed reply',()=>{
 const fixture=createWhatsAppReadFixture(ids,{releaseReview:true});fixture.setReleaseMode('stale');assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.b);assert.equal(fixture.releaseCalls.at(-1).applied,false);
 fixture.resetReleases();const original=fixture.snapshotRows();fixture.setReleaseMode('forbidden');assert.equal(fixture.handle(ids.a,command).status,403);assert.deepEqual(fixture.snapshotRows(),original);
 fixture.resetReleases();fixture.setReleaseMode('unconfirmed');assert.equal(fixture.handle(ids.a,command).data.unexpected,true);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,null);assert.equal(fixture.releaseCalls.at(-1).applied,true);
});
