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

test('MFA limits and temporary failures remain phase-specific and never mint a successful session',async()=>{
  const api=await startClinicFixture({mfaReview:true,mfaVerificationReview:true});
  try{
    const original=structuredClone(api.mfaFactors),[factor]=original;
    const post=(action,body)=>fetch(api.origin+'/auth/v1/factors/'+factor.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    for(const format of ['modern','legacy']){
      api.mfaVerification.reset();api.mfaVerification.setFormat(format);
      for(const failure of ['over_request_rate_limit','unexpected_failure']){
        api.mfaVerification.setChallengeFailure(failure);const denied=await post('challenge',{factorId:factor.id}),body=await denied.json();
        assert.equal(denied.status,failure==='over_request_rate_limit'?429:503);assert.equal(body[format==='modern'?'code':'error_code'],failure);assert.equal(denied.headers.get('retry-after'),failure==='over_request_rate_limit'?'120':null);assert.equal(body.id,undefined);
      }
      api.mfaVerification.setChallengeFailure(null);
      for(const failure of ['unexpected_failure','over_request_rate_limit']){
        api.mfaVerification.setFailure(failure);const challenge=await (await post('challenge',{factorId:factor.id})).json();
        const denied=await post('verify',{challenge_id:challenge.id,code:'123456'}),body=await denied.json();assert.equal(denied.status,failure==='over_request_rate_limit'?429:503);assert.equal(body.access_token,undefined);
        assert.equal((await post('verify',{challenge_id:challenge.id,code:'123456'})).status,400);
      }
      api.mfaVerification.reset();assert.equal((await post('challenge',{factorId:factor.id})).status,200);
    }
    assert.deepEqual(api.mfaFactors,original);assert.ok(api.mfaVerification.calls.every(c=>!Object.hasOwn(c,'code')));
  }finally{await api.close();}
});
