import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { ids } from './reception-api.mjs';

export async function auditSettingsAccess({ api, app, scene, capture, checks, requests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked, adminOnly }) {
  const before = structuredClone({ staff: api.staff, cases: api.cases, contacts: api.contacts, appointments: api.appointments });
  const securityPath = '/configuracoes?secao=seguranca';
  if (!adminOnly) {
    const staff = await scene(app, 'recepcao-a', securityPath);
    for (const width of [375, 1280, 1920]) {
      await capture(staff, app, 'staff', securityPath, width, undefined, 'settings-security');
      await expect(staff.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
      await expect(staff.getByRole('button', { name: 'Equipe da recepção', exact: true })).toHaveCount(0);
      await expect(staff.getByRole('button', { name: 'Permissões da recepção', exact: true })).toHaveCount(0);
      await expect(staff.getByRole('button', { name: 'Perfil profissional', exact: true })).toHaveCount(0);
      await expect(staff.getByRole('link', { name: /Segurança da conta/ })).toHaveAttribute('href', '/seguranca');
      checks.push({ role: 'staff', width, exactSettingsRoute: true, administrativeSectionsAbsent: true });
    }
    await staff.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(staff).toHaveURL(/\/recepcao$/);
    await staff.getByRole('link', { name: 'Configurações', exact: true }).click();
    await capture(staff, app, 'staff', securityPath, 375, async () => { await expect(staff.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible(); }, 'settings-entry-link', { navigate: false });
    await staff.getByRole('button', { name: 'Segurança e privacidade', exact: true }).click();
    await staff.getByRole('link', { name: /Segurança da conta/ }).click();
    await capture(staff, app, 'staff', '/seguranca', 375, async () => { await expect(staff.getByRole('heading', { name: 'Segurança da conta', exact: true })).toBeVisible(); }, 'security-outside-settings', { navigate: false });
    assert.equal(new URL(staff.url()).pathname, '/seguranca');
    api.staff.find(person => person.id === ids.a).active = false;
    await capture(staff, app, 'staff', securityPath, 375, async () => { await expect(staff.getByRole('heading', { name: 'Acesso de recepção indisponível', exact: true })).toBeVisible(); await expect(staff.getByRole('heading', { name: 'Configurações', exact: true })).toHaveCount(0); }, 'settings-inactive');
    api.staff.find(person => person.id === ids.a).active = true;
    await staff.close();
  }
  const adminPath = '/configuracoes?secao=whatsapp&clinica=' + ids.clinic;
  const admin = await scene(app, 'admin', adminPath);
  for (const [width, pathname] of [[375, '/configuracoes'], [1280, '/CONFIGURACOES/'], [1920, '/configura%63oes']]) {
    const path = pathname + '?secao=whatsapp&clinica=' + ids.clinic;
    await capture(admin, app, 'admin', path, width, async () => { await expect(admin.getByRole('button', { name: 'Nova automação', exact: true })).toBeVisible(); }, 'settings-admin');
    await admin.getByRole('button', { name: 'Nova automação', exact: true }).click();
    await capture(admin, app, 'admin', path, width, async () => { await expect(admin.getByRole('dialog', { name: 'Nova automação' })).toBeVisible(); await admin.getByLabel('Nome', { exact: true }).fill('Rascunho sintético'); }, 'settings-editor', { navigate: false });
    const documentTime = await admin.evaluate(() => performance.timeOrigin);
    const failuresBefore = errorResponses.filter(item => item.path === '/rest/v1/rpc/clinic_access').length;
    api.setClinicAccessFailure({ status: 503, code: 'PGRST000', message: 'Synthetic access transport failure' });
    await expect.poll(() => errorResponses.filter(item => item.path === '/rest/v1/rpc/clinic_access').length, { timeout: 22_000 }).toBeGreaterThan(failuresBefore);
    await capture(admin, app, 'admin', path, width, undefined, 'settings-access-failed', { navigate: false });
    await expect(admin.getByRole('alertdialog')).toBeVisible();
    await expect(admin.getByRole('dialog', { name: 'Nova automação' })).toHaveCount(0);
    await expect(admin.getByRole('heading', { name: 'Configurações', exact: true })).toHaveCount(0);
    assert.equal(await admin.locator('input').evaluateAll(inputs => inputs.some(input => input.value === 'Rascunho sintético')), false);
    api.setClinicAccessFailure(null); await admin.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await capture(admin, app, 'admin', path, width, async () => { await expect(admin.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible(); await expect(admin.getByRole('button', { name: 'Nova automação', exact: true })).toBeVisible(); }, 'settings-access-recovered', { navigate: false });
    assert.equal(await admin.evaluate(() => performance.timeOrigin), documentTime);
    assert.equal(new URL(admin.url()).searchParams.get('clinica'), ids.clinic);
    await admin.getByRole('button', { name: 'Nova automação', exact: true }).click();
    await expect(admin.getByLabel('Nome', { exact: true })).toHaveValue('');
    await admin.getByRole('button', { name: 'Cancelar', exact: true }).click();
    checks.push({ role: 'admin', width, pathname, settingsUnmounted: true, portalRemoved: true, draftCleared: true, retrySameDocument: true });
  }
  if (!adminOnly) {
    for (const [section, title] of [['equipe', 'Equipe e permissões'], ['permissoes', 'Permissões da recepção']]) {
      const path = '/configuracoes?secao=' + section + '&clinica=' + ids.clinic;
      await capture(admin, app, 'admin', path, 1280, async () => { await expect(admin.getByRole('heading', { name: title, level: 2 })).toBeVisible(); await expect(admin.getByRole('heading', { level: 1 })).toHaveCount(1); await expect(admin.getByRole('main')).toHaveCount(1); }, 'settings-embedded-' + section);
      assert.equal(new URL(admin.url()).searchParams.get('clinica'), ids.clinic);
    }
  }
  const allow = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_queue', 'POST /rest/v1/rpc/reception_team_doctors', 'POST /rest/v1/rpc/reception_delegation_requests', 'POST /functions/v1/whatsapp-api']);
  assert.ok(requests.every(call => allow.has(call.method + ' ' + call.path)), 'Unexpected settings resource');
  assert.ok(api.settingsRead.calls.every(call => ['state', 'templates', 'automations'].includes(call.input.action)));
  assert.deepEqual({ staff: api.staff, cases: api.cases, contacts: api.contacts, appointments: api.appointments }, before);
  for (const key of ['clinicalReads', 'externalCalls', 'unknown']) assert.deepEqual(api.metrics[key], []);
  for (const key of ['bookings', 'contacts', 'caseWrites']) assert.equal(api.metrics[key], 0);
  for (const collection of [errors, failedRequests, blocked]) assert.deepEqual(collection, []);
  assert.ok(errorResponses.length >= 3 && errorResponses.every(item => item.path === '/rest/v1/rpc/clinic_access' && item.status === 503));
  assert.ok(consoleErrors.length >= 3 && consoleErrors.every(item => /503/.test(item.message)));
  assert.equal(screens.length, adminOnly ? 12 : 20);
  for (const screen of screens) {
    assert.ok(screen.overflow <= 1 && !screen.recoveryScreen && !screen.dialogOutsideViewport && screen.dialogActionReachable !== false && screen.dialogHorizontalOverflow <= 1,
      'Settings layout issue: ' + JSON.stringify({ role: screen.role, variant: screen.variant, width: screen.width, overflow: screen.overflow, dialogHorizontalOverflow: screen.dialogHorizontalOverflow, dialogActionReachable: screen.dialogActionReachable }));
    for (const key of ['missingButtons', 'missingLabels', 'brokenText']) assert.deepEqual(screen[key], []);
  }
}
