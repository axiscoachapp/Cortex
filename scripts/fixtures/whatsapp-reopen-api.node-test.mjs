import test from 'node:test';
import assert from 'node:assert/strict';
import {createWhatsAppReadFixture,whatsappReadIds} from './whatsapp-read-api.mjs';
import {ids,startReceptionFixture} from './reception-api.mjs';
async function refused(options){let api;try{await assert.rejects(async()=>{api=await startReceptionFixture(options);},/reopen requires/);}finally{if(api)await api.close();}}
const command={action:'act',operation:'reopen',conversationId:whatsappReadIds.first,revision:1};
test('reopen fixture requires isolated opt-in and refuses claim/injected authority',async()=>{
 await refused({whatsappReopenReview:true});
 await refused({whatsappReadReview:true,whatsappReopenReview:true,whatsappClaimReview:true});
 assert.throws(()=>createWhatsAppReadFixture(ids,{claimReview:true,reopenReview:true}));
 const read=createWhatsAppReadFixture(ids);assert.equal(read.handle(ids.a,command).status,400);
 const claim=createWhatsAppReadFixture(ids,{claimReview:true});assert.equal(claim.handle(ids.a,command).status,400);
 const fixture=createWhatsAppReadFixture(ids,{reopenReview:true}),original=fixture.snapshotRows();
 for(const extra of [{targetUserId:ids.b},{assignedTo:ids.a},{actorId:ids.admin},{clinicId:ids.clinic},{operation:'assign'},{operation:'close'}])assert.equal(fixture.handle(ids.a,{...command,...extra}).status,400);
 assert.deepEqual(fixture.snapshotRows(),original);assert.equal(fixture.reopenCalls.length,0);
});
test('reopen fixture preserves owner, links and unread count while reopening; reset preserves ledger',()=>{
 const fixture=createWhatsAppReadFixture(ids,{reopenReview:true}),before=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(fixture.handle(ids.a,command),{status:200,data:{revision:2,status:'open',assignedTo:ids.a}});const after=fixture.snapshotRows().find(row=>row.id===command.conversationId);
 assert.deepEqual(after,{...before,revision:2,status:'open',openedAt:'2026-11-07T13:00:00.000000+00:00',firstResponseAt:null,closedAt:null});assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.reopenCalls.filter(row=>row.applied).length,1);
 fixture.resetReopens();assert.deepEqual(fixture.snapshotRows().find(row=>row.id===command.conversationId),before);assert.equal(fixture.reopenCalls.length,2);assert.equal(fixture.claimCalls.length,0);
});
test('reopen fixture models conflict, forbidden and applied-but-unconfirmed reply',()=>{
 const fixture=createWhatsAppReadFixture(ids,{reopenReview:true});fixture.setReopenMode('stale');assert.equal(fixture.handle(ids.a,command).status,409);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.b);assert.equal(fixture.reopenCalls.at(-1).applied,false);
 fixture.resetReopens();const original=fixture.snapshotRows();fixture.setReopenMode('forbidden');assert.equal(fixture.handle(ids.a,command).status,403);assert.deepEqual(fixture.snapshotRows(),original);
 fixture.resetReopens();fixture.setReopenMode('unconfirmed');assert.equal(fixture.handle(ids.a,command).data.unexpected,true);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).assignedTo,ids.a);assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).status,'open');assert.equal(fixture.reopenCalls.at(-1).applied,true);
});

test('reopen fixture models the broader producer policy separately from local UI eligibility',()=>{const fixture=createWhatsAppReadFixture(ids,{reopenReview:true});const reply=fixture.handle(ids.b,command);assert.equal(reply.status,200);assert.equal(reply.data.assignedTo,ids.a);assert.equal(reply.data.status,'open');assert.equal(fixture.snapshotRows().find(row=>row.id===command.conversationId).unreadCount,2);});

test('reopen fixture preserves an explicitly unassigned conversation',()=>{const fixture=createWhatsAppReadFixture(ids,{reopenReview:true});const row=fixture.snapshotRows().find(row=>row.id===whatsappReadIds.second);assert.equal(row.status,'closed');assert.equal(row.assignedTo,null);const result=fixture.handle(ids.a,{...command,conversationId:row.id});assert.deepEqual(result,{status:200,data:{revision:2,status:'open',assignedTo:null}});assert.equal(fixture.snapshotRows().find(r=>r.id===row.id).assignedTo,null);assert.equal(fixture.reopenCalls.length,1);assert.equal(fixture.claimCalls.length,0);});

test('reopen of an already open fixture row preserves revision instead of inventing success',()=>{const fixture=createWhatsAppReadFixture(ids,{reopenReview:true});fixture.handle(ids.a,command);const before=fixture.snapshotRows();assert.deepEqual(fixture.handle(ids.a,{...command,revision:2}),{status:200,data:{revision:2,status:'open',assignedTo:ids.a}});assert.deepEqual(fixture.snapshotRows(),before);assert.equal(fixture.reopenCalls.at(-1).applied,false);});
