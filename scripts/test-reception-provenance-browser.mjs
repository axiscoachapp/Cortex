// Administrative provenance reader in real TeamSettings, synthetic loopback only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startClinicFixture, uid } from './fixtures/clinic-review-api.mjs';
const folder=resolve('docs/reviews/2026-11-05/reception-access-provenance/browser');await mkdir(folder,{recursive:true});
const sources=await Promise.all(['src/features/reception/TeamSettings.tsx','src/features/reception/StaffAccessProvenance.tsx','src/features/reception/delegationApi.ts','scripts/fixtures/reception-reactivation-page.tsx'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
const clinic='66666666-6666-4666-8666-666666666666',staff='77777777-7777-4777-8777-777777777777',first='88888888-8888-4888-8888-888888888888',second='99999999-9999-4999-8999-999999999999';
let browser,denied=false;const calls=[],errors=[];
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:1100,height:1000}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  if(!route.request().url().startsWith(api.origin)||!url.pathname.startsWith('/rest/v1/rpc/'))return route.continue();
  if(route.request().method()==='OPTIONS')return reply(route,{});
  const name=url.pathname.split('/').pop(),body=route.request().postDataJSON();calls.push({name,body});
  if(name==='clinic_access')return reply(route,{actorId:uid,kind:'clinical',active:true,admin:true,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[{id:staff,name:'Recepção sintética',active:true,doctorIds:[first,second]}]});
  if(name==='reception_team_doctors')return reply(route,[{id:first,name:'Médico legado sintético',specialty:null},{id:second,name:'Médico com aprovação sintética',specialty:null}]);
  assert.equal(name,'reception_staff_permissions','Reader must not mutate permissions');
  if(denied)return reply(route,{code:'42501',message:'Synthetic revoked authority'},403);
  assert.deepEqual(body,{p_clinic:clinic,p_staff:staff,p_after:body.p_after,p_limit:50});
  return reply(route,body.p_after?{items:[{doctorId:second,doctorName:'Médico com aprovação sintética',source:'physician_approval',requestId:second,effective:true}],nextCursor:null}:{items:[{doctorId:first,doctorName:'Médico legado sintético',source:'legacy',requestId:null,effective:true}],nextCursor:first});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/reception-reactivation.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();
 await expect(page.getByRole('heading',{name:'Equipe e permissões'})).toBeVisible();assert.equal(calls.filter(c=>c.name==='reception_staff_permissions').length,0);
 await page.getByRole('button',{name:'Conferir origem dos acessos de Recepção sintética'}).click();await expect(page.getByText('Legado: anuência não comprovada',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Carregar mais acessos'}).click();await expect(page.getByText('Aprovação médica vinculada',{exact:true})).toBeVisible();
 await page.screenshot({path:resolve(folder,'origins-desktop.png'),fullPage:true});await page.setViewportSize({width:375,height:950});await page.screenshot({path:resolve(folder,'origins-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
 denied=true;await page.getByRole('button',{name:'Atualizar origem dos acessos'}).click();await expect(page.getByRole('alert')).toContainText('permissão');await expect(page.getByText('Aprovação médica vinculada',{exact:true})).toHaveCount(0);await expect(page.getByText('Legado: anuência não comprovada',{exact:true})).toHaveCount(0);
 denied=false;await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await expect(page.getByText('Legado: anuência não comprovada',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Ver pedidos e revogações da clínica'})).toHaveAttribute('href',`/permissoes-recepcao?clinica=${clinic}`);
 assert.deepEqual(errors,[]);for(const source of sources)assert.equal(source.sha256,createHash('sha256').update(await readFile(source.path)).digest('hex'));
 await writeFile(resolve(folder,'verification.json'),JSON.stringify({syntheticOnly:true,realPagesAndApi:true,realSql:false,checks:['lazy fetch','legacy and proven approval remain distinct','composite staff scope and cursor','375px no overflow','denied refresh hides rows and retry recovers','no mutation and explicit withdrawal-workflow link'],calls,pageErrors:errors,sources},null,2)+'\n');
 console.log('Six administrative provenance browser checks passed.');await context.close();
}finally{if(browser)await browser.close();await server.close();await api.close();}
