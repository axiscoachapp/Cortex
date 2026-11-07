import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
export async function auditContactSearch({api,app,scene,capture,checks,requests,screens,errors,consoleErrors,failedRequests,errorResponses,blocked}) {
 const path='/recepcao?status=open',role='recepcao-a';let interceptedDenials=0;
 const take=(page,width,variant,action)=>capture(page,app,role,path,width,action,'contact-search-'+variant,{navigate:false,viewportOnly:true});
 for(const width of [320,375,1280,1920]){
  const page=await scene(app,role,path);let denied=false;
  await page.route(api.origin+'/rest/v1/rpc/reception_contacts',async route=>{if(route.request().method()==='OPTIONS')return route.continue();assert.equal(route.request().method(),'POST');if(!denied)return route.continue();interceptedDenials++;return route.fulfill({status:403,contentType:'application/json',headers:{'Access-Control-Allow-Origin':app.origin},body:JSON.stringify({code:'42501',message:'PRIVATE SYNTHETIC SEARCH',details:null,hint:null})});});
  await page.getByRole('button',{name:'Novo atendimento',exact:true}).click();const dialog=page.getByRole('dialog'),input=dialog.getByLabel('Buscar contato por nome ou telefone'),subject=dialog.getByLabel('Assunto administrativo'),result=dialog.getByRole('button',{name:/^Selecionar contato Família Exemplo/});
  await take(page,width,'opened',async()=>{await expect(input).toBeVisible();await expect(result).toHaveCount(0);});
  await input.fill('Fam');await take(page,width,'results',async()=>{await expect(result).toBeVisible();const b=await result.boundingBox();assert.ok(b&&b.height>=43.9);});
  await subject.fill('Assunto administrativo sintético');await dialog.getByLabel('Novo contato',{exact:true}).check();await take(page,width,'new-mode',async()=>{await expect(input).toHaveCount(0);await expect(subject).toHaveValue('Assunto administrativo sintético');});
  await dialog.getByLabel('Contato existente',{exact:true}).check();await take(page,width,'existing-reset',async()=>{await expect(input).toHaveValue('');await expect(subject).toHaveValue('Assunto administrativo sintético');await expect(result).toHaveCount(0);});
  denied=true;await input.fill('Fam');await take(page,width,'error',async()=>{await expect(dialog.getByRole('alert')).toContainText('Não foi possível buscar contatos.');await expect(result).toHaveCount(0);await expect(dialog).not.toContainText('PRIVATE');await expect(dialog.getByText(/Nenhum contato encontrado/)).toHaveCount(0);await expect(input).toHaveValue('Fam');await expect(input).toBeFocused();});
  denied=false;await dialog.getByRole('button',{name:'Tentar buscar contatos',exact:true}).click();await take(page,width,'recovered',async()=>{await expect(result).toBeVisible();await expect(subject).toHaveValue('Assunto administrativo sintético');});
  await result.click();await take(page,width,'selected',async()=>{await expect(dialog.getByText('Família Exemplo',{exact:true})).toBeVisible();await expect(input).toHaveCount(0);await expect(subject).toHaveValue('Assunto administrativo sintético');});
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();await take(page,width,'closed',async()=>{await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Novo atendimento',exact:true})).toBeVisible();});
  checks.push({width,newCaseSharedPicker:true,explicitSelection:true,modeResetSearchOnly:true,subjectPreserved:true,readErrorAndExplicitRetry:true,noRecordCreated:true});
 }
 const agendaPath='/recepcao/agenda',page=await scene(app,role,agendaPath);await page.getByRole('button',{name:'Novo agendamento',exact:true}).click();const booking=page.getByRole('dialog',{name:'Confirmar agendamento'}),input=booking.getByLabel('Buscar contato por nome ou telefone'),result=booking.getByRole('button',{name:/^Selecionar contato Família Exemplo/});
 const bookTake=(variant,action)=>capture(page,app,role,agendaPath,375,action,'contact-search-booking-'+variant,{navigate:false,viewportOnly:true});
 await bookTake('opened',async()=>{await expect(input).toBeVisible();});await input.fill('Fam');await bookTake('results',async()=>{await expect(result).toBeVisible();});await result.click();await bookTake('selected',async()=>{await expect(booking.getByText('Contato: Família Exemplo',{exact:true})).toBeVisible();await expect(input).toHaveCount(0);});
 const reads=new Set(['POST /auth/v1/token','GET /auth/v1/user','POST /rest/v1/rpc/clinic_access','POST /rest/v1/rpc/reception_queue','POST /rest/v1/rpc/reception_contacts','POST /rest/v1/rpc/reception_appointments','POST /rest/v1/rpc/reception_contact','POST /rest/v1/rpc/reception_team_doctors']);
 for(const r of requests)assert.ok(reads.has(r.method+' '+r.path),'Unexpected request: '+r.method+' '+r.path);
 for(const key of ['clinicalReads','unknown','externalCalls'])assert.deepEqual(api.metrics[key],[]);for(const key of ['contacts','bookings','caseWrites'])assert.equal(api.metrics[key],0);
 assert.equal(interceptedDenials,4);assert.equal(errorResponses.length,4);assert.ok(errorResponses.every(r=>r.status===403&&r.path==='/rest/v1/rpc/reception_contacts'));assert.equal(consoleErrors.length,4);assert.ok(consoleErrors.every(r=>/403/.test(r.message)));for(const collection of [errors,failedRequests,blocked])assert.deepEqual(collection,[]);
 assert.equal(screens.length,35);for(const screen of screens){assert.ok(screen.overflow<=1&&!screen.recoveryScreen&&!screen.dialogOutsideViewport&&screen.dialogHorizontalOverflow<=1&&screen.dialogActionReachable!==false);for(const key of ['missingButtons','missingLabels','brokenText'])assert.deepEqual(screen[key],[]);}
 checks.push({agendaSharedPicker:true,noBooking:true,requests:requests.length,interceptedDenials,expected403:4,screens:screens.length});
}
