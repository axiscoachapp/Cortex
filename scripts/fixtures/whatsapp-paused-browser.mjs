import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { assertTemplateReadRequests } from './whatsapp-templates-browser.mjs';
export async function auditWhatsAppPaused({api,app,scene,capture,checks,requests,screens,errors,consoleErrors,failedRequests,errorResponses,blocked}) {
 const path='/recepcao?view=conversations&status=open',role='recepcao-a',original=api.whatsappRead.snapshotRows();
 const take=(page,width,variant,action)=>capture(page,app,role,path,width,action,'paused-'+variant,{navigate:false,viewportOnly:true});
 for(const width of [320,375,1280,1920]){
  const page=await scene(app,role,path),context=page.context();
  const message=page.getByText('Mensagem sintética recebida',{exact:true}),detail=page.getByRole('region',{name:'Conversa selecionada'}),rows=page.getByRole('button',{name:/^Abrir conversa com/});
  await take(page,width,'list',async()=>{await expect(rows).toHaveCount(2);});
  await page.getByRole('button',{name:'Abrir conversa com Contato sintético A'}).click();await expect(message).toBeVisible();await expect(page.getByText('Médico sintético',{exact:true})).toBeVisible();
  await take(page,width,'detail',async()=>{await expect(page.getByRole('button',{name:'Encerrar conversa'})).toBeVisible();});
  const beforeMessages=api.whatsappRead.calls.filter(c=>c.input.action==='messages').length;
  await context.setOffline(true);
  try {
   await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);
   await detail.getByRole('button',{name:'Atualizar mensagens'}).click();
   await take(page,width,'messages',async()=>{const waiting=detail.getByText('Aguardando conexão de rede para carregar as mensagens…',{exact:true});await expect(waiting).toBeVisible();await waiting.scrollIntoViewIfNeeded();await expect(message).toHaveCount(0);await expect(page.getByRole('button',{name:'Encerrar conversa'})).toHaveCount(0);await expect(detail.getByRole('button',{name:'Atualizar mensagens'})).toBeDisabled();});
   assert.equal(api.whatsappRead.calls.filter(c=>c.input.action==='messages').length,beforeMessages);
  } finally { await context.setOffline(false); }
  await take(page,width,'messages-resumed',async()=>{await expect(message).toBeVisible();await expect(page.getByRole('button',{name:'Encerrar conversa'})).toBeEnabled();});
  assert.equal(api.whatsappRead.calls.filter(c=>c.input.action==='messages').length,beforeMessages+1);
  const beforeList=api.whatsappRead.calls.filter(c=>c.input.action==='conversations').length;
  await context.setOffline(true);
  try {
   await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);
   await page.getByRole('button',{name:'Atualizar conversas'}).click();
   await take(page,width,'list-waiting',async()=>{const waiting=page.getByText('Aguardando conexão de rede para carregar as conversas…',{exact:true});await expect(waiting).toBeVisible();await waiting.scrollIntoViewIfNeeded();await expect(rows).toHaveCount(0);await expect(detail).toHaveCount(0);await expect(page.getByRole('button',{name:'Atualizar conversas'})).toBeDisabled();});
   assert.equal(api.whatsappRead.calls.filter(c=>c.input.action==='conversations').length,beforeList);
  } finally { await context.setOffline(false); }
  await take(page,width,'list-resumed',async()=>{await expect(rows).toHaveCount(2);await expect(message).toBeVisible();await expect(page.getByRole('alertdialog')).toHaveCount(0);});
  assert.equal(api.whatsappRead.calls.filter(c=>c.input.action==='conversations').length,beforeList+1);
  if(width===375){
   api.whatsappRead.setFailure('messages','forbidden');await context.setOffline(true);
   try{await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);await detail.getByRole('button',{name:'Atualizar mensagens'}).click();await take(page,width,'denied-waiting',async()=>{await expect(detail.getByText('Aguardando conexão de rede para carregar as mensagens…',{exact:true})).toBeVisible();await expect(message).toHaveCount(0);});}
   finally{await context.setOffline(false);}
   await take(page,width,'denied',async()=>{const retry=detail.getByRole('button',{name:'Tentar carregar mensagens'});await expect(retry).toBeVisible();await retry.scrollIntoViewIfNeeded();await expect(message).toHaveCount(0);await expect(page.getByRole('button',{name:'Encerrar conversa'})).toHaveCount(0);});
   api.whatsappRead.setFailure('messages',null);await detail.getByRole('button',{name:'Tentar carregar mensagens'}).click();await take(page,width,'recovered',async()=>{await expect(message).toBeVisible();await expect(page.getByRole('button',{name:'Encerrar conversa'})).toBeEnabled();});
  }
  checks.push({width,messagesPausedBeforeTransport:true,listPausedBeforeTransport:true,readsResumeOnce:true,noCommandsOrOldDataDuringPause:true,noUnexpectedConfirmation:true});
 }
 assertTemplateReadRequests(requests);
 assert.ok(api.whatsappRead.calls.every(c=>['state','conversations','messages','botSession'].includes(c.input.action)));
 assert.deepEqual(api.whatsappRead.snapshotRows(),original);
 for(const key of ['clinicalReads','externalCalls','unknown'])assert.deepEqual(api.metrics[key],[]);
 for(const key of ['bookings','contacts','caseWrites'])assert.equal(api.metrics[key],0);
 assert.equal(errors.length,0);assert.equal(failedRequests.length,0);assert.equal(blocked.length,0);assert.equal(errorResponses.length,1);assert.ok(errorResponses.every(e=>e.status===403&&e.path==='/functions/v1/whatsapp-api'));assert.equal(consoleErrors.length,1);assert.ok(consoleErrors.every(e=>/403/.test(e.message)));
 assert.equal(screens.length,27);for(const screen of screens){assert.ok(screen.overflow<=1&&!screen.recoveryScreen&&!screen.dialogOutsideViewport);for(const key of ['missingButtons','missingLabels','brokenText'])assert.deepEqual(screen[key],[]);}
 checks.push({screens:screens.length,requests:requests.length,fixtureCalls:api.whatsappRead.calls.length,expected403:1,rowsUnchanged:true,zeroWrites:true});
}
