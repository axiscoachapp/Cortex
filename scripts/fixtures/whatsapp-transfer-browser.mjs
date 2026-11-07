// Isolated UI transport only: synthetic people/store/commands, no producer/Auth/CAS claim.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { ids } from './reception-api.mjs';
import { whatsappReadIds } from './whatsapp-read-api.mjs';

export async function auditWhatsAppTransfer({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const role = 'recepcao-a', path = '/recepcao?view=conversations&status=open', acts = [], catalogueCalls = [], unexpected = [];
  const members = [
    { userId: ids.admin, name: 'Administrador sintético', role: 'admin', ambiguous: false },
    { userId: ids.a, name: 'Pessoa atual', role: 'reception', ambiguous: false },
    { userId: ids.b, name: 'Atendente sintético B', role: 'reception', ambiguous: false },
    ...Array.from({ length: 9 }, (_, i) => ({ userId: `80000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      name: i === 0 || i === 8 ? 'Nome repetido' : i === 1 ? 'Pessoa sintética '.repeat(16).slice(0, 256) : `Atendente extra sintético ${i + 1}`, role: 'reception', ambiguous: i === 0 || i === 8 })),
  ];
  const cursor = `a1.${members[9].userId}`, longName = members[4].name;
  for (const width of [320, 375, 1280, 1920]) {
    let owner = ids.a, revision = 1, rosterMode = 'hold', actMode = 'success', failDetail = false, release;
    const beforeActs = acts.length;
    const profile = 'Contato sintético A · ' + 'PerfilSintéticoLongo'.repeat(6);
    const decorate = row => row.id === whatsappReadIds.first ? { ...row, assignedTo: owner, revision, profileName: profile } : row;
    const page = await scene(app, role, path, async page => {
      await page.route(api.origin + '/functions/v1/whatsapp-api', async route => {
        if (route.request().method() === 'OPTIONS') return route.continue();
        const input = route.request().postDataJSON();
        const respond = (status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin }, body: JSON.stringify(data) });
        try {
          assert.equal(route.request().method(), 'POST');
          if (input.action === 'assignees') {
            assert.deepEqual(input, { action: 'assignees', before: input.before, limit: 10 }); assert.ok(input.before === null || input.before === cursor);
            catalogueCalls.push({ width, before: input.before }); const mode = rosterMode; rosterMode = 'normal';
            if (mode === 'hold') await new Promise(resolve => { release = resolve; });
            if (mode === 'denied') return respond(403, { code: 'directory_unavailable', error: 'PRIVATE SYNTHETIC DIRECTORY' });
            return respond(200, mode === 'empty' ? { items: [], nextBefore: null } : { items: input.before === null ? members.slice(0, 10) : members.slice(10), nextBefore: input.before === null ? cursor : null });
          }
          if (input.action === 'act') {
            assert.deepEqual(input, { action: 'act', operation: 'assign', conversationId: whatsappReadIds.first, revision, targetUserId: ids.b }); assert.equal(owner, ids.a);
            const mode = actMode; actMode = 'success'; const record = { width, revision, targetUserId: input.targetUserId, mode, applied: mode !== 'stale', successfulReads: [] }; acts.push(record);
            // Simulated concurrent transfer for stale; otherwise this synthetic command changes ownership.
            owner = ids.b; revision++;
            if (mode === 'stale') return respond(409, { code: 'stale', error: 'SYNTHETIC CONCURRENT CHANGE' });
            if (mode === 'unconfirmed') { failDetail = true; return respond(200, { unexpected: true }); }
            const receipt={ revision, status: 'open', assignedTo: owner };
            if(mode==='replaced'){owner=ids.a;revision++;}
            return respond(200, receipt);
          }
          assert.ok(['state', 'conversations', 'messages', 'botSession'].includes(input.action), 'Unexpected action ' + input.action);
          if (input.action === 'messages' && failDetail) { failDetail = false; return respond(403, { code: 'forbidden', error: 'PRIVATE SYNTHETIC READ' }); }
          const result = structuredClone(api.whatsappRead.handle(ids.a, input));
          assert.equal(result.status, 200);
          if (input.action === 'conversations') result.data.conversations = result.data.conversations.map(decorate);
          if (input.action === 'messages') result.data.conversation = decorate(result.data.conversation);
          const last=acts.at(-1);if(last?.width===width&&['conversations','messages'].includes(input.action))last.successfulReads.push({action:input.action,owner,revision});
          return respond(result.status, result.data);
        } catch (error) { unexpected.push(error.message); return respond(500, { code: 'unavailable' }); }
      });
    });
    const modal = () => page.getByRole('dialog', { name: 'Transferir conversa', exact: true });
    const take = (variant, action) => capture(page, app, role, path, width, async()=>{await action();if(await modal().count())assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(await modal().innerText()),'UUID exposed in modal text');}, 'transfer-' + variant, { navigate: false, viewportOnly: true, waitForNetwork: !variant.endsWith('pending') });
    const open = async () => { await page.getByRole('button', { name: /^Abrir conversa com Contato sintético A/ }).click(); await expect(page.getByRole('button', { name: 'Transferir conversa', exact: true })).toBeEnabled(); };
    const choose = async () => { await page.getByRole('button', { name: 'Transferir conversa', exact: true }).click(); await modal().getByRole('button', { name: 'Selecionar Atendente sintético B', exact: true }).click(); };
    const resetOwn = async () => { owner = ids.a; revision++; await page.getByRole('button', { name: 'Atualizar conversas', exact: true }).click(); await open(); };
    const readBack = async (expected='Outra pessoa') => { for(const action of ['conversations','messages'])await expect.poll(()=>acts.at(-1)?.successfulReads.some(read=>read.action===action)).toBe(true); await expect(page.getByText('Dados atualizados. Confira o responsável atual na conversa.', { exact: true })).toBeVisible(); await expect(page.getByText(expected, { exact: true })).toBeVisible(); if(expected==='Você')await expect(page.getByRole('button',{name:'Transferir conversa',exact:true})).toBeEnabled();else await expect(page.getByRole('button', { name: 'Transferir conversa', exact: true })).toHaveCount(0); };
    try {
      await open(); await page.getByRole('button', { name: 'Transferir conversa', exact: true }).click(); await expect.poll(() => typeof release).toBe('function');
      await take('pending', async () => { await expect(modal().getByRole('status')).toHaveText('Verificando conexão e consultando atendentes…'); await expect(modal().getByText(members[2].name, { exact: true })).toHaveCount(0); });
      release(); release = undefined;
      await take('choices', async () => {
        await expect(modal().getByRole('button', { name: 'Selecionar Atendente sintético B', exact: true })).toBeEnabled();
        await expect(modal().getByRole('button', { name: 'Selecionar Pessoa atual', exact: true })).toBeDisabled();
        await expect(modal().getByRole('button', { name: 'Selecionar Nome repetido', exact: true })).toBeDisabled();
        await expect(modal().getByText(ids.b, { exact: true })).toHaveCount(0); await modal().evaluate(node => { node.scrollTop = 0; });
      });
      await take('long-name', async () => { const button = modal().getByRole('button', { name: 'Selecionar ' + longName, exact: true }); await button.scrollIntoViewIfNeeded();
        const heights = await modal().locator('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height)); assert.ok(heights.every(height => height >= 44)); });
      await modal().getByRole('button', { name: 'Selecionar Atendente sintético B', exact: true }).click();
      await take('confirmation', async () => { await expect(modal().getByText(/Novo responsável/)).toContainText('Atendente sintético B'); await expect(modal().getByRole('button', { name: 'Confirmar transferência', exact: true })).toBeEnabled(); assert.equal(acts.length, beforeActs); });
      await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
      await take('cancelled', async () => { await expect(modal()).toHaveCount(0); await expect(page.getByRole('button', { name: 'Transferir conversa', exact: true })).toBeFocused(); assert.equal(acts.length, beforeActs); });
      await page.getByRole('button', { name: 'Transferir conversa', exact: true }).click(); await modal().getByRole('button', { name: 'Próximos atendentes', exact: true }).click();
      await take('next-page', async () => { await expect(modal().getByRole('button', { name: 'Selecionar Atendente sintético B', exact: true })).toHaveCount(0); await expect(modal().getByRole('button', { name: 'Primeiros atendentes', exact: true })).toBeEnabled(); });
      rosterMode = 'denied'; await modal().getByRole('button', { name: 'Atualizar atendentes', exact: true }).click();
      await take('directory-denied', async () => { await expect(modal().getByRole('alert')).not.toContainText('PRIVATE'); await expect(modal().getByRole('button', { name: /^Selecionar / })).toHaveCount(0); });
      rosterMode = 'empty'; await modal().getByRole('button', { name: 'Atualizar atendentes', exact: true }).click();
      await take('empty', async () => { await expect(modal().getByText('Nenhum atendente nesta página.', { exact: true })).toBeVisible(); await expect(modal().getByRole('button', { name: 'Confirmar transferência', exact: true })).toHaveCount(0); });
      await modal().getByRole('button', { name: 'Atualizar atendentes', exact: true }).click();
      await take('recovered',async()=>{await expect(modal().getByRole('button',{name:'Selecionar Atendente sintético B',exact:true})).toBeEnabled();await expect(modal().getByRole('button',{name:'Confirmar transferência',exact:true})).toHaveCount(0);});
      await modal().getByRole('button', { name: 'Selecionar Atendente sintético B', exact: true }).click(); actMode = 'stale';
      await modal().getByRole('button', { name: 'Confirmar transferência', exact: true }).click();
      await take('stale-readback', async () => { await readBack(); assert.equal(acts.length, beforeActs + 1); assert.equal(acts.at(-1).applied, false); });
      await resetOwn(); await choose(); actMode = 'unconfirmed'; await modal().getByRole('button', { name: 'Confirmar transferência', exact: true }).click();
      await take('unresolved', async () => { await expect(page.getByRole('alert')).toContainText('Não foi possível conferir o responsável.'); await page.getByRole('alert').evaluate(node => node.scrollIntoView({ block: 'start' })); assert.equal(acts.length, beforeActs + 2); });
      await page.getByRole('button', { name: 'Conferir responsável', exact: true }).click();
      await take('read-retry', async () => { await readBack(); assert.equal(acts.length, beforeActs + 2); });
      await resetOwn(); await choose(); actMode='replaced'; await modal().getByRole('button', { name: 'Confirmar transferência', exact: true }).click();
      await take('success-readback', async () => { await readBack('Você'); assert.equal(acts.length, beforeActs + 3); });
      checks.push({ width, explicitChoice: true, selfAndAmbiguousDisabled: true, noUuid: true, freshPagesAndRetry: true, confirmedRequests: 3, readBackOnlyRetry: true, simulatedStaleNotApplied: true, divergentReceiptIgnored: true, targets44px: true });
    } finally { if (release) release(); await page.close(); }
  }
  assert.deepEqual(unexpected, []);
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /functions/v1/whatsapp-api']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected request ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(errorResponses.length, 12); assert.ok(errorResponses.every(r => [403, 409].includes(r.status) && r.path === '/functions/v1/whatsapp-api'));
  assert.equal(consoleErrors.length, 12); assert.ok(consoleErrors.every(r => /403|409/.test(r.message))); assert.equal(screens.length, 52);
  for (const screen of screens) { assert.ok(screen.overflow <= 1 && screen.dialogHorizontalOverflow <= 1 && !screen.dialogOutsideViewport && screen.dialogActionReachable !== false && !screen.recoveryScreen); for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []); }
  checks.push({ states: screens.length, requests: requests.length, catalogueReads: catalogueCalls.length, simulatedActs: acts, expectedErrorResponses: 12, noOtherWritesOrExternalCalls: true, limits: 'UI transport synthetic; real authorization/CAS/Meta not exercised' });
}
