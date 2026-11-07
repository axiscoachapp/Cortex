import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function auditMfaSuccess({api,app,scene,capture,checks,screens,errors,consoleErrors,errorResponses,failedRequests,blocked}){
  const original=structuredClone(api.mfaFactors),factor=original[1],path='/seguranca';
  const fingerprint=page=>page.evaluate(async()=>{
    const keys=Object.keys(localStorage).filter(key=>/^sb-.*-auth-token$/.test(key));if(keys.length!==1)throw new Error('Expected one isolated synthetic session');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(localStorage.getItem(keys[0])));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  });
  const assurance=page=>page.evaluate(async()=>{
    const {supabase}=await import('/src/integrations/supabase/client.ts');
    const level=await supabase.auth.mfa.getAuthenticatorAssuranceLevel(),session=await supabase.auth.getSession();
    if(level.error||session.error)throw new Error('Synthetic assurance read failed');
    return {current:level.data.currentLevel,next:level.data.nextLevel,totp:level.data.currentAuthenticationMethods.some(method=>method.method==='totp'),actor:session.data.session?.user.id};
  });
  for(const format of ['modern','legacy'])for(const width of [320,375,1280,1920]){
    api.mfaVerification.reset();api.mfaVerification.setFormat(format);
    const page=await scene(app,'security',path);await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const selector=page.getByRole('combobox',{name:'Autenticador',exact:true}),code=page.getByLabel('Código do aplicativo',{exact:true}),submit=page.getByRole('button',{name:'Verificar código',exact:true});
    const take=(variant,action)=>capture(page,app,'security',path,width,action,'success-'+format+'-'+variant,{navigate:false});
    await take('initial',async()=>{await expect(page.locator('main li')).toHaveCount(3);await expect(code).toHaveValue('');await expect(submit).toBeDisabled();});
    const before=api.mfaVerification.calls.length,initial=await assurance(page),storedBefore=await fingerprint(page),origin=await page.evaluate(()=>performance.timeOrigin);
    assert.equal(initial.current,'aal1');assert.equal(initial.next,'aal2');assert.equal(initial.totp,false);
    await selector.selectOption(factor.id);await code.fill('111111');await submit.click();
    await take('refused',async()=>{const alert=page.getByRole('alert');await expect(alert).toContainText('Código incorreto ou expirado');await expect(alert).toBeFocused();await expect(code).toHaveValue('111111');await expect(selector).toHaveValue(factor.id);await expect(page.getByText(/Verificação concluída/)).toHaveCount(0);});
    assert.deepEqual(await assurance(page),initial);assert.equal(await fingerprint(page),storedBefore);assert.equal(api.mfaVerification.calls.length,before+2);
    api.mfaVerification.setFailure(null);await code.fill('654321');await submit.click();
    await take('verified',async()=>{await expect(page.getByRole('status')).toHaveText('Verificação concluída. Sua sessão está protegida pelo segundo fator.');await expect(code).toHaveValue('');await expect(submit).toBeDisabled();await expect(selector).toHaveValue(factor.id);await expect(page.getByRole('alert')).toHaveCount(0);});
    const verified=await assurance(page),storedAfter=await fingerprint(page);assert.deepEqual(verified,{current:'aal2',next:'aal2',totp:true,actor:initial.actor});assert.notEqual(storedAfter,storedBefore);assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    const calls=api.mfaVerification.calls.slice(before);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.valid&&c.factorId===factor.id));
    for(let i=0;i<4;i+=2){assert.equal(calls[i].action,'challenge');assert.equal(calls[i+1].action,'verify');assert.equal(calls[i].challengeId,calls[i+1].challengeId);assert.equal(calls[i+1].codeLength,6);}
    assert.notEqual(calls[0].challengeId,calls[2].challengeId);assert.equal(calls[1].errorCode,'mfa_verification_failed');assert.equal(calls[3].verified,true);assert.deepEqual(api.mfaFactors,original);
    await page.reload();await take('reloaded',async()=>{await expect(page.locator('main li')).toHaveCount(3);await expect(code).toHaveValue('');await expect(submit).toBeDisabled();await expect(page.getByText(/Verificação concluída/)).toHaveCount(0);});
    assert.deepEqual(await assurance(page),verified);assert.equal(await fingerprint(page),storedAfter);assert.equal(api.mfaVerification.calls.length,before+4);assert.deepEqual(api.mfaFactors,original);
    checks.push({format,width,manualAttempts:2,freshChallenges:2,actorAndFactorsPreserved:true,refusalPreservedSession:true,successChangedStoredSession:true,sdkCurrentAndNextLevel:'aal2',sdkTotpMethod:true,reloadPreservedSession:true,noCommandsOnReload:true});
  }
  assert.equal(api.mfaVerification.calls.length,32);assert.equal(api.mfaVerification.calls.filter(c=>c.verified===true).length,8);assert.equal(api.metrics.mfaUnexpected.length,0);
  assert.ok(api.metrics.mfaRequests.every(r=>['POST /auth/v1/token','GET /auth/v1/user'].includes(r.method+' '+r.path)||r.method==='POST'&&['challenge','verify'].some(action=>r.path==='/auth/v1/factors/'+factor.id+'/'+action)));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites'])assert.equal(api.metrics[key],0);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failedRequests,[]);assert.equal(errorResponses.length,8);assert.ok(errorResponses.every(r=>r.status===422&&r.path.endsWith('/verify')));assert.equal(consoleErrors.length,8);assert.ok(consoleErrors.every(r=>/422/.test(r.message)));
  assert.equal(screens.length,32);for(const s of screens)assert.ok(s.mfaCodeMasked&&s.overflow<=1&&s.dialogHorizontalOverflow<=1&&!s.dialogOutsideViewport&&s.dialogActionReachable!==false&&!s.recoveryScreen&&!s.missingButtons.length&&!s.missingLabels.length&&!s.brokenText.length,'MFA success layout clipped');
}
