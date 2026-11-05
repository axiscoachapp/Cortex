// Real reception case, booking form and API; synthetic loopback traffic only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/booking-relationship-recovery/browser');await mkdir(folder,{recursive:true});
const paths=['src/features/reception/BookingDialog.tsx','src/features/reception/CaseWorkspace.tsx','src/features/reception/api.ts','src/features/reception/contracts.ts','src/features/reception/useRequestId.ts','src/hooks/useUnsavedChanges.ts','src/features/reception/linkRelationships.ts','scripts/fixtures/link-relationship-editor-page.tsx'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');const sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',doctor='88888888-8888-4888-8888-888888888888',caseId='99999999-9999-4999-8999-999999999999';
let browser,report;const errors=[],scenarios=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(denied=false){
  const context=await browser.newContext({viewport:{width:375,height:950},locale:'pt-BR'}),calls=[];let relationship='guardian',conflict=!denied,lost=true,reads=0;const operations=new Map();
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   const beneficiary={id:patientId,name:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorId:doctor,relationship};
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:'reception',active:true,admin:false,clinic:{id:clinic,name:'Clínica sintética'},doctors:[{id:doctor,name:'Médico sintético',specialty:null}],staff:[]});
   if(name==='reception_case')return reply(route,{id:caseId,clinicId:clinic,contactId:contact,contactName:'Contato sintético',phone:'',doctorId:doctor,subject:'Atendimento sintético',kind:'scheduling',status:'assigned',assignedTo:uid,revision:1,createdAt:new Date().toISOString(),beneficiaries:[beneficiary],eligibleAssignees:[{id:uid,name:'Operador sintético'}],notes:[],noteCount:0,draft:{body:'',revision:0}});
   if(name==='reception_contact'){
    reads++;if(denied&&reads>1)return reply(route,{code:'42501',message:'Synthetic permission withdrawn'},403);
    return reply(route,{id:contact,clinicId:clinic,name:'Contato sintético',phone:'',beneficiaries:[beneficiary]});
   }
   if(name==='reception_link_patient'){
    assert.deepEqual(body,{p_contact:contact,p_doctor:doctor,p_patient:patientId,p_relationship:relationship});
    if(conflict){conflict=false;relationship='family';return reply(route,{code:'40001',message:'Synthetic corrected relationship'},409);}
    return reply(route,true);
   }
   assert.equal(name,'reception_book_appointment','Only existing scheduling writers are allowed');assert.equal(denied,false);
   assert.equal(body.p_clinic,clinic);assert.deepEqual(body.p_details,{doctorId:doctor,contactId:contact,patientId,caseId,startTime:'2099-11-03T17:00:00.000Z',endTime:'2099-11-03T17:30:00.000Z',type:'retorno'});
   assert.match(body.p_request,/^[0-9a-f-]{36}$/);if(operations.has(body.p_request))assert.deepEqual(operations.get(body.p_request),body);else operations.set(body.p_request,body);
   if(lost){lost=false;return reply(route,{code:'XX000',message:'Synthetic response lost after commit'},503);}return reply(route,'55555555-5555-4555-8555-555555555555');
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/link-relationship-editor.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await page.getByRole('button',{name:'Agendar consulta',exact:true}).click();
  await page.getByRole('button',{name:/Beneficiário sintético/}).click();await page.getByLabel('Data',{exact:true}).fill('2099-11-03');await page.getByLabel('Início',{exact:true}).fill('14:00');await page.getByLabel('Término',{exact:true}).fill('14:30');
  return {context,page,calls,operations};
 }
 const main=await scene();const relation=main.page.getByLabel('Relação do contato com o paciente'),confirm=main.page.getByRole('checkbox',{name:/Conferi o paciente/}),save=main.page.getByRole('button',{name:'Confirmar agendamento',exact:true});
 await confirm.check();await save.click();await expect(main.page.getByRole('alert')).toContainText('mudaram');await expect(relation).toHaveValue('guardian');assert.equal(main.calls.filter(c=>c.name==='reception_book_appointment').length,0);
 await main.page.getByRole('button',{name:'Recuperar vínculo selecionado'}).click();await expect(relation).toHaveValue('family');await expect(confirm).not.toBeChecked();await expect(save).toBeDisabled();await expect(main.page.getByLabel('Início',{exact:true})).toHaveValue('14:00');await expect(main.page.getByLabel('Término',{exact:true})).toHaveValue('14:30');assert.equal(main.calls.filter(c=>c.name==='reception_link_patient').length,1);
 await main.page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});await expect(main.page.getByRole('heading',{name:'Confirmar agendamento',exact:true})).toBeInViewport();await main.page.screenshot({path:resolve(folder,'booking-top-mobile.png')});
 await confirm.check();await save.click();await expect(main.page.getByRole('alert')).toContainText('preservados');assert.equal(main.operations.size,1);
 await main.page.getByRole('button',{name:'Recuperar vínculo selecionado'}).click();await expect(confirm).not.toBeChecked();await expect(main.page.getByRole('button',{name:'Recuperar vínculo selecionado'})).toBeEnabled();await expect(save).toBeDisabled();assert.equal(main.calls.filter(c=>c.name==='reception_book_appointment').length,1);
 await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();const box=await main.page.getByRole('dialog').boundingBox();assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=376&&box.y+box.height<=951);await main.page.screenshot({path:resolve(folder,'booking-review-mobile.png')});
 await confirm.check();await save.click();await expect(main.page.getByRole('dialog')).toHaveCount(0);const books=main.calls.filter(c=>c.name==='reception_book_appointment');assert.equal(books.length,2);assert.deepEqual(books[0].body,books[1].body);assert.equal(main.operations.size,1);scenarios.push({denied:false,calls:main.calls,uniqueBookings:main.operations.size});await main.context.close();
 const denied=await scene(true);await denied.page.getByRole('checkbox',{name:/Conferi o paciente/}).check();await denied.page.getByRole('button',{name:'Recuperar vínculo selecionado'}).click();await expect(denied.page.getByRole('alert')).toContainText('permissão');await expect(denied.page.getByLabel('Relação do contato com o paciente')).toHaveValue('guardian');await expect(denied.page.getByRole('checkbox',{name:/Conferi o paciente/})).not.toBeChecked();await expect(denied.page.getByRole('button',{name:'Confirmar agendamento',exact:true})).toBeDisabled();assert.equal(denied.calls.filter(c=>['reception_link_patient','reception_book_appointment'].includes(c.name)).length,0);scenarios.push({denied:true,calls:denied.calls});await denied.context.close();
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(await hash(source.path),source.sha256,'Source changed during browser run');
 report={syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['stale confirmation refused without booking','explicit recovery preserves beneficiary and slot','fresh human confirmation required','ambiguous booking retries same request and payload','recovery with permission withdrawn blocks writers','375px top and review reachable inside viewport'],scenarios,pageErrors:errors,sources};
}finally{if(browser)await browser.close();await server.close();await api.close();}
await writeFile(resolve(folder,'verification.json'),JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log('Six booking-relationship recovery browser checks passed.');
