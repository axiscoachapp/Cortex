import assert from 'node:assert/strict';
import test from 'node:test';
import {startClinicFixture,patientId} from './clinic-review-api.mjs';
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
