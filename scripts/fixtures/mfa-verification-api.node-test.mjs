import test from 'node:test';
import assert from 'node:assert/strict';
import {startClinicFixture} from './clinic-review-api.mjs';
import {createMfaVerificationFixture} from './mfa-verification-api.mjs';

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

test('successful verification needs a separate opt-in, exact synthetic code and unused bound challenge',async()=>{
  let invalid;
  try{await assert.rejects(async()=>{invalid=await startClinicFixture({mfaReview:true,mfaVerificationSuccessReview:true});},/success requires/);}finally{await invalid?.close();}
  const negative=await startClinicFixture({mfaReview:true,mfaVerificationReview:true});
  try{assert.throws(()=>negative.mfaVerification.setFailure(null));}finally{await negative.close();}
  const api=await startClinicFixture({mfaReview:true,mfaVerificationReview:true,mfaVerificationSuccessReview:true});
  try{
    const original=structuredClone(api.mfaFactors),[a,b]=original;api.mfaVerification.setFailure(null);
    const post=(factor,action,body)=>fetch(api.origin+'/auth/v1/factors/'+factor.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await (await post(a,'challenge',{factorId:a.id})).json();assert.equal((await post(a,'verify',{challenge_id:first.id,code:'111111'})).status,422);
    const second=await (await post(b,'challenge',{factorId:b.id})).json();assert.equal((await post(a,'verify',{challenge_id:second.id,code:'654321'})).status,400);
    const verified=await post(b,'verify',{challenge_id:second.id,code:'654321'});assert.equal(verified.status,200);const data=await verified.json(),payload=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString('utf8'));
    assert.equal(payload.aal,'aal2');assert.equal(payload.sub,data.user.id);assert.ok(payload.amr.some(method=>method.method==='totp'));assert.equal(data.expires_at,payload.exp);assert.equal(data.token_type,'bearer');
    assert.equal((await post(b,'verify',{challenge_id:second.id,code:'654321'})).status,400);assert.deepEqual(api.mfaFactors,original);
    assert.ok(api.mfaVerification.calls.every(c=>!Object.hasOwn(c,'code')&&!Object.hasOwn(c,'access_token')));assert.equal(api.mfaVerification.calls.filter(c=>c.verified===true).length,1);
  }finally{await api.close();}
});

test('successful verification enforces the advertised challenge deadline, including its exact boundary',()=>{
  const factor={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',factor_type:'totp',status:'verified'};
  for(const offset of [-1,0,1]){
    let nowMs=1_800_000_000_000,minted=0;const fixture=createMfaVerificationFixture([factor],{now:()=>nowMs,onVerified:()=>{minted++;return {synthetic:true};}});fixture.setFailure(null);
    const url=action=>new URL('http://127.0.0.1/auth/v1/factors/'+factor.id+'/'+action);
    const challenge=fixture.read({method:'POST'},url('challenge'),{factorId:factor.id}).body;nowMs=challenge.expires_at*1000+offset;
    const verify=()=>fixture.read({method:'POST'},url('verify'),{challenge_id:challenge.id,code:'654321'}),reply=verify();
    assert.equal(reply.status,offset<0?200:422);assert.equal(minted,offset<0?1:0);if(offset>=0)assert.equal(reply.body.code,'mfa_challenge_expired');assert.equal(verify().status,400);
  }
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
