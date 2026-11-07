import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {patientId} from './clinic-review-api.mjs';

export async function auditPostConsultation({api,app,scene,capture,checks,screens,errors,blocked,requests,consoleErrors,errorResponses,failedRequests,entryReview=false}){
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
      await expect(post).toBeVisible();await expect(post.getByRole('button')).toHaveCount(entryReview?5:4);await post.scrollIntoViewIfNeeded();
      const controls=[];for(const button of await post.getByRole('button').all()){
        await button.scrollIntoViewIfNeeded();controls.push(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,left:r.left,right:r.right,viewport:innerWidth,onTop:!!hit&&el.contains(hit)};}));
      }assert.ok(controls.every(c=>c.height>=44&&c.left>=-1&&c.right<=c.viewport+1&&c.onTop));checks.push({width,controls});
    });
    assert.equal(api.postConsultation.calls.length,prior+1);assert.equal(api.postConsultation.calls.at(-1).accepted,true);
    const origin=await page.evaluate(()=>performance.timeOrigin);
    if(entryReview)await auditEntries({api,page,post,take,width,checks});
    else{
    await follow.focus();await follow.press('Enter');
    const dialog=page.getByRole('dialog');
    await take('post-followup',async()=>{await expect(dialog).toContainText('Acompanhamento do paciente');await expect(dialog).toContainText('Registro sintético de horários');await expect(page).toHaveURL(app.origin+path);});
    await dialog.getByRole('button',{name:'Novo registro',exact:true}).click();
    await page.getByLabel('Tipo de registro',{exact:true}).selectOption('instruction');
    await page.getByLabel('Conteúdo do registro',{exact:true}).fill('Orientação sintética ainda não salva');
    const close=dialog.locator(':scope > button');page.once('dialog',d=>d.dismiss());await close.click();
    await take('post-unsaved-kept',async()=>{await expect(page.getByLabel('Conteúdo do registro',{exact:true})).toHaveValue('Orientação sintética ainda não salva');});
    page.once('dialog',d=>d.accept());await close.click();await expect(dialog).toHaveCount(0);await expect(follow).toBeFocused();
    }
    await post.getByRole('button',{name:'Receita / Atestado',exact:true}).click();
    await take('post-documents',async()=>{await expect(page.getByRole('dialog')).toContainText('Documento para Paciente Exemplo A');});
    await page.getByRole('dialog').locator(':scope > button').click();
    await take('post-return',async()=>{await expect(post).toBeVisible();await post.scrollIntoViewIfNeeded();});
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);assert.deepEqual(api.displayData.workItems.filter(row=>workBefore.some(old=>old.id===row.id)),workBefore);
    if(!entryReview)assert.deepEqual(api.displayData.workItems,workBefore);
    assert.equal(api.postConsultation.calls.length,prior+1);checks.push({width,explicitSaveOnly:true,exactPatientPreserved:true,keyboardFollowup:true,guardedUnsavedText:true,focusReturned:true,composerOpenedWithoutGeneration:true,noReload:true,existingWorkPreserved:true});
    if(entryReview&&[375,1920].includes(width)){
      await page.reload();await page.getByRole('button',{name:'Acompanhamento',exact:true}).click();
      await take('entry-reload',async()=>{for(const title of ['Orientações da consulta','Planejamento de retorno'])await expect(page.getByRole('dialog').getByRole('heading',{name:title,exact:true})).toBeVisible();});
      checks.push({width,entriesSurviveReload:true});
    }
  }
  const allowedPosts=new Set(['/auth/v1/token',...['clinic_access','workspace_directory','list_patient_chat_turns','get_integration_status','sharing_overview','protocol_sharing_overview'].map(name=>'/rest/v1/rpc/'+name),'/functions/v1/finalize-consultation']);
  if(entryReview)allowedPosts.add('/rest/v1/clinical_work_items');
  assert.ok(requests.length&&requests.every(r=>r.method==='POST'?allowedPosts.has(r.path):['GET','HEAD'].includes(r.method)&&(r.path==='/auth/v1/user'||r.path==='/functions/v1/signature-session/state'||/^\/rest\/v1\/[a-z_]+$/.test(r.path))));
  for(const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites','workspaceWrites'])assert.equal(api.metrics[key],0,key);
  assert.equal(api.postConsultation.calls.length,4);assert.ok(api.postConsultation.calls.every(c=>c.accepted));
  assert.equal(api.postConsultation.writes.length,entryReview?8:0);assert.ok(api.postConsultation.writes.every(w=>w.accepted));
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(errorResponses,[]);
  assert.ok(failedRequests.every(r=>r.method==='HEAD'&&r.path==='/rest/v1/patients'&&r.status===200&&r.reason==='net::ERR_ABORTED'));
  assert.equal(screens.length,entryReview?39:24);for(const s of screens)assert.ok(s.overflow<=1&&s.dialogHorizontalOverflow<=1&&!s.dialogOutsideViewport&&s.dialogActionReachable!==false&&!s.missingLabels.length&&!s.missingButtons.length&&!s.brokenText.length,'Post consultation layout clipped');
}

