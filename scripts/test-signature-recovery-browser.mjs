// Focused retest of 0a2607b: no certificate fuzzing, PSC, hosted DB or publication.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
const reference='0a2607b',paths=['src/lib/signatureClient.ts','src/components/SignatureControls.tsx','src/hooks/useSignatureSession.ts','src/components/PrescriptionList.tsx','src/pages/SignatureReturn.tsx'];
const sources=paths.map(path=>({path,source:execFileSync('git',['show',reference+':'+path],{encoding:'utf8',windowsHide:true})}));
const frozen=new Map(sources.map(s=>[resolve(s.path).replaceAll('\\','/'),s.source])),loaded=new Set();
const folder=resolve('docs/reviews/2026-11-05/signature-recovery-retest/browser');await mkdir(folder,{recursive:true});
const api=await startClinicFixture();process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'frozen-recovery-retest',enforce:'pre',load(id){const path=id.split('?')[0].replaceAll('\\','/');if(!frozen.has(path))return null;loaded.add(path);return frozen.get(path);}}]});
let browser;const errors=[],checks=[];const id='33333333-3333-4333-8333-333333333333',hash='a'.repeat(64);
const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function scene(mode){
  const context=await browser.newContext({viewport:{width:1100,height:900}}),calls=[];let signed=false,dialogs=0;
  if(mode==='storage')await context.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('cortex.signature.operation.'))throw new DOMException('Synthetic quota','QuotaExceededError');return original.call(this,key,value);};});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   if(!route.request().url().startsWith(api.origin))return route.continue();if(route.request().method()==='OPTIONS')return reply(route,{});
   if(url.pathname==='/auth/v1/token'){const response=await route.fetch(),body=await response.json(),parts=body.access_token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.aal=mode==='mfa'?'aal1':'aal2';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');body.access_token=parts.join('.');return reply(route,body);}
   if(url.pathname==='/rest/v1/prescriptions')return reply(route,url.searchParams.get('offset')&&url.searchParams.get('offset')!=='0'?[]:[{id,user_id:uid,patient_id:patientId,doc_type:'receita_simples',status:signed?'signed':'generated',secret_code:'DEMO',created_at:new Date().toISOString(),expires_at:'2099-01-01',issuance_verified_at:new Date().toISOString(),signature_verified_at:signed?new Date().toISOString():null,issuance_snapshot:{pdf_sha256:hash}}]);
   if(url.pathname==='/functions/v1/signature-session/state')return mode==='mfa'?reply(route,{mfaRequired:true,configured:true,error:'Confirme o segundo fator.'},403):reply(route,{configured:true,active:true,expiresAt:new Date(Date.now()+900000).toISOString()});
   if(url.pathname==='/functions/v1/sign-document'){const body=route.request().postDataJSON();calls.push(body);if(body.humanRetry)signed=true;return reply(route,{status:signed?'completed':'in_progress'},signed?200:202);}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{dialogs++;void dialog.accept();});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/signature-screen-review.html`);await page.getByRole('button',{name:'Entrar no ensaio'}).click();await expect(page.getByRole('heading',{name:'Documentos sintéticos'})).toBeVisible();
  return {context,page,calls,dialogs:()=>dialogs};
 }
 const progress=await scene('progress');await progress.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();await progress.page.getByRole('button',{name:'Verificar assinatura',exact:true}).click();
 assert.equal(progress.calls.length,2);assert.ok(progress.calls.every(c=>!c.humanRetry));assert.equal(progress.dialogs(),0);assert.equal(new Set(progress.calls.map(c=>c.operationId)).size,1);
 await expect(progress.page.getByRole('button',{name:'Repetir assinatura',exact:true})).toBeEnabled();await progress.page.setViewportSize({width:375,height:950});await progress.page.waitForTimeout(5500);
 const layout=await progress.page.evaluate(()=>{const badge=[...document.querySelectorAll('main span')].find(e=>e.textContent.trim()==='Sem assinatura'),box=badge.getBoundingClientRect(),info=badge.parentElement.firstElementChild;let intersections=0;for(const p of info.querySelectorAll('p')){const range=document.createRange();range.selectNodeContents(p);for(const r of range.getClientRects())if(r.left<box.right&&r.right>box.left&&r.top<box.bottom&&r.bottom>box.top)intersections++;}return {intersections,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,clipped:[...document.querySelectorAll('main button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth);}).length};});
 assert.deepEqual(layout,{intersections:0,overflow:0,clipped:0});await progress.page.screenshot({path:resolve(folder,'in-progress-mobile.png'),fullPage:true});
 await progress.page.getByRole('button',{name:'Repetir assinatura',exact:true}).click();await expect(progress.page.getByText('Assinada',{exact:true})).toBeVisible();assert.equal(progress.dialogs(),1);assert.equal(progress.calls.length,3);assert.equal(progress.calls[2].humanRetry,true);assert.equal(new Set(progress.calls.map(c=>c.operationId)).size,1);assert.ok(progress.calls.every(c=>c.prescriptionId===id&&c.shownPdfSha256===hash));checks.push('Verify never repeats; confirmed retry retains operation/document/hash and reaches signed state','375px no badge intersection, overflow or clipped controls');await progress.context.close();
 const mfa=await scene('mfa');await expect(mfa.page.getByRole('link',{name:/Segurança/})).toHaveAttribute('href','/seguranca');await expect(mfa.page.getByRole('button',{name:'Assinar digitalmente',exact:true})).toHaveCount(0);assert.equal(mfa.calls.length,0);await mfa.page.screenshot({path:resolve(folder,'mfa-recovery.png'),fullPage:true});checks.push('Configured MFA403 exposes security recovery link and never signs');await mfa.context.close();
 const storage=await scene('storage');await storage.page.getByRole('button',{name:'Assinar digitalmente',exact:true}).click();await expect(storage.page.getByRole('region',{name:'Notifications (F8)'}).getByText(/não conseguiu guardar/)).toBeVisible();assert.equal(storage.calls.length,0);await storage.page.screenshot({path:resolve(folder,'storage-refused.png'),fullPage:true});checks.push('Quota failure refuses new operation before any signing call');await storage.context.close();
 assert.deepEqual(errors,[]);assert.equal(loaded.size,paths.length);await writeFile(resolve(folder,'verification.json'),JSON.stringify({reference,syntheticOnly:true,scope:'five frozen real components/AuthProvider/SessionAssurance and fixture router/HTTP; no PSC, hosted or SQL',checks,layout,pageErrors:errors,sources:sources.map(({path,source})=>({path,sha256:createHash('sha256').update(source).digest('hex')}))},null,2)+'\n');console.log('Four focused signature recovery/layout checks passed.');
}finally{if(browser)await browser.close();await server.close();await api.close();}
