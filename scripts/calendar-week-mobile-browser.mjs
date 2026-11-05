// T38: actual calendar, isolated browser, synthetic loopback API only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { format, startOfWeek, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MOBILE_BREAKPOINT } from '../src/lib/interfaceScale.ts';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
const red=process.argv.includes('--red');assert.ok(process.argv.slice(2).every(arg=>arg==='--red')&&process.argv.length<=3);
const folder=resolve('docs/reviews/2026-11-05/calendar-week-mobile');await mkdir(folder,{recursive:true});
const paths=['src/pages/Calendar.tsx','src/index.css','src/components/CalendarWeekDetails.tsx','src/hooks/use-mobile.tsx','src/lib/interfaceScale.ts','scripts/calendar-week-mobile-browser.mjs','scripts/calendar-header-browser.mjs','scripts/fixtures/clinic-review-api.mjs'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const sources=await Promise.all(paths.filter(path=>!red||!path.endsWith('/CalendarWeekDetails.tsx')).map(async path=>({path,sha256:await hash(path)})));
const selected=addDays(new Date(),35),day=format(selected,'yyyy-MM-dd'),title='Reserva sintética com título completo para leitura da semana no celular';
const appointments=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:uid,patient_id:patientId,title,start_time:day+'T12:00:00Z',end_time:day+'T12:30:00Z',status:'agendado',type:'retorno',revision:1}];
for(let i=1;i<=5;i++)appointments.push({...appointments[0],id:'bbbbbbbb-bbbb-4bbb-8bbb-'+String(i).padStart(12,'0'),title:'Reserva sintética adicional '+i,start_time:day+`T${12+i}:00:00Z`,end_time:day+`T${12+i}:30:00Z`});
const api=await startClinicFixture({appointments});
process.env.VITE_SUPABASE_URL=api.origin;process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';process.env.VITE_BYPASS_EMAIL='';process.env.VITE_BYPASS_PASSWORD='';
const app=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser,failure;const report={syntheticOnly:true,realSql:false,red,sources,layouts:[],checks:[],pageErrors:[],forbiddenRequests:[]};
try{
 await app.listen();const origin='http://127.0.0.1:'+app.httpServer.address().port;
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'America/Sao_Paulo',locale:'pt-BR'});
 const reads=new Set(['clinic_access','get_integration_status']);
 await context.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  const allowedPost=url.origin===api.origin&&method==='POST'&&(url.pathname==='/auth/v1/token'||(url.pathname.startsWith('/rest/v1/rpc/')&&reads.has(url.pathname.split('/').at(-1))));
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!allowedPost)report.forbiddenRequests.push({method,path:url.pathname});
  return [origin,api.origin].includes(url.origin)?route.continue():route.abort();
 });
 const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
 await page.goto(origin+'/auth?next='+encodeURIComponent('/agenda'));await page.getByLabel(/e-?mail/i).fill('review@example.invalid');await page.getByLabel(/^senha$/i).fill('synthetic-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForSelector('.rbc-time-header-content .rbc-header');
 const views=page.getByRole('group',{name:'Visualização da agenda'});
 for(let i=0;i<5;i++)await page.locator('.rbc-toolbar').getByRole('button',{name:'Próximo',exact:true}).click();
 const period=await page.locator('.rbc-toolbar-label').textContent();await expect(page.locator('.rbc-event-content').getByText(title,{exact:true})).toBeAttached();
 for(const width of [390,375,768,1036,1037,1280,1920]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByRole('region',{name:'Consultas da semana'})).toHaveCount(width<MOBILE_BREAKPOINT?1:0);
  const labels=await page.locator('.rbc-time-header-content .rbc-header').evaluateAll(headers=>headers.map(header=>{
   const box=header.getBoundingClientRect(),visible=[...header.querySelectorAll('[aria-hidden="true"]')];
   const boxes=(visible.length?visible:[header]).map(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect();});
   return {label:header.textContent,width:box.width,clipped:boxes.some(text=>text.left<box.left-0.5||text.right>box.right+0.5||text.top<box.top-0.5||text.bottom>box.bottom+0.5)};
  }));report.layouts.push({width,labels});
  if(width===390)await page.screenshot({path:resolve(folder,red?'before-390.png':'after-390.png')});
  assert.equal(labels.length,7);assert.ok(labels.every(label=>!label.clipped),'Week day/date text clipped at '+width);
  await expect(views.getByRole('button',{name:'Semana',exact:true})).toHaveAttribute('aria-pressed','true');assert.equal(await page.locator('.rbc-toolbar-label').textContent(),period);assert.ok(await page.locator('html').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  assert.equal(await page.locator('.rbc-event-label').first().textContent(),'09:00 – 09:30');
  const details=page.getByRole('region',{name:'Consultas da semana'});
  if(width<MOBILE_BREAKPOINT){await expect(details.getByRole('button',{name:new RegExp(title)})).toContainText(format(selected,'dd/MM')+' 09:00 – '+format(selected,'dd/MM')+' 09:30');await expect(page.getByRole('link',{name:'Ver horários e títulos completos'})).toBeVisible();}
  else await expect(details).toHaveCount(0);
 }report.checks.push('seven readable day/date headers, full mobile titles/times, no overflow at seven widths; selected future week and times retained');
 await page.setViewportSize({width:390,height:1000});await page.getByRole('link',{name:'Ver horários e títulos completos'}).click();const detailsHeading=await page.getByRole('heading',{name:'Consultas da semana',exact:true}).boundingBox(),stickyHeader=await page.locator('header').first().boundingBox();assert.ok(detailsHeading.y>=stickyHeader.y+stickyHeader.height,'Jump target heading hidden by sticky header');
 const item=page.getByRole('region',{name:'Consultas da semana'}).getByRole('button',{name:new RegExp(title)});await item.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(folder,'week-details-390.png')});
 await item.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Editar Consulta',exact:true})).toBeVisible();await expect(page.getByLabel('Título *',{exact:true})).toHaveValue(title);await expect(page.getByLabel('Início',{exact:true})).toHaveValue('09:00');await expect(page.getByLabel('Data',{exact:true})).toHaveText(format(selected,"d 'de' MMMM 'de' yyyy",{locale:ptBR}));await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);report.checks.push('jump heading clears sticky header; keyboard opens exact appointment with original title/date/time; no save on open');
 await page.locator('.rbc-time-header-content .rbc-header button').first().focus();await page.keyboard.press('Enter');await expect(views.getByRole('button',{name:'Dia',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.rbc-toolbar-label')).toHaveText(format(startOfWeek(selected,{locale:ptBR}),'cccc MMM dd',{locale:ptBR}));await expect(page.getByRole('region',{name:'Consultas da semana'})).toHaveCount(0);report.checks.push('concise header retains accessible keyboard drilldown to correct Sunday');
 await views.getByRole('button',{name:'Mês',exact:true}).click();for(const width of [390,1920,768]){await page.setViewportSize({width,height:1000});await expect(views.getByRole('button',{name:'Mês',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('region',{name:'Consultas da semana'})).toHaveCount(0);}report.checks.push('day/month have no supplementary week rows and resize never changes chosen view');
 await page.waitForTimeout(600);await page.waitForLoadState('networkidle');report.fixtureMetrics={...api.metrics};assert.ok(Object.values(api.metrics).every(count=>count===0));assert.deepEqual(report.forbiddenRequests,[]);assert.deepEqual(report.pageErrors,[]);assert.equal(await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)),21.6);for(const source of sources)assert.equal(await hash(source.path),source.sha256);report.checks.push('135% scale, zero writes/AI/pageerrors, source hashes unchanged');
}catch(error){failure=error;report.failure=String(error.message??error).slice(0,1400);}
finally{await browser?.close();await app.close();await api.close();}
await writeFile(resolve(folder,red?'RED.json':'verification.json'),JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');if(failure){console.error(report.failure);process.exitCode=1;}else console.log('Calendar mobile week browser checks passed.');
