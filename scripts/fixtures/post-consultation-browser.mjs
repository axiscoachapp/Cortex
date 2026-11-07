import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {patientId} from './clinic-review-api.mjs';

export async function auditPostConsultation({api,app,scene,capture,checks,screens,errors,blocked,requests,consoleErrors,errorResponses,failedRequests}){
  const path='/?patient='+patientId;
  for(const width of [320,375,1280,1920]){
    api.recoveryNotice.reset();api.postConsultation.reset();api.recoveryNotice.makeReview(patientId);
    const workBefore=structuredClone(api.displayData.workItems),page=await scene(app,'review',path);
    await page.setViewportSize({width,height:1000});
    const take=(variant,action)=>capture(page,app,'review',path,width,action,variant,{navigate:false,viewportOnly:true});
    const prior=api.postConsultation.calls.length;
    await take('post-review',async()=>{await expect(page.getByRole('dialog')).toContainText('Revisão sintética atualizada em outra aba');await expect(page.getByRole('region',{name:'Pós-consulta'})).toHaveCount(0);});
    assert.equal(api.postConsultation.calls.length,prior,'Review alone must not finalize');
    await page.getByRole('button',{name:'Confirmar e salvar',exact:true}).click();
    const post=page.getByRole('region',{name:'Pós-consulta'}),follow=post.getByRole('button',{name:'Orientações e retorno',exact:true});
    await take('post-saved',async()=>{
      await expect(post).toBeVisible();await expect(post.getByRole('button')).toHaveCount(4);await post.scrollIntoViewIfNeeded();
      const controls=[];for(const button of await post.getByRole('button').all()){
        await button.scrollIntoViewIfNeeded();controls.push(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,left:r.left,right:r.right,viewport:innerWidth,onTop:!!hit&&el.contains(hit)};}));
      }assert.ok(controls.every(c=>c.height>=44&&c.left>=-1&&c.right<=c.viewport+1&&c.onTop));checks.push({width,controls});
    });
    assert.equal(api.postConsultation.calls.length,prior+1);assert.equal(api.postConsultation.calls.at(-1).accepted,true);
    const origin=await page.evaluate(()=>performance.timeOrigin);
    await follow.focus();await follow.press('Enter');
    const dialog=page.getByRole('dialog');
    await take('post-followup',async()=>{await expect(dialog).toContainText('Acompanhamento do paciente');await expect(dialog).toContainText('Registro sintético de horários');await expect(page).toHaveURL(app.origin+path);});
    await dialog.getByRole('button',{name:'Novo registro',exact:true}).click();
    await page.getByLabel('Tipo de registro',{exact:true}).selectOption('instruction');
    await page.getByLabel('Conteúdo do registro',{exact:true}).fill('Orientação sintética ainda não salva');
    const close=dialog.locator(':scope > button');page.once('dialog',d=>d.dismiss());await close.click();
    await take('post-unsaved-kept',async()=>{await expect(page.getByLabel('Conteúdo do registro',{exact:true})).toHaveValue('Orientação sintética ainda não salva');});
    page.once('dialog',d=>d.accept());await close.click();await expect(dialog).toHaveCount(0);await expect(follow).toBeFocused();
    await post.getByRole('button',{name:'Receita / Atestado',exact:true}).click();
    await take('post-documents',async()=>{await expect(page.getByRole('dialog')).toContainText('Documento para Paciente Exemplo A');});
    await page.getByRole('dialog').locator(':scope > button').click();
    await take('post-return',async()=>{await expect(post).toBeVisible();await post.scrollIntoViewIfNeeded();});
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);assert.deepEqual(api.displayData.workItems,workBefore);
    assert.equal(api.postConsultation.calls.length,prior+1);checks.push({width,explicitSaveOnly:true,exactPatientPreserved:true,keyboardFollowup:true,guardedUnsavedText:true,focusReturned:true,composerOpenedWithoutGeneration:true,noReload:true,existingWorkPreserved:true});
  }
  const allowedPosts=new Set(['/auth/v1/token',...['clinic_access','workspace_directory','list_patient_chat_turns','get_integration_status','sharing_overview','protocol_sharing_overview'].map(name=>'/rest/v1/rpc/'+name),'/functions/v1/finalize-consultation']);
  assert.ok(requests.length&&requests.every(r=>r.method==='POST'?allowedPosts.has(r.path):['GET','HEAD'].includes(r.method)&&(r.path==='/auth/v1/user'||r.path==='/functions/v1/signature-session/state'||/^\/rest\/v1\/[a-z_]+$/.test(r.path))));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites','workspaceWrites'])assert.equal(api.metrics[key],0,key);
  assert.equal(api.postConsultation.calls.length,4);assert.ok(api.postConsultation.calls.every(c=>c.accepted));
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(errorResponses,[]);
  assert.ok(failedRequests.every(r=>r.method==='HEAD'&&r.path==='/rest/v1/patients'&&r.status===200&&r.reason==='net::ERR_ABORTED'));
  assert.equal(screens.length,24);for(const s of screens)assert.ok(s.overflow<=1&&s.dialogHorizontalOverflow<=1&&!s.dialogOutsideViewport&&s.dialogActionReachable!==false&&!s.missingLabels.length&&!s.missingButtons.length&&!s.brokenText.length,'Post consultation layout clipped');
}
