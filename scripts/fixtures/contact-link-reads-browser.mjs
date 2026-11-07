import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { ids } from './reception-api.mjs';

export async function auditContactLinkReads({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked }) {
  const path = '/recepcao/contatos', role = 'admin'; let denials = 0, reads = 0;
  const first = { contactId: ids.contact, patientId: ids.patient, doctorId: ids.admin, patientName: 'Beneficiário sintético A', doctorName: 'Médico sintético A', dateOfBirth: '2000-01-02', relationship: 'guardian', revision: 1, active: true, patientAvailable: true, doctorActive: true };
  const second = { ...first, patientId: '99999999-9999-4999-8999-999999999999', patientName: 'Beneficiário sintético B', active: false, doctorActive: false };
  for (const width of [320, 375, 1280, 1920]) {
    const page = await scene(app, role, path); let mode = 'hold', release;
    await page.route(api.origin + '/rest/v1/rpc/reception_contact_links', async route => {
      if (route.request().method() === 'OPTIONS') return route.continue();
      assert.equal(route.request().method(), 'POST'); const body = route.request().postDataJSON();
      assert.deepEqual(body, { p_clinic: ids.clinic, p_contact: ids.contact, p_after: body.p_after, p_limit: 50 });
      assert.ok(body.p_after === null || body.p_after === first.patientId);
      const requestedMode = mode; mode = 'normal'; reads++;
      if (requestedMode.startsWith('hold')) await new Promise(resolve => { release = resolve; });
      const denied = requestedMode === 'hold-denied'; if (denied) denials++;
      return route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': app.origin }, body: JSON.stringify(denied
        ? { code: '42501', message: 'PRIVATE SYNTHETIC LINK READ', details: null, hint: null }
        : body.p_after ? { items: [second], nextCursor: null } : { items: [first], nextCursor: first.patientId }) });
    });
    const modal = page.getByRole('dialog', { name: 'Vínculos do contato' });
    const take = (variant, action) => capture(page, app, role, path, width, action, 'contact-link-reads-' + variant, { navigate: false, viewportOnly: true, waitForNetwork: !variant.endsWith('pending') });
    const noMetadata = async () => {
      await expect(modal.getByText(first.patientName, { exact: true })).toHaveCount(0); await expect(modal.getByText(second.patientName, { exact: true })).toHaveCount(0);
      await expect(modal.getByText('Contato: Família Exemplo', { exact: true })).toHaveCount(0);
      await expect(modal.getByRole('button', { name: /^Corrigir relação de/ })).toHaveCount(0);
    };
    try {
      await page.getByRole('button', { name: 'Consultar vínculos', exact: true }).click(); await expect.poll(() => typeof release).toBe('function');
      await take('initial-pending', async () => { await expect(modal.getByRole('status')).toContainText('Carregando…'); await noMetadata(); });
      release(); release = undefined;
      await take('first-page', async () => { await expect(modal.getByText(first.patientName, { exact: true })).toBeVisible(); await expect(modal.getByText('1 vínculo carregado', { exact: true })).toBeVisible(); });
      mode = 'hold'; await modal.getByRole('button', { name: 'Carregar mais vínculos', exact: true }).click(); await expect.poll(() => typeof release).toBe('function');
      await take('next-pending', async () => { await expect(modal.getByRole('status')).toContainText('Carregando…'); await noMetadata(); });
      release(); release = undefined;
      await take('second-page', async () => {
        await expect(modal.getByText(second.patientName, { exact: true })).toBeVisible(); await expect(modal.getByText('2 vínculos carregados', { exact: true })).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Corrigir relação de ' + second.patientName })).toBeDisabled();
        await expect(modal.getByRole('button', { name: 'Reativar vínculo de ' + second.patientName })).toBeDisabled();
        await expect(modal.getByRole('button', { name: 'Carregar mais vínculos', exact: true })).toHaveCount(0);
      });
      mode = 'hold-denied'; await modal.getByRole('button', { name: 'Atualizar vínculos', exact: true }).click(); await expect.poll(() => typeof release).toBe('function');
      await take('refresh-pending', async () => { await expect(modal.getByRole('status')).toContainText('Carregando…'); await noMetadata(); });
      release(); release = undefined;
      await take('denied', async () => { await expect(modal.getByRole('alert')).toContainText('Não foi possível consultar os vínculos.'); await expect(modal.getByRole('alert')).not.toContainText('PRIVATE'); await noMetadata(); });
      await modal.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      await take('retried', async () => { await expect(modal.getByText('2 vínculos carregados', { exact: true })).toBeVisible(); await expect(modal.getByText(second.patientName, { exact: true })).toBeVisible(); });
      await modal.getByRole('button', { name: 'Fechar vínculos', exact: true }).click(); await take('closed', async () => { await expect(modal).toHaveCount(0); });
      checks.push({ width, namesRetiredDuringReadsAndError: true, twoExplicitPages: true, availabilityGuardsPreserved: true, retryReadOnly: true, noEditorOrMutation: true });
    } finally { if (release) release(); }
  }
  const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_contacts', 'POST /rest/v1/rpc/reception_contact_links']);
  for (const request of requests) assert.ok(allowed.has(request.method + ' ' + request.path), 'Unexpected request: ' + request.method + ' ' + request.path);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['contacts', 'caseWrites', 'bookings']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.equal(denials, 4); assert.equal(errorResponses.length, 4); assert.ok(errorResponses.every(r => r.status === 403 && r.path === '/rest/v1/rpc/reception_contact_links'));
  assert.equal(consoleErrors.length, 4); assert.ok(consoleErrors.every(r => /403/.test(r.message))); assert.equal(screens.length, 32);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport && screen.dialogHorizontalOverflow <= 1 && screen.dialogActionReachable !== false);
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
  checks.push({ states: screens.length, requests: requests.length, linkFixtureReads: reads, expected403: 4, zeroWrites: true, contextCancellationStaleEntries: 'unit/SDK only' });
}
