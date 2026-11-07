import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { whatsappReadIds,whatsappBotSessionFixture,whatsappHistoryCursors,whatsappListCursors } from './whatsapp-read-api.mjs';

export async function auditWhatsAppRead({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked,botReview=false,historyReview=false,listReview=false }) {
  const path = '/recepcao?view=conversations&status=open', role = 'recepcao-a';
  const page = await scene(app, role, path);
  const open = async () => {
    const button = page.getByRole('button', { name: 'Abrir conversa com Contato sintético A' });
    await button.focus(); await button.press('Enter');
    await expect(page.getByText('Mensagem sintética recebida', { exact: true })).toBeVisible();
    if(botReview){
      const bot=page.getByRole('region',{name:'Caminho no robô'});
      await expect(bot.getByText('Médico sintético',{exact:true})).toBeVisible();
      await expect(bot.getByText('Encaminhado à recepção',{exact:true})).toBeVisible();
      await expect(bot.locator('time')).toHaveAttribute('datetime',whatsappBotSessionFixture.updatedAt);
      await expect(bot.locator('time')).toContainText('15:30');
      await expect(page.getByRole('region',{name:'Conversa selecionada'}).getByText('agendamento',{exact:true})).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Conversa selecionada' })).toBeFocused();
  };
  for (const width of [320, 375, 768, 1024, 1280, 1440, 1920]) {
    await capture(page, app, role, path, width, async () => { await expect(page.getByRole('heading', { name: 'Conversas', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /Abrir conversa com/ })).toHaveCount(2); }, 'inbox-list');
    const controls = await page.evaluate(() => {
      const main = document.querySelector('main'), style = getComputedStyle(main);
      return { available: main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), search: document.getElementById('wa-search').getBoundingClientRect().width, filter: document.getElementById('wa-filter').getBoundingClientRect().width };
    });
    checks.push({ width, controls });
    if (width <= 375) assert.ok(controls.search >= controls.available - 1 && controls.filter >= controls.available - 1, 'Mobile search and filter must use the available width');
    await capture(page, app, role, path, width, open, 'inbox-messages', { navigate: false });
    await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByRole('heading',{level:2})).toBeInViewport({ ratio: 1 });
    const bounds = await page.getByRole('region', { name: 'Conversa selecionada' }).evaluate(element => {
      const panel = element.getBoundingClientRect();
      const text = [...element.querySelectorAll('h2,p,time')].map(node => { const range = document.createRange(); range.selectNodeContents(node); const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
      return { left: panel.left, right: panel.right, viewport: innerWidth, text };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.viewport + 1); assert.ok(bounds.text.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1));
    checks.push({ width, keyboardOpen: true, bounds });
    if ([375, 1440].includes(width)) await capture(page, app, role, path, width, async () => { await page.getByText('arquivo-sintetico-'.repeat(16) + '.pdf', { exact: true }).scrollIntoViewIfNeeded(); }, 'message-document-tail', { navigate: false });
    if ([375, 1440].includes(width)) {
      const documentTime = await page.evaluate(() => performance.timeOrigin);
      api.whatsappRead.setFailure('conversations', 'forbidden');
      await page.getByRole('button', { name: 'Atualizar conversas', exact: true }).click();
      await capture(page, app, role, path, width, async () => { await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('button', { name: /Abrir conversa com/ })).toHaveCount(0); await expect(page.getByRole('region', { name: 'Conversa selecionada' })).toHaveCount(0); }, 'inbox-denied', { navigate: false });
      api.whatsappRead.setFailure('conversations', null); await page.getByRole('button', { name: 'Tentar carregar conversas' }).click();
      await capture(page, app, role, path, width, async () => { await expect(page.getByText('Mensagem sintética recebida', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /Abrir conversa com/ })).toHaveCount(2); }, 'inbox-recovered', { navigate: false });
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentTime); checks.push({ width, refusedListHidden: true, retrySameDocument: true });
    }
    if (width === 375) {
      if(botReview){
        const bot=page.getByRole('region',{name:'Caminho no robô'});
        const longPath=Array.from({length:20},(_,index)=>String(index+1).padStart(2,'0')+'x'.repeat(22));
        api.whatsappRead.setBotSession(whatsappReadIds.first,{...whatsappBotSessionFixture,status:'active',path:longPath});
        await page.getByRole('button',{name:'Atualizar mensagens',exact:true}).click();
        await capture(page,app,role,path,width,async()=>{await expect(bot.getByText(longPath[19],{exact:true})).toBeVisible();await bot.getByText(longPath[19],{exact:true}).scrollIntoViewIfNeeded();},'bot-long-path',{navigate:false});
        const longPathGeometry=await bot.getByRole('list',{name:'Opções escolhidas no robô'}).locator('li').evaluateAll(rows=>rows.map(row=>{
          const bounds=row.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(row);
          return {width:bounds.width,clipped:[...range.getClientRects()].some(rect=>rect.left<bounds.left-1||rect.right>bounds.right+1)};
        }));
        assert.equal(longPathGeometry.length,20);assert.ok(longPathGeometry.every(row=>!row.clipped),'Bot labels must fit inside their rows');
        api.whatsappRead.setBotSession(whatsappReadIds.first,null);
        await page.getByRole('button',{name:'Atualizar mensagens',exact:true}).click();
        await capture(page,app,role,path,width,async()=>{await expect(bot.getByText('Nenhum percurso do robô registrado nesta conversa.',{exact:true})).toBeVisible();},'bot-no-session',{navigate:false});
        api.whatsappRead.setBotSession(whatsappReadIds.first,whatsappBotSessionFixture);
        await page.getByRole('button',{name:'Atualizar mensagens',exact:true}).click();
        await expect(bot.getByText('Médico sintético',{exact:true})).toBeVisible();
        api.whatsappRead.setFailure('botSession','forbidden');
        await page.getByRole('button',{name:'Atualizar mensagens',exact:true}).click();
        const documentTime=await page.evaluate(()=>performance.timeOrigin);
        await capture(page,app,role,path,width,async()=>{await expect(bot.getByRole('alert')).toBeVisible();await expect(bot.getByText('Médico sintético',{exact:true})).toHaveCount(0);await expect(bot.getByText('Agendamento',{exact:true})).toHaveCount(0);await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();},'bot-denied',{navigate:false});
        api.whatsappRead.setFailure('botSession',null);
        await page.getByRole('button',{name:'Tentar carregar caminho',exact:true}).click();
        await capture(page,app,role,path,width,async()=>{await expect(bot.getByText('Médico sintético',{exact:true})).toBeVisible();},'bot-recovered',{navigate:false});
        assert.equal(await page.evaluate(()=>performance.timeOrigin),documentTime);
        checks.push({width,botReadOnly:true,pathLimit20:true,longLabel24:true,longPathGeometry,noSessionDistinct:true,previousPathVisibleBeforeRefusal:true,refusedPathHidden:true,messagesPreserved:true,botRetrySameDocument:true});
      }
      api.whatsappRead.setFailure('messages', 'forbidden'); await page.getByRole('button', { name: 'Atualizar mensagens' }).click();
      await capture(page, app, role, path, width, async () => { await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByText('Mensagem sintética recebida', { exact: true })).toHaveCount(0); }, 'messages-denied', { navigate: false });
      api.whatsappRead.setFailure('messages', null); await page.getByRole('button', { name: 'Tentar carregar mensagens' }).click();
      await capture(page, app, role, path, width, async () => { await expect(page.getByText('Mensagem sintética recebida', { exact: true })).toBeVisible(); }, 'messages-recovered', { navigate: false });
      await page.getByRole('button', { name: 'Voltar à lista' }).click(); await expect(page.getByRole('heading', { name: 'Lista de conversas' })).toBeFocused();
      await page.getByLabel('Buscar conversa', { exact: true }).fill('sem resultado sintético'); await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await capture(page, app, role, path, width, async () => { await expect(page.getByText('Nenhuma conversa neste filtro.', { exact: true })).toBeVisible(); }, 'inbox-empty', { navigate: false });
      await page.getByLabel('Buscar conversa', { exact: true }).fill(''); await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await page.getByLabel('Filtrar conversas').selectOption('mine');
      await capture(page, app, role, path, width, async () => { await expect(page.getByRole('button', { name: /Abrir conversa com/ })).toHaveCount(1); await expect(page.getByRole('button', { name: 'Abrir conversa com Contato sintético A' })).toBeVisible(); }, 'inbox-mine', { navigate: false });
      await page.getByLabel('Filtrar conversas').selectOption('closed');
      await capture(page, app, role, path, width, async () => { await expect(page.getByRole('button', { name: 'Abrir conversa com Contato sintético encerrado' })).toBeVisible(); }, 'inbox-closed', { navigate: false });
    }
  }
  if(historyReview){
    api.whatsappRead.setHistoryReview(true);
    const list=page.getByRole('list',{name:'Mensagens da conversa'});
    const captureHistory=async(width,action,variant,{navigate=false}={})=>capture(page,app,role,path,width,async()=>{
      await action();
      const controls=[];
      for(const button of await page.getByRole('navigation',{name:'Páginas da conversa'}).getByRole('button').all()){
        await button.scrollIntoViewIfNeeded();
        controls.push(await button.evaluate(element=>{
          const bounds=element.getBoundingClientRect(),hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
          return {width:bounds.width,height:bounds.height,left:bounds.left,right:bounds.right,viewport:innerWidth,onTop:!!hit&&element.contains(hit)};
        }));
      }
      assert.ok(controls.length>0&&controls.every(c=>c.height>=44&&c.left>=-1&&c.right<=c.viewport+1&&c.onTop),'History controls must fit and remain reachable');
      checks.push({historyVariant:variant,width,controls});
    },variant,{navigate,viewportOnly:true});
    const ready=async(count)=>{
      await expect(list.locator(':scope > li')).toHaveCount(count);
      await expect(page.getByText('Carregando caminho…',{exact:true})).toHaveCount(0);
    };
    for(const width of [320,375,1440]){
      await captureHistory(width,async()=>{
        await page.getByRole('button',{name:'Abrir conversa com Contato sintético A',exact:true}).click();await ready(50);
        await expect(list.locator(':scope > li').first()).toContainText('Mensagem de histórico sintética 101');
        await expect(list.locator(':scope > li').last()).toContainText('Mensagem de histórico sintética 150');
      },'history-recent',{navigate:true});
      await page.getByRole('button',{name:'Mensagens anteriores',exact:true}).click();
      await captureHistory(width,async()=>{
        await ready(50);await expect(page.getByRole('heading',{name:'Mensagens da conversa',exact:true})).toBeFocused();
        await expect(list.locator(':scope > li').first()).toContainText('Mensagem de histórico sintética 51');
        await expect(page.getByText('Mensagem de histórico sintética 150',{exact:true})).toHaveCount(0);
      },'history-older',{navigate:false});
      await page.getByRole('button',{name:'Mensagens anteriores',exact:true}).click();
      await captureHistory(width,async()=>{
        await ready(3);await expect(page.getByRole('button',{name:'Mensagens anteriores',exact:true})).toHaveCount(0);
        await expect(list.locator(':scope > li').first()).toContainText('Mensagem de histórico sintética 48');
        await expect(page.getByRole('button',{name:'Mensagens mais recentes',exact:true})).toBeVisible();
      },'history-end',{navigate:false});
      await page.getByRole('button',{name:'Atualizar mensagens',exact:true}).click();
      await captureHistory(width,async()=>{await ready(50);await expect(page.getByText('Mensagem de histórico sintética 150',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Mensagens mais recentes',exact:true})).toHaveCount(0);},'history-refreshed',{navigate:false});
      if(width===375){
        api.whatsappRead.setFailure('messages','forbidden');await page.getByRole('button',{name:'Mensagens anteriores',exact:true}).click();
        await captureHistory(width,async()=>{
          await expect(page.getByRole('button',{name:'Tentar carregar mensagens',exact:true})).toBeVisible();await expect(list).toHaveCount(0);
          await expect(page.getByRole('button',{name:'Mensagens mais recentes',exact:true})).toBeVisible();
        },'history-denied',{navigate:false});
        api.whatsappRead.setFailure('messages',null);await page.getByRole('button',{name:'Tentar carregar mensagens',exact:true}).click();
        await captureHistory(width,async()=>{await ready(50);await expect(page.getByRole('heading',{name:'Mensagens da conversa',exact:true})).toBeFocused();await expect(page.getByText('Mensagem de histórico sintética 100',{exact:true})).toBeVisible();},'history-recovered',{navigate:false});
      }
      checks.push({width,historyPages:3,boundedPageSizes:[50,50,3],pageReplaced:true,resetFromRefresh:true,focusOnHistory:true});
    }
    const cursors=api.whatsappRead.calls.filter(call=>call.input.action==='messages'&&call.input.before!=null).map(call=>call.input.before);
    assert.ok(cursors.includes(whatsappHistoryCursors.first)&&cursors.includes(whatsappHistoryCursors.second));
    assert.ok(cursors.every(cursor=>Object.values(whatsappHistoryCursors).includes(cursor)),'Cursor changed precision or identity');
    checks.push({fullHistoryCursorTokens:true,historyRefusalRetry:true});
    api.whatsappRead.setHistoryReview(false);
  }
  if(listReview){
    api.whatsappRead.setListReview(true);
    const rows=page.getByRole('button',{name:/Abrir conversa com Contato paginado sintético/});
    const captureList=async(width,action,variant,{navigate=false}={})=>capture(page,app,role,path,width,async()=>{
      await action();const controls=[];
      for(const button of await page.getByRole('navigation',{name:'Páginas das conversas'}).getByRole('button').all()){
        await button.scrollIntoViewIfNeeded();controls.push(await button.evaluate(element=>{
          const bounds=element.getBoundingClientRect(),hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
          return {width:bounds.width,height:bounds.height,left:bounds.left,right:bounds.right,viewport:innerWidth,onTop:!!hit&&element.contains(hit)};
        }));
      }
      assert.ok(controls.every(c=>c.height>=44&&c.left>=-1&&c.right<=c.viewport+1&&c.onTop),'Conversation paging controls must fit and remain reachable');
      checks.push({listVariant:variant,width,controls});
    },variant,{navigate,viewportOnly:true});
    for(const width of [320,375,1440]){
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(50);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 150');
        await expect(rows.last()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 101');
        await expect(page.getByRole('button',{name:'Conversas mais recentes',exact:true})).toHaveCount(0);
      },'list-recent',{navigate:true});
      const documentTime=await page.evaluate(()=>performance.timeOrigin);
      await rows.first().click();await expect(page.getByText('Mensagem sintética recebida',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Conversas anteriores',exact:true}).click();
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(50);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 100');
        await expect(rows.last()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 51');
        await expect(page.getByRole('region',{name:'Conversa selecionada'})).toHaveCount(0);
        await expect(page.getByRole('heading',{name:'Lista de conversas',exact:true})).toBeFocused();
      },'list-older');
      await page.getByRole('button',{name:'Conversas anteriores',exact:true}).click();
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(3);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 50');
        await expect(rows.last()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 48');
        await expect(page.getByRole('button',{name:'Conversas anteriores',exact:true})).toHaveCount(0);
      },'list-end');
      await page.getByLabel('Filtrar conversas').selectOption('mine');
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(50);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 150');
        await expect(page.getByRole('button',{name:'Conversas mais recentes',exact:true})).toHaveCount(0);
      },'list-filter-reset');
      await page.getByRole('button',{name:'Conversas anteriores',exact:true}).click();await expect(rows).toHaveCount(2);
      await page.getByLabel('Buscar conversa',{exact:true}).fill('Contato paginado sintético 150');await page.getByRole('button',{name:'Buscar',exact:true}).click();
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(1);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 150');
        await expect(page.getByRole('navigation',{name:'Páginas das conversas'})).toHaveCount(0);
        await rows.first().scrollIntoViewIfNeeded();
      },'list-search-reset');
      await page.getByLabel('Buscar conversa',{exact:true}).fill('');await page.getByRole('button',{name:'Buscar',exact:true}).click();await expect(rows).toHaveCount(50);
      await page.getByLabel('Filtrar conversas').selectOption('open');await expect(rows.last()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 101');
      await page.getByRole('button',{name:'Conversas anteriores',exact:true}).click();await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 100');
      await page.getByRole('button',{name:'Atualizar conversas',exact:true}).click();
      await captureList(width,async()=>{
        await expect(rows).toHaveCount(50);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 150');
        await expect(page.getByRole('button',{name:'Conversas mais recentes',exact:true})).toHaveCount(0);
      },'list-refresh-reset');
      if(width===375){
        api.whatsappRead.setFailure('conversations','forbidden');await page.getByRole('button',{name:'Conversas anteriores',exact:true}).click();
        await captureList(width,async()=>{
          await expect(page.getByRole('button',{name:'Tentar carregar conversas',exact:true})).toBeVisible();await expect(rows).toHaveCount(0);
          await expect(page.getByRole('button',{name:'Conversas mais recentes',exact:true})).toBeVisible();
        },'list-page-denied');
        api.whatsappRead.setFailure('conversations',null);await page.getByRole('button',{name:'Tentar carregar conversas',exact:true}).click();
        await captureList(width,async()=>{
          await expect(rows).toHaveCount(50);await expect(rows.first()).toHaveAccessibleName('Abrir conversa com Contato paginado sintético 100');
          await expect(page.getByRole('heading',{name:'Lista de conversas',exact:true})).toBeFocused();
        },'list-page-recovered');
      }
      assert.equal(await page.evaluate(()=>performance.timeOrigin),documentTime);
      checks.push({width,listPages:3,boundedPageSizes:[50,50,3],pageReplaced:true,selectionCleared:true,filterAndSearchReset:true,refreshToRecent:true,sameDocument:true});
    }
    const cursors=api.whatsappRead.calls.filter(call=>call.input.action==='conversations'&&call.input.before!=null).map(call=>call.input.before);
    assert.ok(cursors.includes(whatsappListCursors.first)&&cursors.includes(whatsappListCursors.second));
    assert.ok(cursors.every(cursor=>cursor.startsWith('2026-11-06T18:30:00.123456+00:00|a3100000-0000-4000-8000-')),'Conversation cursor lost precision or identity');
    checks.push({fullListCursorTokens:true,listRefusalRetry:true});api.whatsappRead.setListReview(false);
  }
  const admin = await scene(app, 'admin', path);
  for (const width of [375, 1440]) await capture(admin, app, 'admin', path, width, async () => { await expect(admin.getByRole('button', { name: /Abrir conversa com/ })).toHaveCount(2); }, 'inbox-admin');
  const allowedReads = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /functions/v1/whatsapp-api']);
  assert.ok(requests.every(call => allowedReads.has(call.method + ' ' + call.path)), 'Inbox mounted an unrelated data reader');
  checks.push({ beforeQueueTabOnlyInboxReads: true, calls: requests.length });
  await page.getByRole('button', { name: 'Atendimentos', exact: true }).click();
  await capture(page, app, role, path, 1280, async () => { await expect(page.getByRole('heading', { name: 'Fila de atendimento', exact: true })).toBeVisible(); }, 'queue-tab-regression', { navigate: false });
  assert.equal(new URL(page.url()).searchParams.get('status'), 'open'); assert.equal(new URL(page.url()).searchParams.has('view'), false);
  assert.ok(requests.some(call => call.path.endsWith('/reception_queue')));
  await page.getByRole('button', { name: 'Conversas', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Conversas', exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('status'), 'open'); checks.push({ queueTabAndReturn: true, filtersPreserved: true });
  assert.ok(api.whatsappRead.calls.every(call => ['state', 'conversations', 'messages','botSession'].includes(call.input.action)));
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['bookings', 'contacts', 'caseWrites']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(errorResponses.length, (botReview?4:3)+(historyReview?1:0)+(listReview?1:0)); assert.ok(errorResponses.every(item => item.status === 403 && item.path === '/functions/v1/whatsapp-api'));
  assert.equal(consoleErrors.length, (botReview?4:3)+(historyReview?1:0)+(listReview?1:0)); assert.ok(consoleErrors.every(item => /403/.test(item.message)));
  assert.equal(screens.length, (botReview?32:28)+(historyReview?14:0)+(listReview?20:0));
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.dialogOutsideViewport && !screen.recoveryScreen);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
}
