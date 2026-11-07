import test from 'node:test';
import assert from 'node:assert/strict';
import {startClinicFixture} from './clinic-review-api.mjs';

test('MFA verification is independently opt-in and binds one synthetic challenge to its selected verified factor',async()=>{
  await assert.rejects(startClinicFixture({mfaVerificationReview:true}),/verification requires/);
  await assert.rejects(startClinicFixture({mfaReview:true,mfaEnrollmentReview:true,mfaVerificationReview:true}),/verification requires/);
  const api=await startClinicFixture({mfaReview:true,mfaVerificationReview:true});
  try{
    const [a,b]=api.mfaFactors;
    for(const format of ['modern','legacy']){
      api.mfaVerification.setFormat(format);api.mfaVerification.reset();
      const post=(factor,action,body)=>fetch(api.origin+'/auth/v1/factors/'+factor.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal((await post(a,'challenge',{factorId:a.id,userId:'injected'})).status,400);
      const reply=await post(a,'challenge',{factorId:a.id});assert.equal(reply.status,200);const challenge=await reply.json();
      assert.equal(reply.headers.get('x-supabase-api-version'),format==='modern'?'2024-01-01':null);
      assert.equal((await post(b,'verify',{challenge_id:challenge.id,code:'123456'})).status,400);
      const denied=await post(a,'verify',{challenge_id:challenge.id,code:'123456'});assert.equal(denied.status,422);const body=await denied.json();assert.equal(body[format==='modern'?'code':'error_code'],'mfa_verification_failed');
      assert.equal((await post(a,'verify',{challenge_id:challenge.id,code:'123456'})).status,400);
      const fresh=await (await post(a,'challenge',{factorId:a.id})).json();assert.notEqual(fresh.id,challenge.id);
    }
    assert.ok(api.mfaFactors.every(f=>['verified','unverified'].includes(f.status)));assert.ok(api.mfaVerification.calls.every(c=>!Object.hasOwn(c,'code')));
  }finally{await api.close();}
});
