import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function auditMfaVerification({api,app,scene,capture,checks,screens,errors,consoleErrors,errorResponses,failedRequests,blocked}){
  const original=structuredClone(api.mfaFactors),[a,b]=original,path='/seguranca';
  const message='Código incorreto ou expirado. Confira se o horário do celular está automático e tente o código atual.';
  const sessionFingerprint=page=>page.evaluate(async()=>{
    const keys=Object.keys(localStorage).filter(key=>/^sb-.*-auth-token$/.test(key));if(keys.length!==1)throw new Error('Expected one isolated synthetic session');
    const value=localStorage.getItem(keys[0]),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  });
  for(const format of ['modern','legacy'])for(const width of [320,375,1280,1920]){
    api.mfaVerification.reset();api.mfaVerification.setFormat(format);
    const page=await scene(app,'security',path),before=api.mfaVerification.calls.length;
    await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const selector=page.getByRole('combobox',{name:'Autenticador',exact:true}),code=page.getByLabel('Código do aplicativo',{exact:true}),submit=page.getByRole('button',{name:'Verificar código',exact:true});
    const take=(variant,action)=>capture(page,app,'security',path,width,action,'verify-'+format+'-'+variant,{navigate:false});
    await take('initial',async()=>{await expect(page.locator('main li')).toHaveCount(3);await expect(selector).toHaveValue(a.id);await expect(code).toHaveValue('');await expect(submit).toBeDisabled();});
    const sessionBefore=await sessionFingerprint(page);
    const origin=await page.evaluate(()=>performance.timeOrigin);
    const denied=async()=>{
      const alert=page.getByRole('alert');await expect(alert).toHaveText(message);await expect(alert).toBeFocused();
      const bounds=await alert.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});
      assert.ok(bounds.left>=-1&&bounds.right<=bounds.width+1&&bounds.top>=-1&&bounds.bottom<=bounds.height+1);return bounds;
    };
    await code.fill('111111');await submit.click();
    await take('invalid',async()=>{const bounds=await denied();await expect(selector).toHaveValue(a.id);await expect(code).toHaveValue('111111');checks.push({format,width,errorFocused:bounds});});
    assert.equal(api.mfaVerification.calls.length,before+2);
    await selector.selectOption(b.id);
    await take('changed-factor',async()=>{await expect(code).toHaveValue('');await expect(submit).toBeDisabled();await expect(page.getByRole('alert')).toHaveCount(0);await expect(selector).toHaveValue(b.id);});
    assert.equal(api.mfaVerification.calls.length,before+2,'Changing selection must not submit or challenge');
    api.mfaVerification.setFailure('mfa_challenge_expired');await code.fill('222222');await submit.click();
    await take('expired',async()=>{await denied();await expect(selector).toHaveValue(b.id);await expect(code).toHaveValue('222222');});
    api.mfaVerification.setFailure('mfa_verification_failed');await code.fill('333333');await submit.click();
    await take('retry',async()=>{await denied();await expect(selector).toHaveValue(b.id);await expect(code).toHaveValue('333333');await expect(page.getByText(/Verificação concluída/)).toHaveCount(0);});
    const calls=api.mfaVerification.calls.slice(before);assert.equal(calls.length,6);assert.ok(calls.every(c=>c.valid));
    for(let i=0;i<6;i+=2){assert.equal(calls[i].action,'challenge');assert.equal(calls[i+1].action,'verify');assert.equal(calls[i].challengeId,calls[i+1].challengeId);assert.equal(calls[i].factorId,i===0?a.id:b.id);assert.equal(calls[i].factorId,calls[i+1].factorId);assert.equal(calls[i+1].codeLength,6);}
    assert.equal(new Set(calls.filter(c=>c.action==='challenge').map(c=>c.challengeId)).size,3);
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);assert.deepEqual(api.mfaFactors,original);assert.equal(await sessionFingerprint(page),sessionBefore);
    checks.push({format,width,explicitAttempts:3,freshChallenges:3,selectedFactorBound:true,codeClearedOnSelection:true,noFactorOrSessionUpgrade:true,sameDocument:true});
  }
  assert.equal(api.mfaVerification.calls.length,48);assert.equal(api.metrics.mfaUnexpected.length,0);
  assert.ok(api.metrics.mfaRequests.every(r=>['POST /auth/v1/token','GET /auth/v1/user'].includes(r.method+' '+r.path)||r.method==='POST'&&original.slice(0,2).some(f=>r.path==='/auth/v1/factors/'+f.id+'/challenge'||r.path==='/auth/v1/factors/'+f.id+'/verify')));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites'])assert.equal(api.metrics[key],0);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failedRequests,[]);
  assert.equal(errorResponses.length,24);assert.ok(errorResponses.every(r=>r.status===422&&r.path.endsWith('/verify')));assert.equal(consoleErrors.length,24);assert.ok(consoleErrors.every(r=>/422/.test(r.message)));
  assert.equal(screens.length,40);for(const s of screens)assert.ok(s.overflow<=1&&!s.dialogOutsideViewport&&!s.recoveryScreen&&!s.missingButtons.length&&!s.missingLabels.length&&!s.brokenText.length,'MFA verification layout clipped');
}
