// Actual browser/UI against a synthetic loopback API; not hosted-service evidence.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startClinicFixture, patientId } from './fixtures/clinic-review-api.mjs';

const api=await startClinicFixture();
const probe=http.createServer();await new Promise(resolveReady=>probe.listen(0,'127.0.0.1',resolveReady));
const port=probe.address().port;await new Promise(resolveDone=>probe.close(resolveDone));
const origin=`http://127.0.0.1:${port}`;
const artifacts=resolve('docs/reviews/2026-11-03/clinic-repairs/browser');await mkdir(artifacts,{recursive:true});
const app=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:api.origin,VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='';app.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-6000);});app.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-6000);});
let browser;const errors=[];const checks=[];
const pdf=()=>{
  const stream='BT /F1 12 Tf 72 720 Td (Protocolo clinico sintetico para revisao do medico.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(body);body+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
};
try {
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/auth')).ok){ready=true;break;}}catch{}await new Promise(resolveWait=>setTimeout(resolveWait,500));}
  if(!ready)throw new Error('Synthetic application failed to start: '+logs);
  browser=await chromium.launch({headless:true,...(process.env.CORTEX_BROWSER_CHANNEL?{channel:process.env.CORTEX_BROWSER_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return ['127.0.0.1','localhost'].includes(host)?route.continue():route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin+'/auth');
  await page.getByLabel(/e-?mail/i).fill('review@example.invalid');await page.getByLabel(/^senha$/i).fill('synthetic-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/');
  await page.goto(origin+'/?patient='+patientId);
  await expect(page.getByRole('heading',{name:'Paciente Exemplo A',exact:true}).first()).toBeVisible();
  const fontSize=await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize);
  if(fontSize!=='24px')throw new Error('Expected the default 150% scale, received '+fontSize);checks.push('150% default interface scale');
  await expect(page.getByRole('button',{name:'Gerar resumo com IA',exact:true})).toBeVisible();
  if(api.metrics.briefings!==0 || api.metrics.checklists!==0 || api.metrics.patientWrites!==0)throw new Error('Opening the chart caused a paid operation or status write');checks.push('read-only chart opening');
  await expect(page.getByRole('button',{name:'Receita / atestado',exact:true})).toBeVisible();checks.push('document action discoverability');
  await page.getByRole('button',{name:'Gerar resumo com IA',exact:true}).click();await expect(page.getByText('Resumo sintético estável')).toBeVisible();checks.push('explicit summary generation');
  await page.getByLabel('Pergunta ao assistente clínico').fill('Há interação entre paroxetina e propranolol?');
  await page.getByRole('button',{name:/enviar/i}).last().click();
  await expect(page.getByText(/Verificação farmacológica necessária/)).toBeVisible();
  await page.reload();await expect(page.getByText('Há interação entre paroxetina e propranolol?',{exact:true})).toBeVisible();await expect(page.getByText(/Verificação farmacológica necessária/)).toBeVisible();
  if(api.metrics.chat!==1)throw new Error('Conversation recovery generated another answer');checks.push('durable conversation recovery without model replay');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Perfil',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');checks.push('mobile profile action');
  await page.goto(origin+'/modelos');await page.getByRole('button',{name:'Pré-visualizar Modelo sintético SOAP'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').locator('strong').first()).toContainText('Subjetivo');await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation',{name:'Navegação principal'})).toBeVisible();checks.push('template preview and mobile subpage navigation');
  await page.goto(origin+'/agenda');await page.getByRole('group',{name:'Visualização da agenda'}).getByRole('button',{name:'Mês',exact:true}).click();await expect(page.locator('.rbc-month-view')).toBeVisible();
  await page.setViewportSize({width:1280,height:900});await expect(page.locator('.rbc-month-view')).toBeVisible();checks.push('controlled calendar month view across resize');
  await page.getByRole('link',{name:'Lista de espera e confirmações'}).click();await expect(page.getByRole('heading',{name:'Lista de espera e confirmações'})).toBeVisible();checks.push('scheduling queue destination');
  await page.goto(origin+'/conhecimento');await page.getByRole('button',{name:/adicionar|nova fonte/i}).first().click();
  await page.getByLabel('Importar texto de PDF, TXT ou Markdown').setInputFiles({name:'protocolo-sintetico.pdf',mimeType:'application/pdf',buffer:pdf()});
  await expect(page.getByLabel('Texto original do protocolo')).toHaveValue(/Protocolo clinico sintetico/);
  if(api.metrics.newSources!==0)throw new Error('PDF import silently saved/approved a source');checks.push('real PDF worker extraction with explicit review');
  await page.screenshot({path:resolve(artifacts,'pdf-review.png'),fullPage:true});
  await page.keyboard.press('Escape');
  for(const width of [390,768,820,1280,1920]){
    await page.setViewportSize({width,height:900});await page.goto(origin+'/?patient='+patientId);await expect(page.getByRole('heading',{name:'Paciente Exemplo A',exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'Gerar roteiro com IA',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Como está seu sono?'})).toBeVisible();
    const alignment=await page.getByRole('checkbox').evaluateAll(boxes=>boxes.map(box=>{
      const text=box.parentElement.querySelector('span');const b=box.getBoundingClientRect();const t=text.getBoundingClientRect();
      return {offset:Math.abs(b.y+b.height/2-(t.y+parseFloat(getComputedStyle(text).lineHeight)/2)),left:t.x};
    }));
    if(alignment.some(item=>item.offset>1)||alignment.some(item=>Math.abs(item.left-alignment[0].left)>1))throw new Error('Checklist alignment failed at '+width+': '+JSON.stringify(alignment));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);if(overflow)throw new Error('Horizontal page overflow at '+width);
    await page.screenshot({path:resolve(artifacts,'chart-'+width+'.png'),fullPage:true});checks.push('responsive chart '+width);
  }
  if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
  const report={checks,metrics:api.metrics,browser:'isolated Chromium/Edge',data:'synthetic only',errors};
  await writeFile(resolve(artifacts,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} catch(error) {
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});await writeFile(resolve(artifacts,'failure.txt'),await page.locator('body').innerText());}
  throw error;
} finally {
  if(browser)await browser.close();app.kill();await api.close();
}
