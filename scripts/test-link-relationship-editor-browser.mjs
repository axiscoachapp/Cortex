// Real CaseWorkspace/editor/API/exit guard, synthetic loopback HTTP only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/link-relationship-editor/browser');await mkdir(folder,{recursive:true});
const sources=await Promise.all(['src/features/reception/CaseWorkspace.tsx','src/features/reception/LinkRelationshipDialog.tsx','src/features/reception/linkRelationships.ts','src/features/reception/api.ts','src/features/reception/contracts.ts','src/hooks/useUnsavedChanges.ts','scripts/fixtures/link-relationship-editor-page.tsx'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',doctor='88888888-8888-4888-8888-888888888888',caseId='99999999-9999-4999-8999-999999999999';
let browser;const errors=[],scenarios=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(admin){
  const context=await browser.newContext({viewport:{width:375,height:950}}),calls=[],decisions=[];let relationship='guardian',revision=1,conflict=true;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:admin?'clinical':'reception',active:true,admin,clinic:{id:clinic,name:'Clínica sintética'},doctors:[{id:doctor,name:'Médico sintético',specialty:null}],staff:[]});
   if(name==='reception_case')return reply(route,{id:caseId,clinicId:clinic,contactId:contact,contactName:'Contato sintético',phone:'',doctorId:doctor,subject:'Atendimento sintético',kind:'scheduling',status:'assigned',assignedTo:uid,revision:1,createdAt:new Date().toISOString(),beneficiaries:[{id:patientId,name:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorId:doctor,relationship}],eligibleAssignees:[{id:uid,name:'Operador sintético'}],notes:[],noteCount:0,draft:{body:'',revision:0}});
   if(name==='reception_link_edit')return reply(route,{contactId:contact,patientId,doctorId:doctor,patientName:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorName:'Médico sintético',relationship,revision,active:true,patientAvailable:true,doctorActive:true});
   assert.equal(name,'reception_update_link_relationship','Only the relationship writer is expected');assert.ok(admin);assert.deepEqual(Object.keys(body).sort(),['p_contact','p_patient','p_relationship','p_revision']);assert.equal(body.p_contact,contact);assert.equal(body.p_patient,patientId);
   if(conflict){conflict=false;relationship='self';revision=2;return reply(route,{code:'40001',message:'Synthetic competing correction'},409);}
   assert.equal(body.p_revision,revision);relationship=body.p_relationship;revision++;return reply(route,revision);
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{const accept=decisions.shift()??true;void (accept?dialog.accept():dialog.dismiss());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/link-relationship-editor.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Vínculos administrativos confirmados'})).toBeVisible();return {context,page,calls,decisions};
 }
 const admin=await scene(true);await admin.page.getByRole('button',{name:'Corrigir relação de Beneficiário sintético'}).click();await expect(admin.page.getByRole('dialog')).toContainText('Médico sintético');await expect(admin.page.getByRole('dialog')).toContainText('02/01/2000');
 await admin.page.getByLabel('Relação do contato com o beneficiário').selectOption('family');await expect(admin.page.getByRole('button',{name:'Salvar relação',exact:true})).toBeDisabled();await admin.page.getByRole('checkbox',{name:/Conferi o contato/}).check();await admin.page.getByRole('button',{name:'Salvar relação',exact:true}).click();await expect(admin.page.getByRole('dialog').getByRole('alert')).toContainText('mudaram');await expect(admin.page.getByLabel('Relação do contato com o beneficiário')).toHaveValue('family');
 await admin.page.getByRole('button',{name:'Recuperar relação do servidor'}).click();await expect(admin.page.getByLabel('Relação do contato com o beneficiário')).toHaveValue('self');await expect(admin.page.getByRole('checkbox',{name:/Conferi o contato/})).not.toBeChecked();
 await admin.page.getByLabel('Relação do contato com o beneficiário').selectOption('family');await admin.page.getByRole('checkbox',{name:/Conferi o contato/}).check();await admin.page.screenshot({path:resolve(folder,'review-mobile.png')});const box=await admin.page.getByRole('dialog').boundingBox();assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=376&&box.y+box.height<=951);
 await admin.page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});await expect(admin.page.getByRole('heading',{name:'Corrigir relação do contato'})).toBeInViewport();await admin.page.screenshot({path:resolve(folder,'review-mobile-top.png')});
 await admin.page.getByRole('button',{name:'Salvar relação',exact:true}).click();await expect(admin.page.getByRole('dialog')).toHaveCount(0);await expect(admin.page.getByText('Relação administrativa corrigida.',{exact:true})).toBeVisible();await expect(admin.page.getByText(/Beneficiário sintético.*Familiar/)).toBeVisible();
 const writes=admin.calls.filter(c=>c.name==='reception_update_link_relationship');assert.equal(writes.length,2);assert.equal(writes[0].body.p_revision,1);assert.equal(writes[1].body.p_revision,2);assert.ok(writes.every(c=>c.body.p_relationship==='family'));
 await admin.page.getByRole('button',{name:'Corrigir relação de Beneficiário sintético'}).click();await admin.page.getByLabel('Relação do contato com o beneficiário').selectOption('other');admin.decisions.push(false);await admin.page.keyboard.press('Escape');await expect(admin.page.getByRole('dialog')).toBeVisible();admin.decisions.push(true);await admin.page.getByRole('button',{name:'Voltar',exact:true}).click();await expect(admin.page.getByRole('dialog')).toHaveCount(0);assert.equal(admin.calls.filter(c=>c.name==='reception_update_link_relationship').length,2);await admin.page.screenshot({path:resolve(folder,'corrected-case-mobile.png'),fullPage:true});scenarios.push({admin:true,calls:admin.calls});await admin.context.close();
 const staff=await scene(false);await expect(staff.page.getByRole('button',{name:/Corrigir relação/})).toHaveCount(0);assert.equal(staff.calls.filter(c=>c.name==='reception_link_edit'||c.name==='reception_update_link_relationship').length,0);scenarios.push({admin:false,calls:staff.calls});await staff.context.close();
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(source.sha256,createHash('sha256').update(await readFile(source.path)).digest('hex'));
 await writeFile(resolve(folder,'verification.json'),JSON.stringify({syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['admin-only case entrypoint','named review and explicit confirmation','stale revision preserves draft','explicit recovery resets baseline and confirmation','new revision saves relationship without identity fields','dirty Escape/close require discard consent','375px dialog inside viewport'],scenarios,pageErrors:errors,sources},null,2)+'\n');console.log('Seven relationship-editor browser checks passed.');
}finally{if(browser)await browser.close();await server.close();await api.close();}
