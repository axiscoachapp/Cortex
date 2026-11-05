// Read-only effect review of a fixed source revision. No live PSC or hosted DB.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import http from 'node:http';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';

const reference='91434e3';
const paths=['src/lib/signatureClient.ts','src/components/SignatureControls.tsx','src/hooks/useSignatureSession.ts','src/components/PrescriptionList.tsx','src/pages/SignatureReturn.tsx'];
const sources=paths.map(path=>({path,source:execFileSync('git',['show',reference+':'+path],{encoding:'utf8',windowsHide:true})}));
const frozen=new Map(sources.map(({path,source})=>[resolve(path).replaceAll('\\','/'),source]));
const loaded=new Set();
const api=await startClinicFixture();
const artifacts=resolve('docs/reviews/2026-11-05/signature-screen-review/browser');await mkdir(artifacts,{recursive:true});
process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';
process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const probe=http.createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error',plugins:[{name:'frozen-signature-review',enforce:'pre',load(id){const path=id.split('?')[0].replaceAll('\\','/');if(!frozen.has(path))return null;loaded.add(path);return frozen.get(path);}}]});
let browser;const errors=[],checks=[],observations=[];
const rowId='33333333-3333-4333-8333-333333333333',hash='a'.repeat(64);
const respond=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'content-range'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(mode,callback){
  const context=await browser.newContext({viewport:{width:1100,height:820}}),requests=[];let signed=false,operation=null,dialogs=0,completes=0;
  if(mode==='storage')await context.addInitScript(()=>{const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('cortex.signature.operation.'))throw new DOMException('Synthetic full storage','QuotaExceededError');return save.call(this,k,v);};});
  if(callback)await context.addInitScript(()=>sessionStorage.setItem('cortex.signature.return','/destino-sintetico'));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin))return route.continue();
   if(route.request().method()==='OPTIONS')return respond(route,{});
   if(url.pathname==='/auth/v1/token'){
    const response=await route.fetch(),body=await response.json(),parts=body.access_token.split('.');
    const claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.aal=mode==='mfa'?'aal1':'aal2';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');body.access_token=parts.join('.');return respond(route,body);
   }
   if(url.pathname==='/rest/v1/prescriptions')return respond(route,url.searchParams.get('offset')&&url.searchParams.get('offset')!=='0'?[]:[{id:rowId,user_id:uid,patient_id:patientId,doc_type:'receita_simples',status:signed?'signed':'generated',secret_code:'DEMO',created_at:new Date().toISOString(),expires_at:'2099-01-01',issuance_verified_at:new Date().toISOString(),signature_verified_at:signed?new Date().toISOString():null,issuance_snapshot:{pdf_sha256:hash}}]);
   if(url.pathname==='/functions/v1/signature-session/state')return mode==='mfa'?respond(route,{error:'Confirme o segundo fator para continuar.',mfaRequired:true},403):respond(route,{configured:true,active:true,expiresAt:new Date(Date.now()+900000).toISOString()});
   if(url.pathname==='/functions/v1/signature-session/complete'){completes++;return respond(route,{active:true,expiresAt:new Date(Date.now()+900000).toISOString()});}
   if(url.pathname==='/functions/v1/sign-document'){
    const body=route.request().postDataJSON();requests.push(body);
    if(mode==='ambiguous'){
     if(body.humanRetry){signed=true;return respond(route,{status:'completed'});}
     return respond(route,{status:'ambiguous'},202);
    }
    if(mode==='storage'&&operation&&operation!==body.operationId)return respond(route,{error:'Outra operação de assinatura está ativa neste documento.',code:'not_ready'},409);
    operation=body.operationId;return respond(route,{status:'in_progress'},202);
   }
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs++;void dialog.accept();});
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/signature-screen-review.html`+(callback?'?callback='+callback:''));
  await page.getByRole('button',{name:'Entrar no ensaio'}).click();
  if(!callback)await expect(page.getByRole('heading',{name:'Documentos sintéticos'})).toBeVisible();
  return {page,context,requests,dialogs:()=>dialogs,completes:()=>completes};
 }
 {
  const s=await scene('progress');await expect(s.page.getByRole('button',{name:'Assinar digitalmente',exact:true})).toBeVisible();
  await s.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();
  for(let n=0;n<2;n++){await expect(s.page.getByRole('button',{name:'Verificar assinatura',exact:true})).toBeEnabled();await s.page.getByRole('button',{name:'Verificar assinatura',exact:true}).click();await expect.poll(()=>s.requests.length).toBe(n+2);}
  await expect(s.page.getByRole('button',{name:'Verificar assinatura',exact:true})).toBeEnabled();assert.equal(new Set(s.requests.map(r=>r.operationId)).size,1);assert.ok(s.requests.every(r=>r.prescriptionId===rowId&&r.shownPdfSha256===hash&&!r.humanRetry));
  observations.push({case:'stranded psc_requested',calls:s.requests.length,sameOperation:true,confirmedRetryAvailable:await s.page.getByRole('button',{name:/Tentar de novo|Repetir assinatura/i}).count()>0,humanRetrySent:false});
  await s.page.screenshot({path:resolve(artifacts,'in-progress.png')});await s.page.setViewportSize({width:375,height:850});
  await s.page.waitForTimeout(5500); // let the ordinary toast dismiss before visual measurements
  const overflow=await s.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  const layout=await s.page.evaluate(()=>{
   const badge=[...document.querySelectorAll('main span')].find(e=>e.textContent.trim()==='Sem assinatura');
   const box=badge.getBoundingClientRect(),info=badge.parentElement.firstElementChild;
   let textIntersections=0;
   for(const p of info.querySelectorAll('p')){const range=document.createRange();range.selectNodeContents(p);for(const r of range.getClientRects())if(r.left<box.right&&r.right>box.left&&r.top<box.bottom&&r.bottom>box.top)textIntersections++;}
   const clippedControls=[...document.querySelectorAll('main button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>window.innerWidth);}).length;
   return {textIntersections,clippedControls};
  });
  if(overflow>1||layout.textIntersections||layout.clippedControls)observations.push({case:'375px document readability',horizontalOverflow:overflow,...layout});else checks.push('At 375px, document text does not overlap its badge and controls stay within the viewport');
  await s.page.screenshot({path:resolve(artifacts,'in-progress-mobile.png')});await s.context.close();
 }
 {
  const s=await scene('ambiguous');await s.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();await s.page.getByRole('button',{name:'Tentar de novo',exact:true}).click();
  await expect(s.page.getByText('Assinada',{exact:true})).toBeVisible();assert.equal(s.requests.length,2);assert.equal(s.requests[0].operationId,s.requests[1].operationId);assert.equal(s.requests[1].humanRetry,true);assert.equal(s.dialogs(),1);
  checks.push('Ambiguous response requires confirmed human retry of same document/hash/operation, then refreshes signed status');await s.page.screenshot({path:resolve(artifacts,'signed.png')});await s.context.close();
 }
 {
  const s=await scene('mfa');await expect(s.page.getByText('Sem assinatura',{exact:true})).toBeVisible();await s.page.waitForTimeout(300);
  const controls=await s.page.getByRole('button',{name:/Assinar digitalmente|Abrir sessão|segundo fator|MFA/i}).count();const instructions=await s.page.getByText(/segundo fator|MFA|autenticador/i).count();
  assert.equal(controls,0);assert.equal(instructions,0);assert.equal(s.requests.length,0);
  observations.push({case:'configured server requires MFA for doctor without enrolled factor',clinicalShellAccessible:true,signingControls:controls,mfaRecoveryInstructions:instructions});await s.page.screenshot({path:resolve(artifacts,'mfa-hidden.png')});await s.context.close();
 }
 {
  const s=await scene('storage');await s.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();await expect.poll(()=>s.requests.length).toBe(1);await expect(s.page.getByRole('button',{name:'Assinar digitalmente',exact:true})).toBeEnabled();await s.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();await expect.poll(()=>s.requests.length).toBe(2);
  assert.notEqual(s.requests[0].operationId,s.requests[1].operationId);
  observations.push({case:'operation storage quota failure',calls:2,distinctOperationIds:2,serverRejectsSecondAsDifferentActiveOperation:true});await s.page.screenshot({path:resolve(artifacts,'storage-lost-operation.png')});await s.context.close();
 }
 for(const mode of ['success','denied']){
  const s=await scene('return',mode);if(mode==='success'){await expect(s.page.getByRole('heading',{name:'Retorno ao local salvo'})).toBeVisible();assert.equal(s.completes(),1);}else{await expect(s.page.getByRole('alert')).toContainText('negada');assert.equal(s.completes(),0);}
  checks.push('Callback '+mode+' keeps local navigation and sends completion '+(mode==='success'?'once':'zero times'));await s.context.close();
 }
 assert.deepEqual(errors,[]);
 assert.equal(loaded.size,paths.length,'Every reviewed component must be loaded from the fixed revision');
 const report={reference,syntheticOnly:true,scope:'real components/AuthProvider/SessionAssurance with fixture router and mocked HTTP; not PSC/hosted/SQL evidence',checks,observations,pageErrors:errors,sourceHashes:sources.map(({path,source})=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
 await writeFile(resolve(artifacts,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await server.close();await api.close();}
