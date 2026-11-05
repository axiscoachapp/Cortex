// Real ContactsPage, state dialog and API. Synthetic loopback HTTP, no hosted SQL.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/contact-link-state-ui/browser');await mkdir(folder,{recursive:true});
const paths=['src/features/reception/ContactsPage.tsx','src/features/reception/ContactLinksDialog.tsx','src/features/reception/LinkStateDialog.tsx','src/features/reception/LinkRelationshipDialog.tsx','src/features/reception/api.ts','src/features/reception/contracts.ts','src/features/reception/linkRelationships.ts','src/hooks/useUnsavedChanges.ts','scripts/fixtures/contact-links-ui-page.tsx','scripts/test-contact-link-state-ui-browser.mjs'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',patient='22222222-2222-4222-8222-222222222222',doctor='88888888-8888-4888-8888-888888888888';
let browser,report;const errors=[],scenarios=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene({admin=true,available=true}={}){
  const context=await browser.newContext({viewport:{width:375,height:950},locale:'pt-BR'}),calls=[],decisions=[];
  const state={active:true,revision:1,available,mode:'normal',release:null};
  const row=()=>({contactId:contact,patientId:patient,doctorId:doctor,patientName:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorName:'Médico sintético',relationship:'guardian',revision:state.revision,active:state.active,patientAvailable:state.available,doctorActive:state.available});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:admin?'clinical':'reception',active:true,admin,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[]});
   if(name==='reception_contacts')return reply(route,{items:[{id:contact,name:'Contato sintético',phone:'',createdAt:'2026-11-05T18:00:00Z'}],nextCursor:null});
   assert.ok(admin,'Staff must not call administrative readers or writers');
   if(name==='reception_contact_links')return reply(route,{items:[row()],nextCursor:null});
   if(name==='reception_link_edit'){assert.deepEqual(body,{p_contact:contact,p_patient:patient});return reply(route,row());}
   assert.equal(name,'reception_set_link_active');assert.equal(body.p_contact,contact);assert.equal(body.p_patient,patient);
   if(body.p_revision!==state.revision)return reply(route,{code:'40001',message:'Synthetic stale revision'},409);
   assert.ok(typeof body.p_active==='boolean');if(body.p_active)assert.ok(state.available);
   const mode=state.mode;state.mode='normal';if(mode==='pending')await new Promise(resolve=>{state.release=resolve;});
   if(state.active!==body.p_active){state.active=body.p_active;state.revision++;}
   if(mode==='lost')return reply(route,{code:'08006',message:'Resposta sintética perdida'},500);
   return reply(route,state.revision);
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{const accepted=decisions.shift()??true;void(accepted?dialog.accept():dialog.dismiss());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/contact-links-ui.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Contatos da recepção'})).toBeVisible();
  return {context,page,calls,decisions,state};
 }
 const writes=s=>s.calls.filter(call=>call.name==='reception_set_link_active');
 const open=async(s,active=false)=>{await s.page.getByRole('button',{name:`${active?'Reativar':'Suspender'} vínculo de Beneficiário sintético`,exact:true}).click();await expect(s.page.getByRole('heading',{name:active?'Reativar vínculo':'Suspender vínculo',exact:true})).toBeVisible();};
 const confirm=async(s,active=false)=>{await s.page.getByRole('checkbox',{name:/Conferi o contato/}).check();await s.page.getByRole('button',{name:active?'Confirmar reativação':'Confirmar suspensão',exact:true}).click();};
 const admin=await scene();await admin.page.getByRole('button',{name:'Consultar vínculos'}).click();await open(admin);await expect(admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true})).toBeDisabled();await expect(admin.page.getByText('Responsável',{exact:true})).toBeVisible();
 await admin.page.getByRole('checkbox',{name:/Conferi o contato/}).check();admin.decisions.push(false);await admin.page.keyboard.press('Escape');await expect(admin.page.getByRole('heading',{name:'Suspender vínculo',exact:true})).toBeVisible();
 await admin.page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});await expect(admin.page.getByRole('heading',{name:'Suspender vínculo',exact:true})).toBeInViewport();await admin.page.screenshot({path:resolve(folder,'suspend-top-mobile.png')});
 await admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true}).scrollIntoViewIfNeeded();const box=await admin.page.getByRole('dialog').boundingBox();assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=376&&box.y+box.height<=951);await admin.page.screenshot({path:resolve(folder,'suspend-end-mobile.png')});
 for(const width of [390,768,1280,1920]){
  await admin.page.setViewportSize({width,height:950});await admin.page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});await expect(admin.page.getByRole('heading',{name:'Suspender vínculo',exact:true})).toBeInViewport();
  await admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true}).scrollIntoViewIfNeeded();await expect(admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true})).toBeInViewport();
  const resized=await admin.page.getByRole('dialog').boundingBox();assert.ok(resized.x>=-1&&resized.y>=-1&&resized.x+resized.width<=width+1&&resized.y+resized.height<=951);
 }await admin.page.setViewportSize({width:375,height:950});
 await admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true}).click();await expect(admin.page.getByText('Vínculo suspenso. Histórico preservado.',{exact:true})).toBeVisible();assert.deepEqual(writes(admin)[0].body,{p_contact:contact,p_patient:patient,p_revision:1,p_active:false});
 await open(admin,true);await confirm(admin,true);await expect(admin.page.getByText('Vínculo reativado.',{exact:true})).toBeVisible();assert.equal(admin.state.revision,3);
 // Lost response: server changed state, client must read and must not invert intent or resend it.
 admin.state.mode='lost';await open(admin);await confirm(admin);await expect(admin.page.getByRole('alert')).toContainText('Não foi possível concluir a operação. Seus dados foram preservados.');await expect(admin.page.getByRole('button',{name:'Confirmar suspensão',exact:true})).toBeDisabled();
 await admin.page.getByRole('button',{name:'Recuperar estado do servidor',exact:true}).click();await expect(admin.page.getByText('O vínculo já está suspenso. Nenhuma nova alteração foi enviada.',{exact:true})).toBeVisible();assert.equal(writes(admin).length,3);
 await admin.page.getByRole('button',{name:'Voltar',exact:true}).click();await expect(admin.page.getByRole('button',{name:'Reativar vínculo de Beneficiário sintético',exact:true})).toBeEnabled();
 // A conflicting review requires recovery, consent and a second explicit confirmation.
 await open(admin,true);await admin.page.getByRole('checkbox',{name:/Conferi o contato/}).check();admin.state.revision++;
 await admin.page.getByRole('button',{name:'Confirmar reativação',exact:true}).click();await expect(admin.page.getByRole('alert')).toBeVisible();await admin.page.getByRole('button',{name:'Recuperar estado do servidor',exact:true}).click();await expect(admin.page.getByRole('checkbox')).not.toBeChecked();await expect(admin.page.getByRole('button',{name:'Confirmar reativação',exact:true})).toBeDisabled();await confirm(admin,true);await expect(admin.page.getByText('Vínculo reativado.',{exact:true})).toBeVisible();assert.equal(writes(admin).at(-1).body.p_revision,5);
 // Pending write: Escape/close cannot lose the request or submit it twice.
 admin.state.mode='pending';await open(admin);await confirm(admin);await expect(admin.page.getByRole('button',{name:'Salvando…',exact:true})).toBeDisabled();await admin.page.keyboard.press('Escape');await expect(admin.page.getByRole('heading',{name:'Suspender vínculo',exact:true})).toBeVisible();assert.equal(writes(admin).length,6);assert.ok(admin.state.release);admin.state.release();await expect(admin.page.getByText('Vínculo suspenso. Histórico preservado.',{exact:true})).toBeVisible();
 scenarios.push({admin:true,calls:admin.calls});await admin.context.close();
 const unavailable=await scene({available:false});await unavailable.page.getByRole('button',{name:'Consultar vínculos'}).click();await open(unavailable);await confirm(unavailable);await expect(unavailable.page.getByText('Vínculo suspenso. Histórico preservado.',{exact:true})).toBeVisible();await expect(unavailable.page.getByRole('button',{name:'Reativar vínculo de Beneficiário sintético',exact:true})).toBeDisabled();scenarios.push({unavailable:true,calls:unavailable.calls});await unavailable.context.close();
 const staff=await scene({admin:false});await expect(staff.page.getByRole('button',{name:'Consultar vínculos'})).toHaveCount(0);assert.equal(writes(staff).length,0);scenarios.push({admin:false,calls:staff.calls});await staff.context.close();
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(await hash(source.path),source.sha256,'Source changed during browser run');
 report={syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['human review with exact IDs/revision/target','suspension and reactivation reflected in list','lost response recovery has no automatic retry or reversed target','conflict recovery resets human confirmation','pending write blocks Escape and duplicate submission','suspension allowed with unavailable patient/physician, reactivation disabled','375px dialog title and footer reachable at app scale','390/768/1280/1920px resize preserves review and reachable action','staff has no administrative entrypoint'],scenarios,pageErrors:errors,sources};
}finally{if(browser)await browser.close();await server.close();await api.close();}
await writeFile(resolve(folder,'verification.json'),JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log('Nine contact-link state UI browser checks passed.');
