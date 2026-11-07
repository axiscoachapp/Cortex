import assert from 'node:assert/strict';
import test from 'node:test';
import {startClinicFixture,patientId,uid} from './clinic-review-api.mjs';
import {postConsultationId} from './post-consultation-api.mjs';

test('post-consultation fixture is opt-in and accepts only the explicit reviewed patient/draft',async()=>{
  await assert.rejects(startClinicFixture({postConsultationReview:true}),/isolated recovery/);
  for(const enabled of [false,true]){
    const api=await startClinicFixture({workspaceDates:true,recoveryNoticeReview:true,postConsultationReview:enabled});
    try{
      api.recoveryNotice.makeReview(patientId);const draft=api.displayData.drafts.find(d=>d.patient_id===patientId);
      const body={patientId,draftId:draft.id,saveDirect:true,reviewed:true,soapNote:draft.content.soapDraft};
      const call=input=>fetch(api.origin+'/functions/v1/finalize-consultation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      if(enabled){for(const changed of [{reviewed:false},{patientId:'foreign'},{soapNote:'unreviewed'},{actorId:'foreign'}])assert.equal((await call({...body,...changed})).status,400);}
      const response=await call(body);assert.equal(response.status,enabled?200:503);
      if(enabled){assert.equal((await response.json()).consultationId,postConsultationId);assert.ok(!api.displayData.drafts.some(d=>d.id===draft.id));assert.equal(api.postConsultation.calls.filter(c=>c.accepted).length,1);}
    }finally{await api.close();}
  }
});

test('direct-entry writes are separately opt-in and stay draft/open without appointment metadata',async()=>{
  await assert.rejects(startClinicFixture({postEntryReview:true}),/entries require/);
  const api=await startClinicFixture({workspaceDates:true,recoveryNoticeReview:true,postConsultationReview:true,postEntryReview:true});
  const body={patient_id:patientId,user_id:uid,kind:'instruction',title:'Orientações da consulta',content:'Orientação sintética',details:{date:'2026-11-07',state:'active'},due_date:null,status:'draft'};
  const call=b=>fetch(api.origin+'/rest/v1/clinical_work_items?select=*',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  try{
    for(const invalid of [{user_id:'foreign'},{patient_id:'foreign'},{status:'approved'},{details:{...body.details,appointmentId:'inferred'}}])assert.equal((await call({...body,...invalid})).status,400);
    assert.equal((await call(body)).status,201);assert.equal((await call({...body,kind:'task',status:'open',details:{...body.details,workflow:'followup',stage:'requested'}})).status,201);
    assert.equal(api.postConsultation.writes.filter(w=>w.accepted).length,2);assert.equal(api.metrics.appointmentWrites,0);
  }finally{await api.close();}
});
