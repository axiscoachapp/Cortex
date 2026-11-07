import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function auditMfaUnavailability({api,app,scene,capture,checks,screens,errors,consoleErrors,errorResponses,failedRequests,blocked}){
  const original=structuredClone(api.mfaFactors),factor=original[1],path='/seguranca';
  const rate='Muitas tentativas seguidas. Aguarde um pouco antes de tentar novamente.';
  const unavailable='Não foi possível concluir. Confira o código e a conexão e tente novamente.';
  const invalid='Código incorreto ou expirado. Confira se o horário do celular está automático e tente o código atual.';
  const cases=[
    {name:'challenge-limit',challenge:'over_request_rate_limit',verification:'mfa_verification_failed',message:rate,status:429,delta:1},
    {name:'challenge-unavailable',challenge:'unexpected_failure',verification:'mfa_verification_failed',message:unavailable,status:503,delta:1},
    {name:'verify-unavailable',challenge:null,verification:'unexpected_failure',message:unavailable,status:503,delta:2},
    {name:'verify-limit',challenge:null,verification:'over_request_rate_limit',message:rate,status:429,delta:2},
    {name:'explicit-retry',challenge:null,verification:'mfa_verification_failed',message:invalid,status:422,delta:2},
  ];
  const fingerprint=page=>page.evaluate(async()=>{
    const keys=Object.keys(localStorage).filter(key=>/^sb-.*-auth-token$/.test(key));if(keys.length!==1)throw new Error('Expected one isolated synthetic session');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(localStorage.getItem(keys[0])));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  });
  const quiet=async(page,expected)=>{await page.clock.runFor(120_000);await page.waitForTimeout(750);await page.waitForLoadState('networkidle');assert.equal(api.mfaVerification.calls.length,expected,'No automatic challenge/verify during virtual waiting interval');};
  let probePage,probeSession;
  for(const format of ['modern','legacy'])for(const width of [320,375,1280,1920]){
    api.mfaVerification.reset();api.mfaVerification.setFormat(format);
    const page=await scene(app,'security',path);await page.clock.install({time:new Date('2026-11-05T15:00:00Z')});
    const selector=page.getByRole('combobox',{name:'Autenticador',exact:true}),code=page.getByLabel('Código do aplicativo',{exact:true}),submit=page.getByRole('button',{name:'Verificar código',exact:true});
    const take=(variant,action)=>capture(page,app,'security',path,width,action,'unavailable-'+format+'-'+variant,{navigate:false});
    await expect(selector).toBeVisible();await selector.selectOption(factor.id);await code.fill('123456');
    await take('initial',async()=>{await expect(page.locator('main li')).toHaveCount(3);await expect(submit).toBeEnabled();});
    const before=api.mfaVerification.calls.length,session=await fingerprint(page),origin=await page.evaluate(()=>performance.timeOrigin);let expected=before;
    for(const sample of cases){
      api.mfaVerification.setChallengeFailure(sample.challenge);api.mfaVerification.setFailure(sample.verification);
      await submit.click();expected+=sample.delta;
      await take(sample.name,async()=>{
        const alert=page.getByRole('alert');await expect(alert).toHaveText(sample.message);await expect(alert).toBeFocused();await expect(selector).toHaveValue(factor.id);await expect(code).toHaveValue('123456');await expect(submit).toBeEnabled();
        const bounds=await alert.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});assert.ok(bounds.left>=-1&&bounds.right<=bounds.width+1&&bounds.top>=-1&&bounds.bottom<=bounds.height+1);
        await expect(page.getByText('Synthetic MFA refusal',{exact:true})).toHaveCount(0);await expect(page.getByText(/Verificação concluída/)).toHaveCount(0);
      });
      assert.equal(api.mfaVerification.calls.length,expected);const last=api.mfaVerification.calls.at(-1);assert.equal(last.factorId,factor.id);assert.equal(last.action,sample.delta===1?'challenge':'verify');assert.equal(last.errorCode,sample.challenge??sample.verification);
      await quiet(page,expected);
      assert.equal((await fingerprint(page)),session);assert.deepEqual(api.mfaFactors,original);assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
      checks.push({format,width,phase:sample.name,status:sample.status,commands:sample.delta,selectedFactorBound:true,noAutomaticRetryVirtualMs:120_000,realNetworkObservationMs:750,sessionAndFactorsPreserved:true});
    }
    const calls=api.mfaVerification.calls.slice(before),challenges=calls.filter(c=>c.action==='challenge'&&c.challengeId);
    assert.equal(calls.length,8);assert.ok(calls.every(c=>c.valid));assert.equal(new Set(challenges.map(c=>c.challengeId)).size,3);
    for(const verification of calls.filter(c=>c.action==='verify')){assert.equal(verification.codeLength,6);assert.ok(challenges.some(c=>c.challengeId===verification.challengeId&&c.factorId===verification.factorId));}
    probePage=page;probeSession=session;
  }
  assert.equal(api.mfaVerification.calls.length,64);assert.equal(api.metrics.mfaUnexpected.length,0);
  assert.ok(api.metrics.mfaRequests.every(r=>['POST /auth/v1/token','GET /auth/v1/user'].includes(r.method+' '+r.path)||r.method==='POST'&&['challenge','verify'].some(action=>r.path==='/auth/v1/factors/'+factor.id+'/'+action)));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites'])assert.equal(api.metrics[key],0);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failedRequests,[]);
  assert.equal(errorResponses.length,40);for(const [status,count] of [[429,16],[503,16],[422,8]])assert.equal(errorResponses.filter(r=>r.status===status).length,count);
  assert.equal(consoleErrors.length,40);assert.ok(consoleErrors.every(r=>/429|503|422/.test(r.message)));
  // Synthetic negative control: an accidental two-stage timer submits the real form.
  // The quiet-period assertion must reject it, rather than merely assume timers ran.
  await probePage.evaluate(()=>{const form=document.querySelector('main form');if(!(form instanceof HTMLFormElement))throw new Error('Expected verification form');setTimeout(()=>setTimeout(()=>form.requestSubmit(),1000),60_000);});
  await assert.rejects(()=>quiet(probePage,64),/No automatic challenge\/verify/);
  const probe=api.mfaVerification.calls.slice(64);assert.equal(probe.length,2);assert.equal(probe[0].action,'challenge');assert.equal(probe[1].action,'verify');assert.equal(probe[0].challengeId,probe[1].challengeId);assert.ok(probe.every(c=>c.valid&&c.factorId===factor.id));
  assert.equal(api.mfaVerification.calls.length,66);assert.equal(errorResponses.length,41);assert.equal(errorResponses.at(-1).status,422);assert.equal(consoleErrors.length,41);assert.equal(await fingerprint(probePage),probeSession);assert.deepEqual(api.mfaFactors,original);
  checks.push({negativeControl:'two-stage timer submits real form',scheduledAtVirtualMs:61_000,waitingWindowVirtualMs:120_000,rejectedByQuietAssertion:true,extraSyntheticChallengeVerifyCalls:2,extraExpected422:1});
  assert.equal(screens.length,48);for(const s of screens)assert.ok(s.overflow<=1&&!s.dialogOutsideViewport&&!s.recoveryScreen&&!s.missingButtons.length&&!s.missingLabels.length&&!s.brokenText.length,'MFA availability layout clipped');
}
