// Real team/permission pages and RPC clients; isolated synthetic loopback HTTP.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/reception-staff-reactivation/browser');await mkdir(folder,{recursive:true});
const sources=await Promise.all(['src/features/reception/TeamSettings.tsx','src/features/reception/DelegationPermissions.tsx','src/features/reception/api.ts','src/features/reception/delegationApi.ts','scripts/fixtures/reception-reactivation-page.tsx'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',staff='77777777-7777-4777-8777-777777777777',doctor='88888888-8888-4888-8888-888888888888';
let browser,active=false,lostReply=true,pending=null;const calls=[],errors=[];
const reply=(route,body)=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try {
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:375,height:950}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();
  if(route.request().method()==='OPTIONS')return reply(route,{});
  const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
  if(name==='clinic_access')return reply(route,{actorId:uid,kind:'clinical',active:true,admin:true,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[{id:staff,name:'Recepção sintética',active,doctorIds:[]}]});
  if(name==='reception_team_doctors')return reply(route,[{id:doctor,name:'Médico sintético',specialty:null}]);
  if(name==='update_reception_staff'){
   assert.deepEqual(body,{p_staff:staff,p_doctors:[],p_active:true});active=true;
   if(lostReply){lostReply=false;return route.abort('connectionfailed');}return reply(route,true);
  }
  if(name==='reception_delegation_requests')return reply(route,{canManage:true,items:pending?[{...pending,clinicId:clinic,clinicName:'Clínica sintética',staffId:staff,staffName:'Recepção sintética',doctorId:doctor,doctorName:'Médico sintético',createdAt:new Date().toISOString(),effective:false,canDecide:false,canCancel:true,canRevoke:false}]:[],nextCursor:null});
  if(name==='reception_request_delegation'){assert.ok(active);pending={id:randomUUID(),state:'pending',revision:1,capabilityVersion:'clinic_reception_v1'};return reply(route,pending);}
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/reception-reactivation.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();
 await expect(page.getByRole('heading',{name:'Equipe e permissões'})).toBeVisible();const card=page.locator('article').filter({hasText:'Recepção sintética'});
 await expect(card.getByRole('checkbox')).toHaveCount(0);await expect(card).toContainText('As agendas anteriores não serão restauradas');
 await page.getByRole('button',{name:'Reativar conta',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);
 await page.getByRole('button',{name:'Reativar conta',exact:true}).click();await expect(page.getByRole('status')).toContainText('Conta reativada, sem agendas');await expect(card).toContainText('Conta ativa, sem agendas');
 await expect(card.getByRole('checkbox',{name:'Médico sintético'})).toBeDisabled();
 assert.equal(calls.filter(c=>c.name==='update_reception_staff').length,2);
 await page.screenshot({path:resolve(folder,'reactivated-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
 await page.getByRole('link',{name:'Pedidos de acesso e aprovações médicas'}).click();await page.getByLabel('Conta de recepção').selectOption(staff);await page.getByLabel('Médico responsável').selectOption(doctor);await page.getByRole('button',{name:'Enviar pedido ao médico'}).click();
 await expect(page.getByText('Aguardando médico',{exact:true})).toBeVisible();await expect(page.getByText('Sem acesso ativo',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Aprovar acesso',exact:true})).toHaveCount(0);
 await page.screenshot({path:resolve(folder,'fresh-request-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(source.sha256,createHash('sha256').update(await readFile(source.path)).digest('hex'),'Source changed during test');
 await writeFile(resolve(folder,'verification.json'),JSON.stringify({syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['inactive card offers no agenda restoration','lost reply has no confirmed success','retry repeats empty scopes and activates only account','explicit fresh permission request remains pending','375px no overflow'],calls,pageErrors:errors,sources},null,2)+'\n');
 console.log('Five reactivation browser checks passed, including lost reply and fresh consent request.');await context.close();
} finally {if(browser)await browser.close();await server.close();await api.close();}
