import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function auditContactCorrectionReads({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const path = '/recepcao/contatos', role = 'admin'; let denials = 0, confirmations = 0;
  for (const width of [320, 375, 1280, 1920]) {
    const page = await scene(app, role, path); let mode = 'hold', release;
    await page.route(api.origin + '/rest/v1/rpc/reception_contact_edit', async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      assert.equal(route.request().method(), 'POST');
      const requestedMode = mode; mode = 'normal';
      if (requestedMode.startsWith('hold')) await new Promise(resolve => { release = resolve; });
      if (requestedMode !== 'hold-denied') return route.continue();
      denials++;
      return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin },
        body: JSON.stringify({ code: '42501', message: 'PRIVATE SYNTHETIC CONTACT EDIT', details: null, hint: null }) });
    });
    const modal = page.getByRole('dialog', { name: 'Corrigir contato' });
    const take = (variant, action) => capture(page, app, role, path, width, action, 'contact-correction-reads-' + variant, { navigate: false, viewportOnly: true, waitForNetwork: !['initial-pending', 'recovery-pending'].includes(variant) });
    const acceptRecovery = () => page.once('dialog', async dialog => {
      assert.equal(dialog.type(), 'confirm');
      assert.equal(dialog.message(), 'Substituir o preenchimento pelo cadastro atual do servidor?');
      confirmations++; await dialog.accept();
    });
    try {
      await page.getByRole('button', { name: 'Corrigir contato', exact: true }).click();
      await expect.poll(() => typeof release).toBe('function');
      await take('initial-pending', async () => { await expect(modal.getByRole('status')).toContainText('Carregando…'); await expect(modal.getByLabel('Nome do contato')).toHaveCount(0); await expect(modal.getByRole('button', { name: 'Salvar correção', exact: true })).toHaveCount(0); });
      release(); release = undefined;
      await expect(modal.getByLabel('Nome do contato')).toHaveValue('Família Exemplo');
      await modal.getByLabel('Nome do contato').fill('Rascunho sintético preservado');
      await modal.getByRole('checkbox', { name: /Conferi a identidade/ }).check();
      await take('draft', async () => { await expect(modal.getByRole('button', { name: 'Salvar correção', exact: true })).toBeEnabled(); });
      mode = 'hold-denied'; acceptRecovery(); await modal.getByRole('button', { name: 'Recuperar cadastro do servidor', exact: true }).click();
      await expect.poll(() => typeof release).toBe('function');
      await take('recovery-pending', async () => { await expect(modal.getByLabel('Nome do contato')).toHaveCount(0); await expect(modal.getByRole('button', { name: 'Recuperando cadastro…' })).toBeDisabled(); });
      release(); release = undefined;
      await take('denied', async () => { await expect(modal.getByRole('alert')).toContainText('Não foi possível conferir o cadastro.'); await expect(modal.getByRole('alert')).not.toContainText('PRIVATE'); await expect(modal.getByLabel('Nome do contato')).toHaveCount(0); });
      await modal.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      await take('retried-draft', async () => { await expect(modal.getByLabel('Nome do contato')).toHaveValue('Rascunho sintético preservado'); await expect(modal.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked(); await expect(modal.getByRole('button', { name: 'Salvar correção', exact: true })).toBeDisabled(); });
      acceptRecovery(); await modal.getByRole('button', { name: 'Recuperar cadastro do servidor', exact: true }).click();
      await take('explicit-baseline', async () => { await expect(modal.getByLabel('Nome do contato')).toHaveValue('Família Exemplo'); await expect(modal.getByRole('checkbox', { name: /Conferi a identidade/ })).not.toBeChecked(); });
      await modal.getByRole('button', { name: 'Voltar', exact: true }).click();
      await take('closed', async () => { await expect(modal).toHaveCount(0); });
      checks.push({ width, initialReadVerifiedBeforeFields: true, fieldsRemovedDuringReadAndError: true, draftPreservedOnRetry: true, reviewReset: true, onlyExplicitRecoveryReplacesDraft: true, noSubmission: true });
    } finally { if (release) release(); }
  }
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_contacts', 'POST /rest/v1/rpc/reception_contact_edit']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected request: ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(denials, 4); assert.equal(confirmations, 8); assert.equal(errorResponses.length, 4); assert.ok(errorResponses.every(r => r.status === 403 && r.path === '/rest/v1/rpc/reception_contact_edit'));
  assert.equal(consoleErrors.length, 4); assert.ok(consoleErrors.every(r => /403/.test(r.message))); assert.equal(screens.length, 28);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport && screen.dialogHorizontalOverflow <= 1 && screen.dialogActionReachable !== false);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
  checks.push({ states: screens.length, requests: requests.length, expected403: 4, nativeConfirmations: 8, zeroWrites: true, pausedCancellationAndStaleWrites: 'unit/SDK only' });
}
