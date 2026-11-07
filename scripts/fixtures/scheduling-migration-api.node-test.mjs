import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startClinicFixture,uid } from './clinic-review-api.mjs';
import { schedulingSelect } from './scheduling-migration-api.mjs';
import { recoverySelect } from './recovery-notice-api.mjs';

test('scheduling fixture enforces opt-in and exact private task projection',async()=>{
  await assert.rejects(startClinicFixture({schedulingReview:true}),/isolated workspace/);
  const api=await startClinicFixture({workspaceDates:true,schedulingReview:true});
  try{
    const query=new URLSearchParams({select:schedulingSelect,user_id:'eq.'+uid,kind:'eq.task',status:'in.(open,draft)','details->>workflow':'in.(waitlist,confirmation)',order:'updated_at.desc,id.asc',limit:'51'});
    const read=()=>fetch(api.origin+'/rest/v1/clinical_work_items?'+query);
    let response=await read();assert.equal(response.status,200);const rows=await response.json();assert.equal(rows.length,2);
    assert.deepEqual(rows.map(row=>row.workflow),['waitlist','confirmation']);assert.ok(rows.every(row=>!Object.hasOwn(row,'content')&&row.patient.id===row.patient_id));
    api.scheduling.setMode('unavailable');assert.equal((await read()).status,503);
    api.scheduling.setMode('empty');assert.deepEqual(await(await read()).json(),[]);
    query.set('user_id','eq.other');assert.equal((await read()).status,400);assert.equal(api.scheduling.unexpected.length,1);
  }finally{await api.close();}
});

test('legacy Home fixture returns recovery metadata and still blocks work writes',async()=>{
  const api=await startClinicFixture({workspaceDates:true,schedulingReview:true});
  try{
    const before=structuredClone(api.displayData);
    const query=new URLSearchParams({select:recoverySelect,user_id:'eq.'+uid,discard_requested_at:'is.null',status:'in.(processing,review,error)',order:'updated_at.desc,id.asc',limit:'51'});
    const rows=await(await fetch(api.origin+'/rest/v1/consultation_drafts?'+query)).json();
    assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['id','patient','patient_id','status','updated_at']);
    assert.equal((await fetch(api.origin+'/rest/v1/clinical_work_items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'done'})})).status,405);
    assert.deepEqual(api.displayData,before);assert.equal(api.metrics.workspaceWrites,1);
  }finally{await api.close();}
});
