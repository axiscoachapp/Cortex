import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function auditContactCorrectionContext({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const path = '/recepcao/contatos', role = 'admin';
  let denials = 0;
  for (const width of [320, 375, 1280, 1920]) {
    const page = await scene(app, role, path);
    let failNext = false;
    await page.route(api.origin + '/rest/v1/rpc/clinic_access', async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      assert.equal(route.request().method(), 'POST');
      if (!failNext) return route.continue();
      failNext = false; denials++;
      return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin },
        body: JSON.stringify({ code: 'PGRST000', message: 'Synthetic access unavailable', details: null, hint: null }) });
    });
    const take = (variant, action) => capture(page, app, role, path, width, action, 'contact-correction-context-' + variant, { navigate: false, viewportOnly: true });
    await page.getByRole('button', { name: 'Corrigir contato', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Corrigir contato' });
    await expect(modal.getByLabel('Nome do contato')).toHaveValue('Família Exemplo');
    await modal.getByLabel('Nome do contato').fill('Rascunho sintético de correção');
    await modal.getByRole('checkbox', { name: /Conferi a identidade/ }).check();
    await take('draft', async () => { await expect(modal.getByLabel('Nome do contato')).toHaveValue('Rascunho sintético de correção'); await expect(modal.getByRole('button', { name: 'Salvar correção', exact: true })).toBeEnabled(); });
    failNext = true;
    await expect(page.getByRole('heading', { name: 'Verificação de acesso', exact: true })).toBeVisible({ timeout: 20_000 });
    await take('access-blocked', async () => { await expect(modal).toHaveCount(0); await expect(page.getByLabel('Nome do contato')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Salvar correção', exact: true })).toHaveCount(0); });
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await take('recovered-invalid', async () => {
      await expect(modal.getByRole('alert')).toContainText('Esta correção foi interrompida.');
      await expect(modal.getByLabel('Nome do contato')).toHaveCount(0);
      await expect(modal.getByRole('button', { name: 'Fechar correção' })).toBeVisible();
    });
    await modal.getByRole('button', { name: 'Fechar correção' }).click();
    await take('closed', async () => { await expect(modal).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Família Exemplo', exact: true })).toBeVisible(); });
    await page.getByRole('button', { name: 'Corrigir contato', exact: true }).click();
    await take('fresh-window', async () => {
      await expect(modal.getByLabel('Nome do contato')).toHaveValue('Família Exemplo');
      await expect(modal.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked();
      await expect(modal.getByRole('button', { name: 'Salvar correção', exact: true })).toBeDisabled();
    });
    await modal.getByRole('button', { name: 'Voltar', exact: true }).click();
    checks.push({ width, hiddenWorkspaceRemovesEditor: true, recoveredContextCannotReviveDraft: true, explicitCloseAndReopen: true, noSubmission: true });
  }
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_contacts', 'POST /rest/v1/rpc/reception_contact_edit']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected request: ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(denials, 4); assert.equal(errorResponses.length, 4); assert.ok(errorResponses.every(r => r.status === 503 && r.path === '/rest/v1/rpc/clinic_access'));
  assert.equal(consoleErrors.length, 4); assert.ok(consoleErrors.every(r => /503/.test(r.message))); assert.equal(screens.length, 20);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport && screen.dialogHorizontalOverflow <= 1 && screen.dialogActionReachable !== false);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
  checks.push({ states: screens.length, requests: requests.length, expected503: 4, zeroWrites: true, lateMutationAndRecoveryEffects: 'unit tests only' });
}
