// Real page/API/DTOs, isolated Edge contexts and synthetic loopback HTTP only.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/reception-delegation-api/browser');await mkdir(folder,{recursive:true});
const paths=['src/features/reception/DelegationPermissions.tsx','src/features/reception/delegationApi.ts','scripts/fixtures/delegation-permissions-page.tsx'];
const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const api=await startClinicFixture();
process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';
process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',staff='77777777-7777-4777-8777-777777777777';
let row=null,browser,failedRead=false;const calls=[],errors=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try {
 await server.listen();const address=server.httpServer.address();
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(admin){
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/reception_'))return route.continue();
   if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='reception_team_doctors')return reply(route,[{id:uid,name:'Médico sintético',specialty:null}]);
   if(name==='reception_delegation_requests'){
    if(failedRead)return reply(route,{code:'42501',message:'Synthetic denied'},403);
    return reply(route,{canManage:!!body.p_clinic,items:row?[{...row,canDecide:!body.p_clinic&&row.state==='pending',canCancel:!!body.p_clinic&&row.state==='pending',canRevoke:row.state==='approved'}]:[],nextCursor:null});
   }
   if(name==='reception_request_delegation')row={id:randomUUID(),clinicId:clinic,clinicName:'Clínica sintética',staffId:staff,staffName:'Recepção sintética',doctorId:uid,doctorName:'Médico sintético',createdAt:new Date().toISOString(),state:'pending',revision:1,capabilityVersion:'clinic_reception_v1',effective:false};
   else {assert.equal(body.p_request,row.id);assert.equal(body.p_revision,row.revision);row.revision++;row.state=name==='reception_decide_delegation'?(body.p_decision==='approve'?'approved':'denied'):name==='reception_cancel_delegation'?'cancelled':'revoked';row.effective=row.state==='approved';}
   return reply(route,{id:row.id,state:row.state,revision:row.revision,capabilityVersion:row.capabilityVersion});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/delegation-permissions.html`+(admin?'?admin=1':''));await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Permissões da recepção'})).toBeVisible();
  return {page,context};
 }
 const admin=await scene(true);
 await admin.page.getByLabel('Conta de recepção').selectOption(staff);await admin.page.getByLabel('Médico responsável').selectOption(uid);
 await admin.page.getByRole('button',{name:'Enviar pedido ao médico'}).click();await expect(admin.page.getByText('Aguardando médico',{exact:true})).toBeVisible();
 assert.equal(await admin.page.getByRole('button',{name:'Aprovar acesso',exact:true}).count(),0);
 await admin.page.screenshot({path:resolve(folder,'admin-pending.png')});
 const doctor=await scene(false);await doctor.page.getByRole('button',{name:'Aprovar acesso',exact:true}).click();
 assert.equal(calls.filter(c=>c.name==='reception_decide_delegation').length,0);await expect(doctor.page.getByRole('dialog')).toContainText('prontuários');
 await doctor.page.getByRole('button',{name:'Confirmar aprovação'}).click();await expect(doctor.page.getByText('Acesso ativo',{exact:true})).toBeVisible();
 await doctor.page.screenshot({path:resolve(folder,'doctor-approved.png')});
 await doctor.page.setViewportSize({width:375,height:950});await doctor.page.screenshot({path:resolve(folder,'doctor-mobile.png'),fullPage:true});
 assert.ok(await doctor.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1,'Mobile overflow');
 const clipped=await doctor.page.locator('main button').evaluateAll(nodes=>nodes.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth);}).length);assert.equal(clipped,0);
 await doctor.page.getByRole('button',{name:'Revogar acesso',exact:true}).click();await doctor.page.getByRole('button',{name:'Confirmar revogação'}).click();await expect(doctor.page.getByText('Revogado',{exact:true})).toBeVisible();
 failedRead=true;await doctor.page.getByRole('button',{name:'Atualizar lista'}).click();await expect(doctor.page.getByRole('alert')).toContainText('permissão');await expect(doctor.page.getByText('Recepção sintética',{exact:true})).toHaveCount(0);
 failedRead=false;await doctor.page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await expect(doctor.page.getByText('Revogado',{exact:true})).toBeVisible();
 await admin.context.close();await doctor.context.close();
 assert.ok(calls.every(c=>!['actor','actorId','role','source'].some(k=>Object.hasOwn(c.body,k))));assert.deepEqual(errors,[]);
 for(const source of sources)assert.equal(createHash('sha256').update(await readFile(source.path)).digest('hex'),source.sha256,'Source changed during browser test');
 await writeFile(resolve(folder,'verification.json'),JSON.stringify({syntheticOnly:true,realPageAndApi:true,realSql:false,hosted:false,checks:['admin request without approval authority','physician explicit confirmation and activation','explicit withdrawal','failed refresh hides cached rows and recovers','375px no overflow or clipped buttons','no actor injection'],pageErrors:errors,calls,sources},null,2)+'\n');
 console.log('Six browser checks passed; isolated contexts, real page/API and mocked loopback RPCs.');
} finally {if(browser)await browser.close();await server.close();await api.close();}
