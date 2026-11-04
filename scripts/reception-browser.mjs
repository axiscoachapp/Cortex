import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startReceptionFixture, ids } from './fixtures/reception-api.mjs';

const api = await startReceptionFixture();
const probe = http.createServer();
await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(
  process.env.CORTEX_BROWSER_ARTIFACTS || 'docs/reviews/2026-11-03/reception-foundation/browser',
);
await mkdir(artifacts, { recursive: true });
const app = spawn(
  process.execPath,
  [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
let logs = '';
app.stdout.on('data', (data) => {
  logs = (logs + data).slice(-6000);
});
app.stderr.on('data', (data) => {
  logs = (logs + data).slice(-6000);
});
let browser;
let lastPage;
const errors = [];
const checks = [];
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + '/auth')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  async function account(email, next = '/') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', (route) =>
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(origin + '/auth?next=' + encodeURIComponent(next));
    await page.getByLabel(/e-?mail/i).fill(email + '@example.invalid');
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    return page;
  }
  const a = await account('recepcao-a');
  await expect(a.getByRole('heading', { name: 'Fila de atendimento', exact: true })).toBeVisible();
  await expect(a).toHaveURL(/\/recepcao$/);
  await a.goto(origin + '/conhecimento');
  await expect(a).toHaveURL(/\/recepcao$/);
  checks.push('reception redirects before clinical readers, including direct clinical URL');
  await a.goto(origin + '/recepcao?case=' + ids.case);
  await expect(a.getByRole('button', { name: 'Assumir atendimento' })).toBeVisible();
  const b = await account('recepcao-b', '/recepcao?case=' + ids.case);
  await expect(b.getByRole('button', { name: 'Assumir atendimento' })).toBeVisible();
  await a.getByRole('button', { name: 'Assumir atendimento' }).click();
  await expect(a.getByRole('button', { name: 'Agendar consulta', exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Assumir atendimento' }).click();
  await expect(b.getByText('Os dados mudaram em outra tela. Atualize antes de tentar novamente.')).toBeVisible();
  await expect(b.getByText('Em atendimento por Secretária A.')).toBeVisible();
  checks.push('two browser sessions cannot claim the same revision');
  const draft = 'Retornar ligação para confirmar o horário da família.';
  await a.getByLabel('Seu rascunho de acompanhamento').fill(draft);
  await expect.poll(() => api.cases[0].drafts[ids.a]?.body).toBe(draft);
  await a.reload();
  await expect(a.getByLabel('Seu rascunho de acompanhamento')).toHaveValue(draft);
  await b.reload();
  await expect(b.getByLabel('Seu rascunho de acompanhamento')).toHaveValue('');
  await a.getByRole('button', { name: 'Registrar anotação', exact: true }).click();
  await expect(a.getByLabel('Seu rascunho de acompanhamento')).toHaveValue('');
  await expect(a.getByText(draft, { exact: true })).toBeVisible();
  await a.reload();
  await expect(a.getByText(draft, { exact: true })).toBeVisible();
  await expect(a.getByLabel('Seu rascunho de acompanhamento')).toHaveValue('');
  checks.push('server draft survives reload, is private per actor, and posted note clears it');
  await a.getByRole('button', { name: 'Agendar consulta', exact: true }).click();
  const dialog = a.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Confirmar agendamento', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Buscar outro paciente na agenda deste médico').fill('Paciente');
  await expect(dialog.getByRole('button', { name: /^Paciente Sintético/ })).toHaveCount(2);
  await dialog.getByRole('button', { name: /^Paciente Sintético/ }).last().click();
  await expect(dialog.getByLabel('Relação do contato com o paciente')).toHaveValue('guardian');
  await expect(dialog.getByLabel('Relação do contato com o paciente')).toBeDisabled();
  await expect(dialog.getByText('Relação já confirmada. Este agendamento preserva o vínculo registrado.')).toBeVisible();
  for (const width of [390, 768, 1280, 1920]) {
    await a.setViewportSize({ width, height: 1000 });
    if (await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      throw new Error('Booking dialog overflow at ' + width);
    await a.screenshot({ path: resolve(artifacts, 'link-confirmation-' + width + '.png'), fullPage: true, animations: 'disabled' });
  }
  checks.push('linked patient chosen through search keeps guardian relation fixed at 150% for four widths');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Conferi o paciente/ }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  if (api.metrics.bookings !== 1) throw new Error('Human confirmation did not book exactly once');
  checks.push('explicit beneficiary and human reservation confirmation');
  await a.goto(origin + '/recepcao/agenda');
  await expect(a.getByRole('heading', { name: 'Paciente Sintético' })).toBeVisible();
  await a.getByRole('button', { name: 'Novo agendamento', exact: true }).click();
  await dialog.getByLabel('Buscar contato por nome ou telefone').fill('Família');
  await dialog.getByRole('button', { name: /Família Exemplo/ }).click();
  await dialog.getByRole('button', { name: /^Paciente Sintético/ }).click();
  await dialog.getByRole('checkbox', { name: /Conferi o paciente/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
  await expect(dialog.getByText('Horário ocupado ou bloqueado. Escolha outro intervalo.')).toBeVisible();
  await expect(dialog.getByLabel('Relação do contato com o paciente')).toHaveValue('guardian');
  await expect(dialog.getByLabel('Relação do contato com o paciente')).toBeDisabled();
  await a.keyboard.press('Escape');
  checks.push('occupied slot preserves form and shows actionable conflict');
  await a.getByRole('button', { name: 'Remarcar', exact: true }).click();
  await dialog.getByLabel('Novo início').fill('11:00');
  await dialog.getByLabel('Novo término').fill('11:30');
  await expect(dialog.getByRole('button', { name: 'Confirmar remarcação' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar remarcação' }).click();
  await expect(a.getByText('11:00–11:30', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Registrar chegada' }).click();
  await expect(a.getByRole('button', { name: 'Desfazer chegada' })).toBeVisible();
  await a.getByRole('button', { name: 'Desfazer chegada' }).click();
  await expect(a.getByRole('button', { name: 'Registrar chegada' })).toBeVisible();
  await a.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(a.getByText('Confirmado', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click();
  await expect(a.getByText('Cancelado', { exact: true })).toBeVisible();
  if (api.appointments.length !== 1 || api.appointments[0].status !== 'cancelado')
    throw new Error('Cancellation erased appointment');
  checks.push('human reschedule, check-in/undo, confirm, retained cancellation');
  await a.goto(origin + '/recepcao');
  await a.getByRole('button', { name: 'Novo atendimento', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Novo contato', exact: true }).check();
  await dialog.getByLabel('Nome de quem entrou em contato').fill('Contato de Teste Local');
  await dialog.getByLabel('Telefone com DDD (opcional)').fill('41999990002');
  await dialog.getByLabel('Assunto administrativo').fill('Solicitar primeira consulta');
  api.failNextCase();
  await dialog.getByRole('button', { name: 'Adicionar à fila' }).click();
  await expect(dialog.getByText('Não foi possível concluir a operação. Seus dados foram preservados.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Adicionar à fila' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(a.getByRole('heading', { name: 'Contato de Teste Local' })).toBeVisible();
  if (api.metrics.contacts !== 1) throw new Error('Partial retry duplicated contact');
  checks.push('partial contact/case failure retries without duplicate contact');
  await a.goto(origin + '/recepcao?case=' + ids.case);
  for (const width of [390, 768, 1280, 1920]) {
    await a.setViewportSize({ width, height: 1000 });
    await expect(a.getByRole('heading', { name: 'Família Exemplo' })).toBeVisible();
    if (await a.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error('Horizontal overflow in reception at ' + width);
    if ((await a.evaluate(() => getComputedStyle(document.documentElement).fontSize)) !== '24px')
      throw new Error('150% default scale changed');
    await a.screenshot({ path: resolve(artifacts, 'queue-' + width + '.png'), fullPage: true });
    await a.goto(origin + '/recepcao/agenda');
    await expect(a.getByRole('heading', { name: 'Agenda da equipe' })).toBeVisible();
    if (await a.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error('Calendar overflow at ' + width);
    await a.screenshot({ path: resolve(artifacts, 'calendar-' + width + '.png'), fullPage: true });
    await a.goto(origin + '/recepcao?case=' + ids.case);
    checks.push('150% responsive reception and calendar ' + width);
  }
  const admin = await account('admin', '/recepcao/equipe');
  await expect(admin.getByRole('heading', { name: 'Equipe e permissões' })).toBeVisible();
  await admin.getByLabel('Nome da secretária', { exact: true }).fill('Secretária Nova');
  await admin.getByLabel('E-mail exclusivo da conta').fill('nova@example.invalid');
  await admin
    .getByRole('group', { name: 'Agendas permitidas' })
    .getByRole('checkbox', { name: 'Dra. Ana Exemplo' })
    .check();
  await admin.getByRole('button', { name: 'Criar conta com acesso restrito' }).click();
  await expect(admin.getByRole('dialog', { name: 'Credenciais temporárias' })).toBeVisible();
  await admin.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Secretária Nova', exact: true })).toBeVisible();
  const staffCard = admin
    .getByRole('article')
    .filter({ has: admin.getByRole('heading', { name: 'Secretária A', exact: true }) });
  await staffCard.getByRole('checkbox', { name: 'Dr. Bruno Exemplo', exact: true }).check();
  await staffCard.getByRole('button', { name: 'Salvar permissões' }).click();
  await expect.poll(() => api.staff.find((s) => s.id === ids.a).doctorIds.length).toBe(2);
  await a.reload();
  await expect(
    a.getByLabel('Médico', { exact: true }).getByRole('option', { name: 'Dr. Bruno Exemplo' }),
  ).toBeAttached();
  checks.push('administrator creates dedicated account and delegates agendas');
  await staffCard.getByRole('button', { name: 'Desativar acesso' }).click();
  await expect.poll(() => api.staff.find((s) => s.id === ids.a).active).toBe(false);
  await a.reload();
  await expect(a.getByRole('heading', { name: 'Acesso de recepção indisponível' })).toBeVisible();
  await b.reload();
  await expect(b.getByRole('button', { name: 'Assumir atendimento' })).toBeVisible();
  checks.push('offboarding takes effect in another active session');
  await admin.goto(origin + '/recepcao/agenda');
  await admin.getByRole('button', { name: 'Bloquear horário', exact: true }).click();
  const adminDialog = admin.getByRole('dialog');
  await adminDialog.getByLabel('Médico do bloqueio').selectOption(ids.admin);
  await adminDialog.getByRole('button', { name: 'Confirmar bloqueio' }).click();
  await expect(admin.getByRole('button', { name: 'Remover bloqueio' })).toBeVisible();
  await admin.getByRole('button', { name: 'Remover bloqueio' }).click();
  await expect(admin.getByRole('button', { name: 'Remover bloqueio' })).not.toBeVisible();
  checks.push('administrator creates and removes an administrative schedule block');
  await b.goto(origin + '/recepcao/contatos');
  await expect(b.getByRole('heading', { name: 'Contatos da recepção' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Corrigir contato', exact: true })).toHaveCount(0);
  await admin.goto(origin + '/recepcao/contatos');
  const admin2 = await account('admin', '/recepcao/contatos');
  const familyCard = (page) =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Família Exemplo', exact: true }) });
  await familyCard(admin).getByRole('button', { name: 'Corrigir contato' }).click();
  await familyCard(admin2).getByRole('button', { name: 'Corrigir contato' }).click();
  await admin2.getByLabel('Nome do contato').fill('Família Exemplo Corrigida');
  await admin2.getByLabel('Telefone do contato').fill('41999990003');
  await expect(admin2.getByRole('button', { name: 'Salvar correção' })).toBeDisabled();
  await admin2.getByRole('checkbox', { name: /Conferi a identidade/ }).check();
  await admin2.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(admin2.getByRole('heading', { name: 'Família Exemplo Corrigida', exact: true })).toBeVisible();
  await admin.getByLabel('Nome do contato').fill('Correção de outra aba');
  await admin.getByRole('checkbox', { name: /Conferi a identidade/ }).check();
  await admin.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(admin.getByRole('dialog').getByRole('alert')).toContainText('Os dados mudaram em outra tela');
  await expect(admin.getByLabel('Nome do contato')).toHaveValue('Correção de outra aba');
  await admin.getByRole('button', { name: 'Recuperar cadastro do servidor' }).click();
  await expect(admin.getByLabel('Nome do contato')).toHaveValue('Família Exemplo Corrigida');
  await admin.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Família Exemplo Corrigida', exact: true })).toBeVisible();
  if (api.appointments[0].patientName !== 'Paciente Sintético')
    throw new Error('Contact correction changed patient identity');
  checks.push('admin-only contact correction, two-session CAS conflict, explicit recovery, patient identity preserved');
  for (const width of [390, 768, 1280, 1920]) {
    await admin.setViewportSize({ width, height: 1000 });
    await admin
      .getByRole('article')
      .filter({ has: admin.getByRole('heading', { name: 'Família Exemplo Corrigida', exact: true }) })
      .getByRole('button', { name: 'Corrigir contato' })
      .click();
    await expect(admin.getByLabel('Nome do contato')).toHaveValue('Família Exemplo Corrigida');
    if (await admin.getByRole('dialog').evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      throw new Error('Contact editor overflow at ' + width);
    await admin.screenshot({ path: resolve(artifacts, 'contact-correction-' + width + '.png'), fullPage: true,animations:'disabled' });
    await admin.getByRole('button', { name: 'Voltar', exact: true }).click();
  }
  checks.push('contact editor responsive at 150% for 390/768/1280/1920 px');
  const staffReads = api.metrics.clinicalReads.filter((r) => r.actor !== ids.admin);
  if (staffReads.length || api.metrics.externalCalls.length || api.metrics.unknown.length || errors.length)
    throw new Error(JSON.stringify({ staffReads, metrics: api.metrics, errors }));
  const report = {
    checks,
    errors,
    metrics: api.metrics,
    browser: 'isolated headless Edge/Chromium',
    data: 'synthetic loopback only; database authorization separately verified',
  };
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'failure.txt'), await lastPage.locator('body').innerText());
  }
  throw error;
} finally {
  if (browser) await browser.close();
  app.kill();
  await api.close();
}
