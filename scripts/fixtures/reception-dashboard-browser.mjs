// Synthetic read-only DTO transport. SQL/Auth/producer correctness is proved separately.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function auditReceptionDashboard({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const path = '/recepcao/painel', role = 'recepcao-a', calls = [], unexpected = [];
  const owners = Array.from({ length: 12 }, (_, i) => ({
    userId: `90000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: i === 0 ? 'Pessoa sintética '.repeat(16).slice(0, 256) : i === 1 || i === 11 ? 'Equipe sintética' : `Pessoa sintética ${i + 1}`,
    role: i % 2 ? 'admin' : 'reception', ambiguous: i === 1 || i === 11, openCount: 2,
  }));
  const cursor = `a1.${owners[9].userId}`;
  function dto(body, mode) {
    const items = mode === 'no-owners' ? [] : body.before === null ? owners.slice(0, 10) : owners.slice(10);
    return {
      schemaVersion: 1, asOf: body.before === null ? '2026-11-05T15:01:00Z' : '2026-11-05T15:02:00Z', window: { from: body.from, to: body.to, timeZone: 'America/Sao_Paulo' }, coverage: 'latest_cycle_only',
      cohort: mode === 'empty' ? { incomingCycles: 0, withHumanSend: 0, withoutHumanSend: 0, medianFirstHumanSendSeconds: null, closedWithoutHumanSend: 0 }
        : { incomingCycles: 60, withHumanSend: 40, withoutHumanSend: 20, medianFirstHumanSendSeconds: body.before === null ? 95 : 125, closedWithoutHumanSend: 5 },
      openNow: { total: mode === 'no-owners' ? 6 : body.before === null ? 30 : 34, unassigned: body.before === null ? 4 : 8, assignedToIneligible: 2, owners: { items, nextBefore: mode !== 'no-owners' && body.before === null ? cursor : null } },
      unavailable: { abandonment: 'no_explicit_event', appointments: 'scoped_source_required' },
    };
  }
  for (const width of [320, 375, 1280, 1920, 768, 1024, 1440]) {
    let mode = 'hold', release;
    const page = await scene(app, role, path, async page => {
      await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
      await page.route(api.origin + '/functions/v1/whatsapp-api', async route => {
        if (route.request().method() === 'OPTIONS') return route.continue();
        const body = route.request().postDataJSON(), selected = mode; mode = 'normal'; calls.push(body);
        try {
          assert.equal(route.request().method(), 'POST');
          assert.deepEqual(Object.keys(body).sort(), ['action', 'before', 'from', 'limit', 'to']);
          assert.equal(body.action, 'dashboard'); assert.equal(body.limit, 10); assert.ok(body.before === null || body.before === cursor);
          assert.ok(Date.parse(body.to) - Date.parse(body.from) <= 31 * 86_400_000 && Date.parse(body.from) < Date.parse(body.to));
        } catch (error) { unexpected.push(error.message); return route.fulfill({ status: 500, body: '{}' }); }
        if (selected.startsWith('hold')) await new Promise(resolve => { release = resolve; });
        return route.fulfill({ status: selected === 'hold-denied' ? 403 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin },
          body: JSON.stringify(selected === 'hold-denied' ? { code: 'forbidden', error: 'PRIVATE SYNTHETIC ERROR' } : dto(body, selected)) });
      });
    });
    const take = (variant, action) => capture(page, app, role, path, width, action, 'dashboard-' + variant, { navigate: false, waitForNetwork: !variant.endsWith('pending') });
    const visible = () => expect(page.getByText('Pessoa sintética 3', { exact: true })).toBeVisible();
    const unavailable = () => expect(page.getByText('Não disponível', { exact: true })).toHaveCount(3);
    try {
      await expect.poll(() => typeof release).toBe('function');
      if ([768, 1024, 1440].includes(width)) {
        release(); release = undefined; await take('breakpoint', async () => { await visible(); await unavailable(); });
      } else {
        await take('initial-pending', async () => { await expect(page.getByRole('status')).toHaveText('Carregando painel…'); await page.getByRole('status').evaluate(node=>node.scrollIntoView({block:'start'})); await expect(page.getByText('Pessoa sintética 3', { exact: true })).toHaveCount(0); });
        release(); release = undefined;
        await take('first-page', async () => {
          await visible(); await unavailable(); await expect(page.getByText('1 min 35 s', { exact: true })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Painel', exact: true })).toHaveAttribute('aria-current', 'page');
          const fields = page.locator('main input[type="date"],main input[type="time"]'); await expect(fields).toHaveCount(4);
          const bounds = await fields.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }));
          assert.ok(bounds.every(r => r.width >= (width < 864 ? 220 : 190) && r.height >= 44));
          assert.ok(width < 864 ? bounds[1].top >= bounds[0].bottom : Math.abs(bounds[1].top - bounds[0].top) < 1);
          const controls = await page.locator('main button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height)); assert.ok(controls.every(height => height >= 44));
          await page.getByLabel('Data inicial', { exact: true }).evaluate(node=>node.scrollIntoView({block:'start'}));
        });
        await take('form-end', async () => { await page.getByLabel('Hora final', { exact: true }).evaluate(node=>node.scrollIntoView({block:'start'})); });
        for(const [variant,target] of [['cohort','Entradas no período'],['owners','Em aberto agora'],['availability','Indicadores ainda indisponíveis']])await take(variant,async()=>{await page.getByRole('heading',{name:target,exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));});
        await take('first-human',async()=>{await page.getByRole('heading',{name:'Primeiro envio humano · tempo corrido',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));});
        await take('long-owner',async()=>{await page.getByText(owners[0].name,{exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));});
        await page.getByRole('button', { name: 'Próximos responsáveis', exact: true }).click();
        await take('next-page', async () => { await expect(page.getByText('Pessoa sintética 11', { exact: true })).toBeVisible(); await page.getByText('Pessoa sintética 11', { exact: true }).evaluate(node=>node.scrollIntoView({block:'start'})); await expect(page.getByText('2 min 5 s', { exact: true })).toBeVisible(); await expect(page.getByText('Atualizado em 05/11/2026 às 12:02 · São Paulo', { exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: 'Em aberto agora' }).locator('dt').filter({ hasText: /^Conversas em aberto$/ }).locator('..').locator('dd')).toHaveText('34'); await expect(page.getByText('Pessoa sintética 3', { exact: true })).toHaveCount(0); await unavailable(); });
        mode = 'hold-denied'; await page.getByRole('button', { name: 'Atualizar painel', exact: true }).click(); await expect.poll(() => typeof release).toBe('function');
        await take('refresh-pending', async () => { await expect(page.getByRole('status')).toHaveText('Carregando painel…'); await page.getByRole('status').evaluate(node=>node.scrollIntoView({block:'start'})); await expect(page.getByText('Pessoa sintética 11', { exact: true })).toHaveCount(0); });
        release(); release = undefined;
        await take('denied', async () => { await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o painel.'); await page.getByRole('alert').evaluate(node=>node.scrollIntoView({block:'start'})); await expect(page.getByRole('alert')).not.toContainText('PRIVATE'); await expect(page.getByText('Não disponível', { exact: true })).toHaveCount(0); });
        mode = 'empty'; await page.getByRole('button', { name: 'Tentar carregar painel', exact: true }).click();
        await take('empty-cohort', async () => { await visible(); await expect(page.getByText('Sem amostra', { exact: true })).toBeVisible(); await page.getByText('Sem amostra', { exact: true }).evaluate(node=>node.scrollIntoView({block:'start'})); await expect(page.getByText(/Nenhuma entrada no período/)).toBeVisible(); await unavailable(); });
        const count = calls.length; await page.getByLabel('Data inicial', { exact: true }).fill('2026-11-06');
        await page.getByRole('button', { name: 'Aplicar período', exact: true }).click();
        await take('invalid-period', async () => { await expect(page.getByRole('alert')).toBeFocused(); await expect(page.getByText('Pessoa sintética 3', { exact: true })).toHaveCount(0); assert.equal(calls.length, count); });
        await page.getByLabel('Data inicial', { exact: true }).fill('2026-11-02'); mode = 'no-owners';
        await page.getByRole('button', { name: 'Aplicar período', exact: true }).click();
        await take('applied-no-owners', async () => { await expect(page.getByText(/Nenhuma conversa em aberto atribuída/)).toBeVisible(); await page.getByText(/Nenhuma conversa em aberto atribuída/).evaluate(node=>node.scrollIntoView({block:'start'})); await unavailable(); assert.equal(calls.at(-1).from, '2026-11-02T15:00:00.000Z'); });
      }
      checks.push({ width, fieldsAndControls44px: ![768,1024,1440].includes(width), unavailableNotZero: true, fullSnapshotReplaced: ![768,1024,1440].includes(width), longNames: true });
    } finally { if (release) release(); await page.close(); }
  }
  assert.deepEqual(unexpected, []);
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /functions/v1/whatsapp-api']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected dashboard request: ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(errorResponses.length, 4); assert.ok(errorResponses.every(r => r.status === 403 && r.path === '/functions/v1/whatsapp-api'));
  assert.equal(consoleErrors.length, 4); assert.ok(consoleErrors.every(r => /403/.test(r.message)));
  assert.equal(screens.length, 59);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
  checks.push({ states: screens.length, dashboardReads: calls.length, expected403: 4, zeroWrites: true, clock: '2026-11-05T15:00:00Z', scope: 'synthetic transport; authorization and aggregation checked separately' });
}
