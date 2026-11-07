import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function auditContactDirectory({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const path = '/recepcao/contatos', role = 'recepcao-a';
  let denials = 0;
  for (const width of [320, 375, 1280, 1920]) {
    const page = await scene(app, role, path);
    const directory = page.getByRole('region', { name: 'Diretório de contatos' });
    const heading = directory.getByRole('heading', { name: 'Família Exemplo', exact: true });
    const refresh = directory.getByRole('button', { name: 'Atualizar contatos', exact: true });
    const take = (variant, action) => capture(page, app, role, path, width, action, 'contact-directory-' + variant, { navigate: false, viewportOnly: true });
    let mode = 'normal', release;
    await page.route(api.origin + '/rest/v1/rpc/reception_contacts', async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      assert.equal(route.request().method(), 'POST');
      if (mode === 'hold') {
        mode = 'normal';
        await new Promise(resolve => { release = resolve; });
      }
      if (mode !== 'denied') return route.continue();
      denials++;
      return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin },
        body: JSON.stringify({ code: '42501', message: 'PRIVATE SYNTHETIC DIRECTORY', details: null, hint: null }) });
    });
    try {
      await take('initial', async () => {
        await expect(heading).toBeVisible();
        await expect(directory.getByRole('button', { name: 'Abrir atendimento' })).toBeVisible();
        await expect(directory.getByRole('button', { name: 'Corrigir contato' })).toHaveCount(0);
        await expect(directory.getByRole('button', { name: 'Consultar vínculos' })).toHaveCount(0);
      });
      mode = 'hold'; await refresh.click(); await expect.poll(() => typeof release).toBe('function');
      await take('pending', async () => {
        await expect(heading).toHaveCount(0);
        await expect(directory.getByRole('button', { name: 'Abrir atendimento' })).toHaveCount(0);
        await expect(directory.getByText('Nenhum contato encontrado neste filtro.')).toHaveCount(0);
        await expect(refresh).toBeDisabled();
      });
      release(); release = undefined; await expect(heading).toBeVisible();
      mode = 'denied'; await refresh.click();
      await take('denied', async () => {
        await expect(directory.getByRole('alert')).toContainText('Não foi possível carregar contatos.');
        await expect(directory.getByRole('alert')).not.toContainText('PRIVATE');
        await expect(heading).toHaveCount(0);
        await expect(directory.getByRole('button', { name: 'Abrir atendimento' })).toHaveCount(0);
        await expect(directory.getByText('Nenhum contato encontrado neste filtro.')).toHaveCount(0);
      });
      mode = 'normal'; await directory.getByRole('button', { name: 'Tentar carregar contatos' }).click();
      await take('recovered', async () => { await expect(heading).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0); });
      await directory.getByRole('textbox', { name: 'Buscar contatos' }).fill('Sem correspondência sintética');
      await take('empty', async () => { await expect(directory.getByText('Nenhum contato encontrado neste filtro.')).toBeVisible(); await expect(heading).toHaveCount(0); });
      await directory.getByRole('textbox', { name: 'Buscar contatos' }).fill('Fam');
      await take('filtered', async () => { await expect(heading).toBeVisible(); await expect(directory.getByRole('article')).toHaveCount(1); });
      await directory.getByRole('button', { name: 'Abrir atendimento', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Novo atendimento' });
      await take('selected', async () => { await expect(dialog.getByText('Família Exemplo', { exact: true })).toBeVisible(); await expect(dialog.getByLabel('Assunto administrativo')).toHaveValue(''); });
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await take('closed', async () => { await expect(dialog).toHaveCount(0); await expect(heading).toBeVisible(); });
      checks.push({ width, cachedRowsRetiredDuringRefreshAndError: true, retryOnlyReads: true, explicitSelectionOnly: true, noSubmission: true });
    } finally { if (release) release(); }
  }
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_contacts']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected request: ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(denials, 4); assert.equal(errorResponses.length, 4); assert.ok(errorResponses.every(r => r.status === 403 && r.path === '/rest/v1/rpc/reception_contacts'));
  assert.equal(consoleErrors.length, 4); assert.ok(consoleErrors.every(r => /403/.test(r.message))); assert.equal(screens.length, 32);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport && screen.dialogHorizontalOverflow <= 1 && screen.dialogActionReachable !== false);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
  checks.push({ states: screens.length, requests: requests.length, expected403: 4, zeroWrites: true, paginationContextAndCancellation: 'unit tests only' });
}
