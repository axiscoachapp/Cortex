import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { patientId, uid } from './clinic-review-api.mjs';

export async function auditPatientWorkspace({ api, app, scene, capture, checks, screens, errors, blocked }) {
  const path = '/?patient=' + patientId;
  const page = await scene(app, 'review', path);
  const before = structuredClone(api.displayData);
  await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
  for (const width of [375, 933, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(app.origin + path);
    await expect(page.getByRole('button', { name: 'Consulta manual', exact: true }).or(page.getByRole('link', {name:'Consulta manual',exact:true}))).toBeVisible({timeout:30000});
    await capture(page, app, 'review', path, width, async () => {
      await expect(page.getByRole('button', { name: 'Consulta manual', exact: true }).or(page.getByRole('link', {name:'Consulta manual',exact:true}))).toBeVisible();
    }, 'patient-before-panel', { navigate: false });
    const entry = page.getByRole('button', { name: 'Acompanhamento', exact: true });
    await expect(entry).toBeVisible();
    await entry.focus(); await entry.press('Enter');
    const dialog = page.getByRole('dialog'), close = dialog.locator(':scope > button');
    await capture(page, app, 'review', path, width, async () => {
      await expect(dialog).toContainText('Registro sintético de horários');
      await expect(dialog.getByRole('main')).toHaveCount(0);
      await expect(dialog.getByRole('navigation')).toHaveCount(0);
    }, 'patient-work', { navigate: false });
    await dialog.getByRole('button', { name: 'Ver versões', exact: true }).click();
    await dialog.getByText(/^Versão 1/).click();
    await expect(dialog).toContainText('Registro sintético anterior');
    await dialog.getByRole('button', { name: 'Linha do tempo', exact: true }).click();
    await dialog.getByRole('button', { name: 'Comparar revisões', exact: true }).click();
    await dialog.getByText(/^Versão 1/).click();
    await capture(page, app, 'review', path, width, async () => {
      await expect(dialog).toContainText('Versão sintética da consulta.');
    }, 'patient-history', { navigate: false });
    await close.click();
    await expect(dialog).toHaveCount(0); await expect(entry).toBeFocused();
    const manual = page.getByRole('button', { name: 'Consulta manual', exact: true });
    await manual.click();
    await expect(page.getByLabel('Tipo de registro', { exact: true })).toHaveValue('draft');
    await expect(page.getByLabel('Título do registro', { exact: true })).toHaveValue('Consulta manual');
    const content = page.getByLabel('Conteúdo do registro', { exact: true });
    await content.fill('Texto sintético preservado no paciente');
    const origin = await page.evaluate(() => performance.timeOrigin);
    page.once('dialog', native => native.dismiss());
    await close.click();
    await expect(content).toHaveValue('Texto sintético preservado no paciente');
    await capture(page, app, 'review', path, width, async () => {
      await expect(page).toHaveURL(app.origin + path);
    }, 'patient-manual-unsaved', { navigate: false });
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    if ([375, 1280].includes(width)) for (const kind of ['task', 'observation', 'pregnancy', 'medication', 'instruction', 'intake']) {
      await page.getByLabel('Tipo de registro', { exact: true }).selectOption(kind);
      await capture(page, app, 'review', path, width, async () => {
        await expect(page.getByLabel('Conteúdo do registro', { exact: true })).toHaveValue('Texto sintético preservado no paciente');
      }, 'patient-editor-' + kind, { navigate: false });
      if (kind === 'task') for (const workflow of ['waitlist', 'confirmation']) {
        await page.getByLabel('Fluxo de acompanhamento', { exact: true }).selectOption(workflow);
        await capture(page, app, 'review', path, width, undefined, 'patient-task-' + workflow, { navigate: false });
      }
    }
    page.once('dialog', native => native.accept());
    await close.click();
    await expect(dialog).toHaveCount(0); await expect(manual).toBeFocused();
    checks.push({ width, versions: true, manualOnPatient: true, unsavedRetained: true, keyboardFocusRestored: true, sameDocument: true });
  }
  // Reopening must check ownership before revealing a prior cached record.
  api.setPatientWorkspaceDenied(true);
  await page.getByRole('button', { name: 'Acompanhamento', exact: true }).click();
  await capture(page, app, 'review', path, 1920, async () => {
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Paciente indisponível ou sem acesso');
    await expect(page.getByRole('button', { name: 'Novo registro', exact: true })).toHaveCount(0);
    await expect(page.getByText('Registro sintético de horários', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Paciente Exemplo A', exact: true })).toHaveCount(0);
  }, 'patient-denied', { navigate: false });
  api.setPatientWorkspaceDenied(false);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Registro sintético de horários');
  checks.push({ deniedCacheHidden: true, explicitRecovery: true });
  const reads = api.metrics.patientWorkspaceReads;
  for (const read of reads.filter(read => ['clinical_work_items', 'consultations', 'clinical_record_revisions'].includes(read.table))) {
    assert.equal(read.query.patient_id, 'eq.' + patientId); assert.equal(read.query.user_id, 'eq.' + uid);
  }
  assert.ok(reads.some(read => read.table === 'clinical_work_revisions' && read.query.item_id && read.query.user_id === 'eq.' + uid));
  assert.deepEqual(api.displayData, before);
  for (const key of ['workspaceWrites', 'patientWrites', 'appointmentWrites', 'briefings', 'checklists', 'chat']) assert.equal(api.metrics[key], 0, key);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  for (const screen of screens) assert.ok(screen.overflow <= 1 && screen.dialogHorizontalOverflow <= 1 && !screen.dialogOutsideViewport && screen.dialogActionReachable !== false && !screen.missingLabels.length && !screen.missingButtons.length && !screen.brokenText.length, 'Patient workspace layout clipped');
}
