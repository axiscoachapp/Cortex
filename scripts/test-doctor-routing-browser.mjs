// Actual CaseWorkspace, suggestions and API; isolated synthetic loopback only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/doctor-routing/browser');await mkdir(folder,{recursive:true});
const paths=['src/features/reception/CaseWorkspace.tsx','src/features/reception/DoctorSuggestion.tsx','src/features/reception/routing.ts','src/features/reception/api.ts','src/features/reception/contracts.ts','src/features/reception/useCaseDraft.ts','scripts/fixtures/link-relationship-editor-page.tsx','scripts/test-doctor-routing-browser.mjs'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex'),sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const app=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',caseId='99999999-9999-4999-8999-999999999999',a='88888888-8888-4888-8888-888888888888',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',revoked='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const doctors=[{id:a,name:'Médico sintético A com nome extenso para revisão visual',specialty:null},{id:b,name:'Médico sintético B',specialty:null}];
const beneficiary=(doctorId,id=patientId)=>({id,name:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorId,relationship:'self'});
const errors=[],scenarios=[];let browser,report;
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await app.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(options={}){
  const context=await browser.newContext({viewport:{width:375,height:950},locale:'pt-BR'}),calls=[];
  const state={doctorId:options.indicated??null,revision:1,authorized:doctors,beneficiaries:options.beneficiaries??[beneficiary(a),beneficiary(b,'22222222-2222-4222-8222-222222222223')],assignedTo:options.readonly?'55555555-5555-4555-8555-555555555555':uid,pending:false,release:null};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(url.pathname.startsWith('/functions/'))throw new Error('No functions expected');
   if(!request.url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();if(request.method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=request.postDataJSON();calls.push({name,body});
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:'reception',active:true,admin:false,clinic:{id:clinic,name:'Clínica sintética'},doctors:state.authorized,staff:[]});
   if(name==='reception_case')return reply(route,{id:caseId,clinicId:clinic,contactId:contact,contactName:'Contato sintético',phone:'',doctorId:state.doctorId,subject:'Pedido administrativo sintético',kind:'return',status:'assigned',assignedTo:state.assignedTo,revision:state.revision,createdAt:'2026-11-05T18:00:00Z',beneficiaries:state.beneficiaries,eligibleAssignees:[],notes:[],noteCount:0,draft:{body:'',revision:0}});
   assert.equal(name,'reception_update_case','Only explicit case routing may write');assert.equal(body.p_case,caseId);assert.equal(body.p_action,'route');assert.deepEqual(Object.keys(body.p_value),['doctorId']);assert.equal(body.p_revision,state.revision);assert.ok(state.authorized.some(doctor=>doctor.id===body.p_value.doctorId));assert.equal(state.assignedTo,uid);
   if(state.pending)await new Promise(resolve=>{state.release=resolve;});state.doctorId=body.p_value.doctorId;state.revision++;return reply(route,state.revision);
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${app.httpServer.address().port}/scripts/fixtures/link-relationship-editor.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Vínculos administrativos confirmados'})).toBeVisible();return {context,page,calls,state};
 }
 const writes=scene=>scene.calls.filter(call=>call.name==='reception_update_case');
 const choose=(scene,doctor)=>scene.page.getByRole('button',{name:'Selecionar '+doctor.name,exact:true});
 const unavailable=await scene({indicated:revoked,beneficiaries:[beneficiary(a)]});await expect(unavailable.page.getByText(/médico indicado está indisponível/)).toBeVisible();await expect(unavailable.page.getByRole('button',{name:/^Selecionar Médico/})).toHaveCount(0);assert.equal(writes(unavailable).length,0);
 await unavailable.page.getByLabel('Encaminhar para médico').selectOption(a);assert.equal(writes(unavailable).length,0);await unavailable.page.getByRole('button',{name:'Encaminhar',exact:true}).click();await expect.poll(()=>writes(unavailable).length).toBe(1);await expect.poll(()=>unavailable.state.revision).toBe(2);assert.equal(writes(unavailable)[0].body.p_value.doctorId,a);scenarios.push({kind:'unavailable-indicated',calls:unavailable.calls});await unavailable.context.close();
 const family=await scene();await expect(family.page.getByText('Opções com vínculo, sem ordem de preferência:',{exact:true})).toBeVisible();await expect(family.page.getByLabel('Encaminhar para médico')).toHaveValue('');assert.equal(writes(family).length,0);
 await choose(family,doctors[1]).focus();await family.page.keyboard.press('Enter');await expect(family.page.getByLabel('Encaminhar para médico')).toHaveValue(b);assert.equal(writes(family).length,0);await family.page.screenshot({path:resolve(folder,'family-375.png')});assert.ok(await family.page.locator('html').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
 // A refreshed access list removes B; the unsent draft must not route B.
 family.state.authorized=[doctors[0]];await family.page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await expect(family.page.getByText(/agenda selecionada deixou/)).toBeVisible();await expect(family.page.getByRole('button',{name:'Encaminhar',exact:true})).toBeDisabled();await expect(choose(family,doctors[1])).toHaveCount(0);assert.equal(writes(family).length,0);
 await choose(family,doctors[0]).click();await expect(family.page.getByLabel('Encaminhar para médico')).toHaveValue(a);family.state.pending=true;await family.page.getByRole('button',{name:'Encaminhar',exact:true}).click();await expect(family.page.getByLabel('Encaminhar para médico')).toBeDisabled();await expect(choose(family,doctors[0])).toBeDisabled();await expect(family.page.getByRole('button',{name:'Encaminhar',exact:true})).toBeDisabled();assert.equal(writes(family).length,1);assert.ok(family.state.release);family.state.release();await expect.poll(()=>family.state.revision).toBe(2);assert.deepEqual(writes(family)[0].body,{p_case:caseId,p_revision:1,p_action:'route',p_value:{doctorId:a}});scenarios.push({kind:'family-scope-loss-and-human-correction',calls:family.calls});await family.context.close();
 const first=await scene({beneficiaries:[]});await expect(first.page.getByText(/Pergunte qual profissional/)).toBeVisible();await expect(first.page.getByRole('button',{name:/^Selecionar Médico/})).toHaveCount(0);assert.equal(writes(first).length,0);scenarios.push({kind:'new-person',calls:first.calls});await first.context.close();
 const readonly=await scene({readonly:true});await expect(readonly.page.getByRole('button',{name:'Encaminhar',exact:true})).toHaveCount(0);await expect(readonly.page.getByRole('heading',{name:'Orientação para encaminhamento'})).toHaveCount(0);assert.equal(writes(readonly).length,0);scenarios.push({kind:'other-owner',calls:readonly.calls});await readonly.context.close();
 for(const source of sources)assert.equal(await hash(source.path),source.sha256,'Source changed during test');assert.deepEqual(errors,[]);assert.ok(Object.values(api.metrics).every(count=>count===0));report={syntheticOnly:true,realSql:false,realCaseAndApi:true,checks:['unavailable indicated doctor never silently replaced','linked family choices only fill the form after human selection','scope loss refuses unsent doctor and manual correction uses exact allowed identity','pending route locks suggestions/select/submit','new person and other-owner case cause no automatic routing','375px long names wrap without horizontal overflow'],scenarios,pageErrors:errors,fixtureMetrics:{...api.metrics},sources};
}finally{await browser?.close();await app.close();await api.close();}
await writeFile(resolve(folder,'verification.json'),JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log('Six doctor-routing browser checks passed.');
