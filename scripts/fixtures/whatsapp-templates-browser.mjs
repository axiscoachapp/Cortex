import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export function assertTemplateReadRequests(requests) {
 const allowed=new Set(['POST /auth/v1/token','GET /auth/v1/user','POST /rest/v1/rpc/clinic_access','POST /functions/v1/whatsapp-api']);
 for(const entry of requests)assert.ok(allowed.has(entry.method+' '+entry.path),'Unexpected route request: '+entry.method+' '+entry.path);
}

export async function auditWhatsAppTemplates({api,app,scene,capture,checks,requests,screens,errors,consoleErrors,failedRequests,errorResponses,blocked}) {
 const path='/recepcao?view=conversations&status=open',role='recepcao-a',original=api.whatsappRead.snapshotTemplates();
 for(const width of [320,375,1280,1920]){
  api.whatsappRead.setTemplates(original);api.whatsappRead.setFailure('templates',null);api.whatsappRead.setFailure('state',null);
  const page=await scene(app,role,path);
  await capture(page,app,role,path,width,async()=>{await expect(page.getByRole('button',{name:'Consultar modelos'})).toBeVisible();},'templates-collapsed',{navigate:false});
  const before=api.whatsappRead.calls.filter(c=>c.input.action==='templates').length;
  const openConversation=page.getByRole('button',{name:'Abrir conversa com Contato sintético A'});await openConversation.click();await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();
  const trigger=page.getByRole('button',{name:'Consultar modelos'});await trigger.focus();await trigger.press('Enter');
  const region=page.getByRole('region',{name:'Modelos de mensagem'}),choice=region.getByLabel('Modelo e idioma');
  await expect(choice).toBeVisible();await expect(region.getByRole('heading',{name:'Modelos de mensagem'})).toBeFocused();
  assert.equal(api.whatsappRead.calls.filter(c=>c.input.action==='templates').length,before+1);
  await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();
  await capture(page,app,role,path,width,async()=>{await expect(choice).toHaveValue('');},'templates-choose',{navigate:false});
  await choice.selectOption(JSON.stringify([original[0].name,original[0].language]));
  await capture(page,app,role,path,width,async()=>{await expect(region.getByText(original[0].body,{exact:true})).toBeVisible();await expect(region.locator('a,b,img,script')).toHaveCount(0);},'templates-literal',{navigate:false});
  if(width<=375)await capture(page,app,role,path,width,async()=>{const body=region.getByText(original[0].body,{exact:true});await body.scrollIntoViewIfNeeded();await expect(body).toBeInViewport();const box=await body.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1);},'templates-literal-body',{navigate:false,viewportOnly:true});
  await choice.selectOption(JSON.stringify([original[1].name,original[1].language]));
  await capture(page,app,role,path,width,async()=>{await expect(region.getByText('Segundo idioma sintético.',{exact:true})).toBeVisible();await expect(region.getByText('FUTURE_STATUS',{exact:true})).toBeVisible();},'templates-other-language',{navigate:false});
  await choice.selectOption(JSON.stringify([original[2].name,original[2].language]));
  await capture(page,app,role,path,width,async()=>{await expect(region.getByRole('heading',{name:original[2].name+' ('+original[2].language+')',exact:true})).toBeVisible();},'templates-long',{navigate:false});
  const metrics=await region.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('button,select')].map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,name:n.textContent?.slice(0,70)}))}));assert.ok(metrics.scroll<=metrics.width+1);for(const target of metrics.buttons){assert.ok(target.height>=43.9);assert.ok(target.width>=43.9);}
  await region.getByRole('button',{name:'Atualizar modelos'}).click();await expect(choice).toHaveValue('');await expect(region.getByText(original[2].body,{exact:true})).toHaveCount(0);
  api.whatsappRead.setTemplates([]);await region.getByRole('button',{name:'Atualizar modelos'}).click();
  await capture(page,app,role,path,width,async()=>{await expect(region.getByText('Nenhum modelo armazenado foi encontrado.',{exact:true})).toBeVisible();await expect(choice).toHaveCount(0);},'templates-empty',{navigate:false});
  api.whatsappRead.setFailure('templates','forbidden');await region.getByRole('button',{name:'Atualizar modelos'}).click();
  await capture(page,app,role,path,width,async()=>{await expect(region.getByRole('alert')).toContainText('Não foi possível carregar os modelos.');await expect(choice).toHaveCount(0);},'templates-read-error',{navigate:false});
  api.whatsappRead.setFailure('templates',null);api.whatsappRead.setTemplates(original);api.whatsappRead.setFailure('state','forbidden');await region.getByRole('button',{name:'Atualizar modelos'}).click();
  await capture(page,app,role,path,width,async()=>{await expect(region.getByRole('alert')).toContainText('Não foi possível verificar o acesso aos modelos.');await expect(choice).toHaveCount(0);},'templates-access-error',{navigate:false});
  api.whatsappRead.setFailure('state',null);await region.getByRole('button',{name:'Atualizar modelos'}).click();
  await capture(page,app,role,path,width,async()=>{await expect(choice).toBeVisible();await expect(choice).toHaveValue('');},'templates-recovered',{navigate:false});
  const hide=page.getByRole('button',{name:'Ocultar modelos'});await hide.focus();await hide.press('Enter');await expect(region).toHaveCount(0);await expect(page.getByRole('button',{name:'Consultar modelos'})).toBeFocused();await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();
  checks.push({width,metrics,selectionCleared:true,literal:true,recovered:true,conversationPreserved:true,closedFocusRestored:true});
 }
 const admin=await scene(app,'admin',path);await capture(admin,app,'admin',path,1280,async()=>{await admin.getByRole('button',{name:'Consultar modelos'}).click();await expect(admin.getByLabel('Modelo e idioma')).toBeVisible();},'templates-admin',{navigate:false});
 for(const apiCall of api.whatsappRead.calls){assert.ok(['state','templates','conversations','messages','botSession'].includes(apiCall.input.action),'Unexpected write');if(apiCall.input.action==='templates')assert.deepEqual(apiCall.input,{action:'templates'});}
 assertTemplateReadRequests(requests);
 const actions=api.whatsappRead.calls.reduce((a,c)=>(a[c.input.action]=(a[c.input.action]??0)+1,a),{});
 assert.equal(errors.length,0);assert.equal(failedRequests.length,0);assert.equal(blocked.length,0);assert.equal(consoleErrors.length,8);assert.ok(consoleErrors.every(r=>/403/.test(r.message)));assert.equal(errorResponses.length,8);assert.ok(errorResponses.every(r=>r.status===403&&r.path==='/functions/v1/whatsapp-api'));
 for(const key of ['clinicalReads','externalCalls','unknown'])assert.deepEqual(api.metrics[key],[]);
 for(const key of ['bookings','contacts','caseWrites'])assert.equal(api.metrics[key],0);
 for(const screen of screens){assert.ok(screen.overflow<=1&&!screen.dialogOutsideViewport&&!screen.recoveryScreen);for(const key of ['missingButtons','missingLabels','brokenText'])assert.deepEqual(screen[key],[]);}
 checks.push({actions,expected403:8,jsErrors:errors.length,failedRequests:failedRequests.length,external:blocked.length,screens:screens.length});
}
