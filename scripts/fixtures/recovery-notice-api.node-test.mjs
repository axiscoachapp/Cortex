import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startClinicFixture,uid } from './clinic-review-api.mjs';
import { recoverySelect } from './recovery-notice-api.mjs';

test('recovery notice fixture is opt-in and enforces the actor and metadata projection',async()=>{
  await assert.rejects(startClinicFixture({recoveryNoticeReview:true}),/isolated workspace/);
  const api=await startClinicFixture({workspaceDates:true,recoveryNoticeReview:true});
  const query=new URLSearchParams({select:recoverySelect,user_id:'eq.'+uid,discard_requested_at:'is.null',status:'in.(processing,review,error)',order:'updated_at.desc,id.asc',limit:'51'});
  try{
    const read=()=>fetch(api.origin+'/rest/v1/consultation_drafts?'+query);
    const reply=await read();assert.equal(reply.status,200);
    const rows=await reply.json();assert.equal(rows.length,3);
    assert.deepEqual(Object.keys(rows[0]).sort(),['id','patient','patient_id','status','updated_at']);
    assert.deepEqual(Object.keys(rows[0].patient).sort(),['id','name']);
    api.recoveryNotice.setMode('unavailable');assert.equal((await read()).status,503);
    api.recoveryNotice.setMode('empty');assert.deepEqual(await (await read()).json(),[]);
    api.recoveryNotice.reset();query.set('user_id','eq.other');assert.equal((await read()).status,400);
    assert.equal(api.recoveryNotice.unexpected.length,1);
  }finally{await api.close();}
});

test('recovery metadata and simulated cross-tab revision never permit a draft write',async()=>{
  const api=await startClinicFixture({workspaceDates:true,recoveryNoticeReview:true});
  try{
    const target=api.displayData.drafts[0].patient_id;
    api.recoveryNotice.makeReview(target);
    assert.equal(api.displayData.drafts[0].status,'review');
    const before=structuredClone(api.displayData);
    assert.equal((await fetch(api.origin+'/rest/v1/consultation_drafts',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'error'})})).status,405);
    assert.deepEqual(api.displayData,before);assert.equal(api.metrics.workspaceWrites,1);
    assert.throws(()=>api.recoveryNotice.setMode('unsupported'));
  }finally{await api.close();}
});
