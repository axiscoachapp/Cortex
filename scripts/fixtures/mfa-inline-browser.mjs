import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function auditMfaInline({api,app,scene,capture,checks,screens,errors,consoleErrors,errorResponses,failedRequests,blocked}){
  const original=structuredClone(api.mfaFactors),[a,b]=original,path='/agenda';
  const message='Código incorreto ou expirado. Confira se o horário do celular está automático e tente o código atual.';
  const fingerprint=page=>page.evaluate(async()=>{
    const keys=Object.keys(localStorage).filter(key=>/^sb-.*-auth-token$/.test(key));if(keys.length!==1)throw new Error('Expected one isolated synthetic session');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(localStorage.getItem(keys[0])));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  });
  for(const format of ['modern','legacy'])for(const width of [320,375,1280,1920]){
    api.mfaVerification.reset();api.mfaVerification.setFormat(format);
    const page=await scene(app,'security',path);await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const gate=page.getByRole('alertdialog',{name:'Verifique seu acesso'}),selector=gate.getByRole('combobox',{name:'Autenticador',exact:true}),code=gate.getByLabel('Código de 6 dígitos',{exact:true});
    const submit=()=>gate.getByRole('button',{name:'Verificar código',exact:true});
    const locked=async()=>{await expect(gate).toBeVisible();await expect(page.locator('[data-session-content]')).toHaveCount(0);};
    const take=(variant,action)=>capture(page,app,'security',path,width,async()=>{await locked();await action();},'inline-'+format+'-'+variant,{navigate:false,viewportOnly:true});
    await take('initial',async()=>{await expect(selector).toHaveValue(a.id);await expect(code).toHaveValue('');await expect(submit()).toBeDisabled();});
    const before=api.mfaVerification.calls.length,session=await fingerprint(page),origin=await page.evaluate(()=>performance.timeOrigin);
    let release;const hold=new Promise(resolve=>{release=resolve;}),endpoint=api.origin+'/auth/v1/factors/'+a.id+'/verify';let intercepted=false;
    await page.route(endpoint,async route=>{intercepted=true;await hold;await route.continue();});
    try{
      await code.fill('111111');await submit().click();await expect.poll(()=>intercepted).toBe(true);
      await take('pending',async()=>{await expect(selector).toBeDisabled();await expect(code).toBeDisabled();await expect(gate.getByRole('button',{name:'Verificando…',exact:true})).toBeDisabled();await expect(code).toHaveValue('111111');});
      assert.equal(api.mfaVerification.calls.length,before+1);assert.equal(api.mfaVerification.calls.at(-1).action,'challenge');
    }finally{release();}
    const denied=async()=>{
      const alert=gate.getByRole('alert');await expect(alert).toHaveText(message);await expect(alert).toBeFocused();await expect(selector).toBeEnabled();await expect(code).toBeEnabled();
      const bounds=await alert.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});assert.ok(bounds.left>=-1&&bounds.right<=bounds.width+1&&bounds.top>=-1&&bounds.bottom<=bounds.height+1);return bounds;
    };
    await take('invalid',async()=>{const bounds=await denied();await expect(selector).toHaveValue(a.id);await expect(code).toHaveValue('111111');checks.push({format,width,errorFocused:bounds,pendingFieldsLocked:true,clinicalContentAbsent:true});});
    await page.unroute(endpoint);assert.equal(api.mfaVerification.calls.length,before+2);
    await code.focus();await submit().click();
    await take('repeated',async()=>{await denied();await expect(selector).toHaveValue(a.id);await expect(code).toHaveValue('111111');});
    assert.equal(api.mfaVerification.calls.length,before+4);
    await selector.selectOption(b.id);
    await take('changed-factor',async()=>{await expect(selector).toHaveValue(b.id);await expect(code).toHaveValue('');await expect(gate.getByRole('alert')).toHaveCount(0);await expect(submit()).toBeDisabled();});
    assert.equal(api.mfaVerification.calls.length,before+4,'Selecting another inline factor must not send a command');
    api.mfaVerification.setFailure('mfa_challenge_expired');await code.fill('222222');await submit().click();
    await take('expired',async()=>{await denied();await expect(selector).toHaveValue(b.id);await expect(code).toHaveValue('222222');});
    const calls=api.mfaVerification.calls.slice(before);assert.equal(calls.length,6);assert.ok(calls.every(c=>c.valid));
    for(let i=0;i<6;i+=2){assert.equal(calls[i].action,'challenge');assert.equal(calls[i+1].action,'verify');assert.equal(calls[i].factorId,i<4?a.id:b.id);assert.equal(calls[i].factorId,calls[i+1].factorId);assert.equal(calls[i].challengeId,calls[i+1].challengeId);assert.equal(calls[i+1].codeLength,6);}
    assert.equal(new Set(calls.filter(c=>c.action==='challenge').map(c=>c.challengeId)).size,3);assert.deepEqual(api.mfaFactors,original);assert.equal(await fingerprint(page),session);assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    checks.push({format,width,manualAttempts:3,freshChallenges:3,repeatedRefusalFocused:true,noCommandOnSelection:true,sessionAndFactorsPreserved:true,sameDocument:true,clinicalContentAbsent:true});
  }
  assert.equal(api.mfaVerification.calls.length,48);assert.equal(api.metrics.mfaUnexpected.length,0);
  assert.ok(api.metrics.mfaRequests.every(r=>['POST /auth/v1/token','GET /auth/v1/user'].includes(r.method+' '+r.path)||r.method==='POST'&&original.slice(0,2).some(f=>['challenge','verify'].some(action=>r.path==='/auth/v1/factors/'+f.id+'/'+action))));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites'])assert.equal(api.metrics[key],0);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failedRequests,[]);assert.equal(errorResponses.length,24);assert.ok(errorResponses.every(r=>r.status===422&&r.path.endsWith('/verify')));assert.equal(consoleErrors.length,24);assert.ok(consoleErrors.every(r=>/422/.test(r.message)));
  assert.equal(screens.length,48);for(const s of screens)assert.ok(s.overflow<=1&&s.dialogHorizontalOverflow<=1&&!s.dialogOutsideViewport&&s.dialogActionReachable!==false&&!s.recoveryScreen&&!s.missingButtons.length&&!s.missingLabels.length&&!s.brokenText.length,'Inline MFA layout clipped');
}
