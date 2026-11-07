import test from 'node:test';
import assert from 'node:assert/strict';
import {createWhatsAppReadFixture,whatsappReadIds} from './whatsapp-read-api.mjs';
import {ids,startReceptionFixture} from './reception-api.mjs';
async function refused(options){let api;try{await assert.rejects(async()=>{api=await startReceptionFixture(options);},/close requires/);}finally{if(api)await api.close();}}
const command={action:'act',operation:'close',conversationId:whatsappReadIds.first,revision:1};
test('close fixture requires isolated opt-in and refuses claim/injected authority',async()=>{
 await refused({whatsappCloseReview:true});
 await refused({whatsappReadReview:true,whatsappCloseReview:true,whatsappClaimReview:true});
 assert.throws(()=>createWhatsAppReadFixture(ids,{claimReview:true,closeReview:true}));
 const read=createWhatsAppReadFixture(ids);assert.equal(read.handle(ids.a,command).status,400);
 const claim=createWhatsAppReadFixture(ids,{claimReview:true});assert.equal(claim.handle(ids.a,command).status,400);
 const fixture=createWhatsAppReadFixture(ids,{closeReview:true}),original=fixture.snapshotRows();
 for(const extra of [{targetUserId:ids.b},{assignedTo:ids.a},{actorId:ids.admin},{clinicId:ids.clinic},{operation:'assign'},{operation:'unassign'}])assert.equal(fixture.handle(ids.a,{...command,...extra}).status,400);
 assert.deepEqual(fixture.snapshotRows(),original);assert.equal(fixture.closeCalls.length,0);
});
test('close fixture preserves owner and links, closes and clears unread count; reset preserves ledger',()=>{
 const fixture=createWhatsAppReadFixture(ids,{closeReview:true}),before=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(fixture.handle(ids.a,command),{status:200,data:{revision:2,status:'closed',assignedTo:ids.a}});const after=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(after,{...before,revision:2,status:'closed',closedAt:before.openedAt,unreadCount:0});assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.closeCalls.filter(row=>row.applied).length,1);
 fixture.resetCloses();assert.deepEqual(fixture.snapshotRows().find(row=>row.id===command.conversationId),before);assert.equal(fixture.closeCalls.length,2);assert.equal(fixture.claimCalls.length,0);
});
test('close fixture models conflict, forbidden and applied-but-unconfirmed reply',()=>{
 const fixture=createWhatsAppReadFixture(ids,{closeReview:true});fixture.setCloseMode('stale');assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.b);assert.equal(fixture.closeCalls.at(-1).applied,false);
 fixture.resetCloses();const original=fixture.snapshotRows();fixture.setCloseMode('forbidden');assert.equal(fixture.handle(ids.a,command).status,403);assert.deepEqual(fixture.snapshotRows(),original);
 fixture.resetCloses();fixture.setCloseMode('unconfirmed');assert.equal(fixture.handle(ids.a,command).data.unexpected,true);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.a);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).status,'closed');assert.equal(fixture.closeCalls.at(-1).applied,true);
});

test('close fixture models the broader producer policy separately from local UI eligibility',()=>{const fixture=createWhatsAppReadFixture(ids,{closeReview:true});const reply=fixture.handle(ids.b,command);assert.equal(reply.status,200);assert.equal(reply.data.assignedTo,ids.a);assert.equal(reply.data.status,'closed');assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).unreadCount,0);});
