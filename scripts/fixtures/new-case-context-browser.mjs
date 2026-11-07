import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
export async function auditNewCaseContext({api,app,scene,capture,checks,requests,screens,errors,consoleErrors,failedRequests,errorResponses,blocked}) {
 const path='/recepcao?status=open',role='recepcao-a';let denied=0;
 const take=(page,width,variant,action)=>capture(page,app,role,path,width,action,'new-case-context-'+variant,{navigate:false,viewportOnly:true});
 for(const width of [320,375,1280,1920]){
  const page=await scene(app,role,path);let failNext=false;
  await page.route(api.origin+'/rest/v1/rpc/clinic_access',async route=>{if(route.request().method()==='OPTIONS')return route.continue();assert.equal(route.request().method(),'POST');if(!failNext)return route.continue();failNext=false;denied++;return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':app.origin},body:JSON.stringify({code:'PGRST000',message:'Synthetic access unavailable',details:null,hint:null})});});
  await page.getByRole('button',{name:'Novo atendimento',exact:true}).click();const modal=page.getByRole('dialog',{name:'Novo atendimento'});await modal.getByLabel('Buscar contato por nome ou telefone').fill('Fam');await modal.getByRole('button',{name:/^Selecionar contato Família Exemplo/}).click();await modal.getByLabel('Assunto administrativo').fill('Rascunho administrativo sintético');
  await take(page,width,'draft',async()=>{await expect(modal.getByText('Família Exemplo',{exact:true})).toBeVisible();await expect(modal.getByLabel('Assunto administrativo')).toHaveValue('Rascunho administrativo sintético');});
  failNext=true;await expect(page.getByRole('heading',{name:'Verificação de acesso',exact:true})).toBeVisible({timeout:20_000});
  await take(page,width,'access-blocked',async()=>{await expect(modal).toHaveCount(0);await expect(page.getByLabel('Assunto administrativo')).toHaveCount(0);await expect(page.getByRole('button',{name:'Adicionar à fila',exact:true})).toHaveCount(0);});
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await take(page,width,'recovered-invalid',async()=>{await expect(modal.getByRole('alert')).toContainText('A verificação deste atendimento foi interrompida.');await expect(modal.getByLabel('Assunto administrativo')).toHaveCount(0);await expect(modal.getByText('Família Exemplo',{exact:true})).toHaveCount(0);await expect(modal.getByRole('button',{name:'Fechar atendimento'})).toBeVisible();});
  await modal.getByRole('button',{name:'Fechar atendimento'}).click();await take(page,width,'closed',async()=>{await expect(modal).toHaveCount(0);});
  await page.getByRole('button',{name:'Novo atendimento',exact:true}).click();await take(page,width,'fresh-window',async()=>{await expect(modal.getByLabel('Assunto administrativo')).toHaveValue('');await expect(modal.getByLabel('Buscar contato por nome ou telefone')).toHaveValue('');await expect(modal.getByText('Família Exemplo',{exact:true})).toHaveCount(0);});await modal.getByRole('button',{name:'Cancelar',exact:true}).click();
  checks.push({width,retainedWorkspaceActuallyBlocked:true,privateDialogRemoved:true,recoveredContextDoesNotReviveDraft:true,explicitCloseThenFreshWindow:true,noSubmission:true});
 }
 const allowed=new Set(['POST /auth/v1/token','GET /auth/v1/user','POST /rest/v1/rpc/clinic_access','POST /rest/v1/rpc/reception_queue','POST /rest/v1/rpc/reception_contacts']);for(const r of requests)assert.ok(allowed.has(r.method+' '+r.path),'Unexpected request: '+r.method+' '+r.path);
 for(const key of ['clinicalReads','externalCalls','unknown'])assert.deepEqual(api.metrics[key],[]);for(const key of ['contacts','caseWrites','bookings'])assert.equal(api.metrics[key],0);for(const items of [errors,failedRequests,blocked])assert.deepEqual(items,[]);
 assert.equal(denied,4);assert.equal(errorResponses.length,4);assert.ok(errorResponses.every(r=>r.status===503&&r.path==='/rest/v1/rpc/clinic_access'));assert.equal(consoleErrors.length,4);assert.ok(consoleErrors.every(r=>/503/.test(r.message)));assert.equal(screens.length,20);
 for(const screen of screens){assert.ok(screen.overflow<=1&&!screen.recoveryScreen&&!screen.dialogOutsideViewport&&screen.dialogHorizontalOverflow<=1&&screen.dialogActionReachable!==false);for(const key of ['missingButtons','missingLabels','brokenText'])assert.deepEqual(screen[key],[]);}
 checks.push({states:screens.length,requests:requests.length,expected503:4,zeroWrites:true,lateAsyncBoundaries:'unit tests only'});
}
