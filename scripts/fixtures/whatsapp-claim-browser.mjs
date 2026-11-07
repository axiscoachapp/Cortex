import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {whatsappReadIds} from './whatsapp-read-api.mjs';
import {ids} from './reception-api.mjs';

export async function auditWhatsAppClaim({api,app,scene,capture,checks,screens,errors,consoleErrors,errorResponses,failedRequests,blocked,requests}){
  const fixture=api.whatsappRead,path='/recepcao?view=conversations&status=open',role='recepcao-a';
  const open=async page=>{await page.getByRole('button',{name:'Abrir conversa com Contato sintético B'}).click();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toBeEnabled();};
  const take=(page,width,variant,action)=>capture(page,app,role,path,width,action,'claim-'+variant,{navigate:false,viewportOnly:true});
  for(const width of [320,375,1280,1920]){
    fixture.resetClaims();let page=await scene(app,role,path);await open(page);let before=fixture.claimCalls.length;
    await take(page,width,'available',async()=>{const button=page.getByRole('button',{name:'Assumir conversa',exact:true});await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box&&box.height>=44&&box.width<=width);assert.equal(fixture.claimCalls.length,before);});
    let release;const hold=new Promise(resolve=>{release=resolve;});let intercepted=false;
    await page.route(api.origin+'/functions/v1/whatsapp-api',async route=>{if(route.request().postDataJSON().action==='act'){intercepted=true;await hold;}await route.continue();});
    try{await page.getByRole('button',{name:'Assumir conversa',exact:true}).click();await expect.poll(()=>intercepted).toBe(true);await take(page,width,'pending',async()=>{await expect(page.getByRole('button',{name:'Assumindo…',exact:true})).toBeDisabled();assert.equal(fixture.claimCalls.length,before);});}finally{release();}
    await take(page,width,'confirmed',async()=>{await expect(page.getByText('Dados atualizados. Confira o responsável atual na conversa.',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Conversa selecionada'}).getByText('Você',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toHaveCount(0);});
    assert.equal(fixture.claimCalls.length,before+1);assert.equal(fixture.claimCalls.at(-1).applied,true);await page.unroute(api.origin+'/functions/v1/whatsapp-api');
    await page.getByLabel('Filtrar conversas',{exact:true}).selectOption('closed');await page.getByRole('button',{name:'Abrir conversa com Contato sintético encerrado'}).click();
    await take(page,width,'closed',async()=>{await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toHaveCount(0);});assert.equal(fixture.claimCalls.length,before+1);
    fixture.resetClaims();fixture.setClaimMode('stale');page=await scene(app,role,path);await open(page);before=fixture.claimCalls.length;await page.getByRole('button',{name:'Assumir conversa',exact:true}).click();
    await take(page,width,'stale-other-owner',async()=>{await expect(page.getByText('Dados atualizados. Confira o responsável atual na conversa.',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Conversa selecionada'}).getByText('Outra pessoa',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toHaveCount(0);});assert.equal(fixture.claimCalls.length,before+1);assert.equal(fixture.claimCalls.at(-1).status,409);assert.equal(fixture.claimCalls.at(-1).applied,false);
    fixture.resetClaims();fixture.setClaimMode('unconfirmed');page=await scene(app,role,path);await open(page);before=fixture.claimCalls.length;fixture.setFailure('messages','forbidden');await page.getByRole('button',{name:'Assumir conversa',exact:true}).click();
    await take(page,width,'reconciliation-refused',async()=>{await expect(page.getByRole('button',{name:'Conferir responsável',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toHaveCount(0);await expect(page.getByText('Dados atualizados. Confira o responsável atual na conversa.',{exact:true})).toHaveCount(0);});assert.equal(fixture.claimCalls.length,before+1);assert.equal(fixture.claimCalls.at(-1).applied,true);
    fixture.setFailure('messages',null);await page.getByRole('button',{name:'Conferir responsável',exact:true}).click();
    await take(page,width,'reconciled-without-command',async()=>{await expect(page.getByText('Dados atualizados. Confira o responsável atual na conversa.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Assumir conversa',exact:true})).toHaveCount(0);});assert.equal(fixture.claimCalls.length,before+1);
    const rows=fixture.snapshotRows(),second=rows.find(row=>row.id===whatsappReadIds.second);assert.equal(second.assignedTo,ids.a);assert.equal(second.revision,2);assert.equal(second.contactId,null);assert.equal(second.caseId,null);assert.equal(second.queue,'geral');
    checks.push({width,commands:3,applied:2,conflict:1,noCommandOnOpenOrRetry:true,noReopenOrTransfer:true,freshOwnerRead:true});
  }
  assert.equal(fixture.claimCalls.length,12);assert.equal(fixture.claimCalls.filter(c=>c.applied).length,8);assert.ok(fixture.claimCalls.every(c=>c.actor===ids.a&&c.conversationId===whatsappReadIds.second&&c.revision===1));
  assert.ok(fixture.calls.every(c=>['state','conversations','messages','botSession','act'].includes(c.input.action)));assert.ok(fixture.calls.filter(c=>c.input.action==='act').every(c=>Object.keys(c.input).sort().join(',')==='action,conversationId,operation,revision'&&c.input.operation==='assign'));
  assert.ok(requests.every(r=>['/auth/v1/token','/auth/v1/user','/rest/v1/rpc/clinic_access','/functions/v1/whatsapp-api'].includes(r.path)));
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failedRequests,[]);assert.equal(errorResponses.filter(r=>r.status===409).length,4);assert.ok(errorResponses.every(r=>[403,409].includes(r.status)));assert.equal(consoleErrors.length,errorResponses.length);assert.ok(consoleErrors.every(r=>/403|409/.test(r.message)));
  assert.equal(screens.length,28);for(const s of screens)assert.ok(s.overflow<=1&&s.dialogHorizontalOverflow<=1&&!s.dialogOutsideViewport&&s.dialogActionReachable!==false&&!s.recoveryScreen&&!s.missingButtons.length&&!s.missingLabels.length&&!s.brokenText.length,'Claim UI layout clipped');
}