async function auditEntries({api,page,post,take,width,checks}){
  for(const entry of ['instruction','followup']){
    const label=entry==='instruction'?'Registrar orientações':'Planejar retorno',content='Registro sintético explícito '+entry,button=post.getByRole('button',{name:label,exact:true}),before=api.postConsultation.writes.length;
    await button.focus();await button.press('Enter');const dialog=page.getByRole('dialog'),close=dialog.locator(':scope > button');
    await take('entry-'+entry,async()=>{
      await expect(dialog.getByLabel('Tipo de registro',{exact:true})).toHaveValue(entry==='instruction'?'instruction':'task');
      await expect(dialog.getByLabel('Título do registro',{exact:true})).toHaveValue(entry==='instruction'?'Orientações da consulta':'Planejamento de retorno');
      if(entry==='followup'){await expect(dialog.getByLabel('Fluxo de acompanhamento',{exact:true})).toHaveValue('followup');await expect(dialog.getByLabel('Prazo da tarefa',{exact:true})).toHaveValue('');}
    });
    await dialog.getByLabel('Conteúdo do registro',{exact:true}).fill(content);
    if(entry==='instruction'){
      page.once('dialog',d=>d.dismiss());await close.click();await take('entry-unsaved',async()=>{await expect(dialog.getByLabel('Conteúdo do registro',{exact:true})).toHaveValue(content);});
      if(width===375){
        await dialog.getByLabel('Tipo de registro',{exact:true}).selectOption('draft');await page.waitForTimeout(1400);
        assert.equal(api.postConsultation.writes.length,before,'Changing type must not enable autosave');
        await take('entry-type-change',async()=>{await expect(dialog.getByLabel('Conteúdo do registro',{exact:true})).toHaveValue(content);await expect(dialog.getByLabel('Tipo de registro',{exact:true})).toHaveValue('draft');});
        await dialog.getByLabel('Tipo de registro',{exact:true}).selectOption('instruction');await dialog.getByLabel('Título do registro',{exact:true}).fill('Orientações da consulta');
        checks.push({width,typeChangeDoesNotAutosave:true,typedContentPreserved:true});
      }
    }else await dialog.getByLabel('Prazo da tarefa',{exact:true}).fill('2026-11-20');
    await page.waitForTimeout(1400);assert.equal(api.postConsultation.writes.length,before,'Instruction/followup must not autosave');
    await dialog.getByRole('button',{name:'Salvar',exact:true}).click();
    await take('entry-'+entry+'-saved',async()=>{await expect(dialog.getByText(/^Salvo às/)).toBeVisible();});
    assert.equal(api.postConsultation.writes.length,before+1);const saved=api.postConsultation.writes.at(-1).body;
    assert.equal(saved.patient_id,patientId);assert.equal(saved.content,content);assert.equal(saved.status,entry==='instruction'?'draft':'open');assert.ok(!Object.hasOwn(saved.details,'appointmentId'));
    if(entry==='followup'){assert.equal(saved.details.workflow,'followup');assert.equal(saved.due_date,'2026-11-20');}
    await close.click();await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
    checks.push({width,entry,explicitInsertOnly:true,patientBound:true,noAppointmentInferred:true,neutralTitle:true,savedStatus:saved.status,focusReturned:true});
  }
}
