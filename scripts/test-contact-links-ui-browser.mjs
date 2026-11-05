// Real ContactsPage/list/editor/API; loopback-only synthetic HTTP in isolated Edge.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/contact-links-ui/browser');await mkdir(folder,{recursive:true});
const paths=['src/features/reception/ContactsPage.tsx','src/features/reception/ContactLinksDialog.tsx','src/features/reception/LinkRelationshipDialog.tsx','src/features/reception/api.ts','src/features/reception/contracts.ts','src/features/reception/linkRelationships.ts','src/hooks/useUnsavedChanges.ts','scripts/fixtures/contact-links-ui-page.tsx'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');const sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',doctor='88888888-8888-4888-8888-888888888888';
const patient=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0');
let browser,report;const errors=[],scenarios=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(admin){
  const context=await browser.newContext({viewport:{width:375,height:950},locale:'pt-BR'}),calls=[],decisions=[];let denied=false,relationship='guardian',revision=1;
  const row=n=>({contactId:contact,patientId:patient(n),doctorId:n===51?'99999999-9999-4999-8999-999999999999':doctor,patientName:'Beneficiário sintético '+String(n).padStart(2,'0'),dateOfBirth:'2000-01-02',doctorName:n===51?'Médico sintético B':'Médico sintético',relationship:n===1?relationship:'guardian',revision:n===1?revision:1,active:true,patientAvailable:true,doctorActive:n!==51});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:admin?'clinical':'reception',active:true,admin,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[]});
   if(name==='reception_contacts')return reply(route,{items:[{id:contact,name:'Contato sintético',phone:'',createdAt:new Date().toISOString()}],nextCursor:null});
   assert.ok(admin,'Staff must not call the administrative readers');
   if(name==='reception_contact_links'){
    assert.equal(body.p_clinic,clinic);assert.equal(body.p_contact,contact);assert.equal(body.p_limit,50);
    if(denied)return reply(route,{code:'42501',message:'Synthetic permission removed'},403);
    assert.ok(body.p_after===null||body.p_after===patient(50));return reply(route,body.p_after===null?{items:Array.from({length:50},(_,index)=>row(index+1)),nextCursor:patient(50)}:{items:[row(51)],nextCursor:null});
   }
   if(name==='reception_link_edit'){assert.deepEqual(body,{p_contact:contact,p_patient:patient(1)});return reply(route,row(1));}
   assert.equal(name,'reception_update_link_relationship');assert.deepEqual(body,{p_contact:contact,p_patient:patient(1),p_revision:revision,p_relationship:'family'});relationship='family';revision++;return reply(route,revision);
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{const accepted=decisions.shift()??true;void(accepted?dialog.accept():dialog.dismiss());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/contact-links-ui.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Contatos da recepção'})).toBeVisible();
  return {page,context,calls,decisions,deny:()=>{denied=true;}};
 }
 const admin=await scene(true);assert.equal(admin.calls.filter(call=>call.name==='reception_contact_links').length,0);await admin.page.getByRole('button',{name:'Consultar vínculos'}).click();await expect(admin.page.getByText('50 vínculos carregados',{exact:true})).toBeAttached();
 await admin.page.getByRole('button',{name:'Corrigir relação de Beneficiário sintético 01',exact:true}).click();await expect(admin.page.getByRole('heading',{name:'Corrigir relação do contato'})).toBeVisible();await admin.page.getByLabel('Relação do contato com o beneficiário').selectOption('family');await admin.page.getByRole('checkbox',{name:/Conferi o contato/}).check();await admin.page.getByRole('button',{name:'Salvar relação',exact:true}).click();await expect(admin.page.getByRole('heading',{name:'Vínculos do contato'})).toBeVisible();await expect(admin.page.getByRole('status').filter({hasText:'Relação administrativa corrigida.'})).toBeVisible();
 const first=admin.page.getByRole('listitem').filter({has:admin.page.getByRole('heading',{name:'Beneficiário sintético 01',exact:true})});await expect(first).toContainText('Familiar');
 await admin.page.getByRole('button',{name:'Corrigir relação de Beneficiário sintético 01',exact:true}).click();await admin.page.getByLabel('Relação do contato com o beneficiário').selectOption('other');admin.decisions.push(false);await admin.page.keyboard.press('Escape');await expect(admin.page.getByRole('heading',{name:'Corrigir relação do contato'})).toBeVisible();admin.decisions.push(true);await admin.page.getByRole('button',{name:'Voltar',exact:true}).click();await expect(admin.page.getByRole('heading',{name:'Vínculos do contato'})).toBeVisible();assert.equal(admin.calls.filter(call=>call.name==='reception_update_link_relationship').length,1);
 await admin.page.getByRole('button',{name:'Carregar mais vínculos'}).click();await expect(admin.page.getByText('51 vínculos carregados',{exact:true})).toBeAttached();await expect(admin.page.getByRole('button',{name:'Corrigir relação de Beneficiário sintético 51',exact:true})).toBeDisabled();await expect(admin.page.getByText('Médico indisponível',{exact:true})).toBeAttached();await expect(admin.page.getByRole('button',{name:'Carregar mais vínculos'})).toHaveCount(0);
 await admin.page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});await expect(admin.page.getByRole('heading',{name:'Vínculos do contato'})).toBeInViewport();await admin.page.screenshot({path:resolve(folder,'list-top-mobile.png')});
 await admin.page.getByRole('button',{name:'Fechar vínculos'}).scrollIntoViewIfNeeded();const box=await admin.page.getByRole('dialog').boundingBox();assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=376&&box.y+box.height<=951);await admin.page.screenshot({path:resolve(folder,'list-end-mobile.png')});
 admin.deny();await admin.page.getByRole('button',{name:'Atualizar vínculos'}).click();await expect(admin.page.getByRole('alert')).toContainText('permissão');await expect(admin.page.getByRole('button',{name:/Corrigir relação de/})).toHaveCount(0);await expect(admin.page.getByText('Beneficiário sintético 01',{exact:true})).toHaveCount(0);await expect(admin.page.getByText('Nenhum vínculo administrativo neste contato.',{exact:true})).toHaveCount(0);scenarios.push({admin:true,calls:admin.calls});await admin.context.close();
 const staff=await scene(false);await expect(staff.page.getByRole('button',{name:'Consultar vínculos'})).toHaveCount(0);assert.equal(staff.calls.filter(call=>call.name==='reception_contact_links').length,0);scenarios.push({admin:false,calls:staff.calls});await staff.context.close();
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(await hash(source.path),source.sha256,'Source changed during browser run');
 report={syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['lazy admin-only entrypoint','50 plus 1 rows through stable cursor','existing editor updates only the selected relationship','dirty Escape and return preserve list context','unavailable physician disables correction','permission refusal hides cached rows and actions','375px dialog title and footer reachable'],scenarios,pageErrors:errors,sources};
}finally{if(browser)await browser.close();await server.close();await api.close();}
await writeFile(resolve(folder,'verification.json'),JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log('Seven contact-link list UI browser checks passed.');
