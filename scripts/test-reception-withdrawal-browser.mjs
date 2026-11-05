// Real team/provenance/review components and RPC clients; synthetic loopback only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/reception-card-withdrawal/browser');await mkdir(folder,{recursive:true});
const sources=await Promise.all(['src/features/reception/TeamSettings.tsx','src/features/reception/StaffAccessProvenance.tsx','src/features/reception/WithdrawDelegation.tsx','src/features/reception/delegationApi.ts','scripts/fixtures/reception-reactivation-page.tsx'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',staff='77777777-7777-4777-8777-777777777777',doctor='88888888-8888-4888-8888-888888888888',oldRequest='99999999-9999-4999-8999-999999999999';
let browser;const errors=[],scenarios=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(mode){
  const context=await browser.newContext({viewport:{width:375,height:950}}),calls=[];let granted=true,requestId=oldRequest,lost=true,firstBody=null;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();
   if(route.request().method()==='OPTIONS')return reply(route,{});
   const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='clinic_access')return reply(route,{actorId:uid,kind:'clinical',active:true,admin:true,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[{id:staff,name:'Recepção sintética',active:true,doctorIds:granted?[doctor]:[]}]});
   if(name==='reception_team_doctors')return reply(route,[{id:doctor,name:'Médico sintético',specialty:null}]);
   if(name==='reception_staff_permissions')return reply(route,{items:granted?[{doctorId:doctor,doctorName:'Médico sintético',source:'physician_approval',requestId,effective:true}]:[],nextCursor:null});
   if(name==='reception_delegation_withdrawal'){
    if(mode==='unavailable')return reply(route,{code:'42501',message:'Approval unavailable'},403);
    assert.equal(body.p_request,requestId);
    return reply(route,{id:requestId,clinicId:clinic,clinicName:'Clínica atual sintética',staffId:staff,staffName:'Recepção atual sintética',doctorId:doctor,doctorName:'Médico atual sintético',revision:2,state:'approved',capabilityVersion:'clinic_reception_v1'});
   }
   assert.equal(name,'reception_revoke_delegation');assert.equal(body.p_request,oldRequest);assert.equal(body.p_revision,2);assert.match(body.p_operation,/^[0-9a-f-]{36}$/);
   if(mode==='conflict'){requestId=doctor;return reply(route,{code:'40001',message:'Synthetic newer approval'},409);}
   if(lost){lost=false;firstBody=body;granted=false;return route.abort('connectionfailed');}
   assert.deepEqual(body,firstBody);return reply(route,{id:oldRequest,state:'revoked',revision:3,capabilityVersion:'clinic_reception_v1'});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/reception-reactivation.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await page.getByRole('button',{name:'Conferir origem dos acessos de Recepção sintética'}).click();await page.getByRole('button',{name:'Revogar aprovação de Médico sintético'}).click();
  return {context,page,calls,writes:()=>calls.filter(c=>c.name==='reception_revoke_delegation')};
 }
 const lost=await scene('lost');await expect(lost.page.getByRole('dialog')).toContainText('Médico atual sintético');await expect(lost.page.getByRole('dialog')).toContainText('Recepção atual sintética');assert.equal(lost.writes().length,0);
 await lost.page.screenshot({path:resolve(folder,'confirmation-mobile.png')});const box=await lost.page.getByRole('dialog').boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=376&&box.y>=-1&&box.y+box.height<=951,'Dialog clipped on mobile');
 await lost.page.getByRole('button',{name:'Voltar',exact:true}).click();assert.equal(lost.writes().length,0);await lost.page.getByRole('button',{name:'Revogar aprovação de Médico sintético'}).click();await expect(lost.page.getByRole('dialog')).toContainText('Clínica atual sintética');
 await lost.page.getByRole('button',{name:'Confirmar revogação'}).click();await expect(lost.page.getByRole('dialog').getByRole('alert')).toBeVisible();await lost.page.getByRole('button',{name:'Confirmar revogação'}).click();await expect(lost.page.getByText('Conta ativa, sem agendas.',{exact:false})).toBeVisible();assert.equal(lost.writes().length,2);assert.deepEqual(lost.writes()[0].body,lost.writes()[1].body);await lost.page.screenshot({path:resolve(folder,'withdrawn-mobile.png'),fullPage:true});scenarios.push({mode:'lost',calls:lost.calls});await lost.context.close();
 const conflict=await scene('conflict');await expect(conflict.page.getByRole('button',{name:'Confirmar revogação'})).toBeEnabled();await conflict.page.getByRole('button',{name:'Confirmar revogação'}).click();await expect(conflict.page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>conflict.calls.filter(c=>c.name==='reception_staff_permissions').length).toBeGreaterThan(1);assert.equal(conflict.writes().length,1);scenarios.push({mode:'conflict',calls:conflict.calls});await conflict.context.close();
 const unavailable=await scene('unavailable');await expect(unavailable.page.getByRole('dialog').getByRole('alert')).toBeVisible();await expect(unavailable.page.getByRole('button',{name:'Confirmar revogação'})).toBeDisabled();assert.equal(unavailable.writes().length,0);scenarios.push({mode:'unavailable',calls:unavailable.calls});await unavailable.context.close();
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(source.sha256,createHash('sha256').update(await readFile(source.path)).digest('hex'));
 await writeFile(resolve(folder,'verification.json'),JSON.stringify({syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['fresh named review','opening/cancel sends no write','lost reply retries same request/revision/operation','conflict refreshes without applying newer approval','unavailable review cannot confirm','375px dialog inside viewport'],scenarios,pageErrors:errors,sources},null,2)+'\n');console.log('Six card-withdrawal browser checks passed.');
}finally{if(browser)await browser.close();await server.close();await api.close();}
