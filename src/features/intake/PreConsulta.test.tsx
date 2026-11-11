// Public pre-consultation page. Synthetic data only; the Edge Function is mocked.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { starterForm } from '../../../supabase/functions/_shared/intakeForm';
import { humanError, maskCpf } from './patientMessages';

// Radix checkboxes measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import PreConsultaPage from '@/pages/PreConsulta';

const TOKEN = 'A'.repeat(43);
// Friday 13/11/2026, 09:00 in São Paulo.
const opened = { state: 'open', clinicName: 'Clínica Exemplo', doctorName: 'Dra. Ana Exemplo', start: '2026-11-13T12:00:00Z',
  form: starterForm('Clínica Exemplo'), formRevision: 3, answeredAt: null, privacyVersion: 'v1' };
const notFound = () => ({ data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'Link inválido ou vencido.', code: 'not_found' }), { status: 404 }) }) });

function renderPage(token = TOKEN) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pre-consulta/${token}`]}>
        <Routes><Route path="/pre-consulta/:token" element={<PreConsultaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public pre-consultation page', () => {
  beforeEach(() => { invoke.mockReset(); localStorage.clear(); });

  it('shows the clinic and appointment, hides insurance questions until "Convênio", and sends only visible answers', async () => {
    invoke.mockImplementation(async (_fn: string, opts?: { body: Record<string, unknown> }) =>
      opts?.body.action === 'open' ? { data: opened, error: null } : { data: { answeredAt: 'x', thanks: 'Obrigado!' }, error: null });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByLabelText(/Nome completo/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pré-consulta' })).toBeInTheDocument();
    expect(screen.getByText(/com Dra\. Ana Exemplo/)).toBeInTheDocument();
    expect(screen.getByText('3 partes · cerca de 5 minutos')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Número da carteirinha/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nome completo/), 'Maria Exemplo');
    await user.type(screen.getByLabelText(/Data de nascimento/), '1990-05-20');
    await user.type(screen.getByLabelText(/^CPF/), '52998224725');
    expect(screen.getByLabelText(/^CPF/)).toHaveValue('529.982.247-25');
    await user.click(screen.getByRole('radio', { name: 'Convênio' }));
    expect(screen.getByLabelText(/Número da carteirinha/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Particular' }));
    expect(screen.queryByLabelText(/Número da carteirinha/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/motivo da consulta/), 'Rotina');

    // Privacy notice not confirmed: nothing is sent, and the error sits under its checkbox.
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    const box = screen.getByRole('checkbox', { name: /Li o aviso de privacidade/ });
    await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(box.getAttribute('aria-describedby')!)).toHaveTextContent('Confirme que leu o aviso de privacidade');
    expect(invoke).toHaveBeenCalledTimes(1);

    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    expect(await screen.findByText('Pronto! Respostas enviadas')).toBeInTheDocument();
    const sent = invoke.mock.calls[1][1].body;
    expect(sent).toMatchObject({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true, whatsappConsent: false,
      answers: { nome: 'Maria Exemplo', nascimento: '1990-05-20', cpf: '52998224725', tipo_atendimento: 'Particular', motivo: 'Rotina' } });
    expect(Object.keys(sent.answers)).not.toContain('carteirinha');
    // Who receives the answers, when, and that the same link corrects them.
    const done = screen.getByRole('status');
    expect(done).toHaveTextContent('Dra. Ana Exemplo recebe suas respostas antes da consulta de sexta, 13/11, às 09:00.');
    expect(done).toHaveTextContent('Para corrigir algo, abra o mesmo link');
  }, 30_000);

  it('marks required and invalid answers in plain words, and clears a field error as soon as it changes', async () => {
    invoke.mockResolvedValue({ data: opened, error: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/Nome completo/);
    await user.type(screen.getByLabelText(/^CPF/), '11111111111');
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Informe seu nome completo');
    expect(alert).toHaveTextContent('CPF inválido — confira os 11 números');
    expect(alert).not.toHaveTextContent('resposta obrigatória');
    const cpf = screen.getByLabelText(/^CPF/);
    expect(cpf).toHaveAttribute('aria-invalid', 'true');
    expect(invoke).toHaveBeenCalledTimes(1);

    await user.clear(cpf);
    await user.type(cpf, '52998224725');
    expect(cpf).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('CPF inválido — confira os 11 números', { selector: 'p' })).not.toBeInTheDocument();
    // Other errors stay until the next "Enviar".
    expect(screen.getByLabelText(/Nome completo/)).toHaveAttribute('aria-invalid', 'true');
  }, 30_000);

  it('puts errors returned by the server under their questions', async () => {
    invoke.mockImplementation(async (_fn: string, opts?: { body: Record<string, unknown> }) => opts?.body.action === 'open' ? { data: opened, error: null } : {
      data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'Revise as respostas destacadas.', code: 'answers', errors: ['E-mail: e-mail inválido.'] }), { status: 400 }) }),
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/Nome completo/);
    await user.type(screen.getByLabelText(/Nome completo/), 'Maria Exemplo');
    await user.type(screen.getByLabelText(/Data de nascimento/), '1990-05-20');
    await user.type(screen.getByLabelText(/^CPF/), '52998224725');
    await user.click(screen.getByRole('radio', { name: 'Particular' }));
    await user.type(screen.getByLabelText(/motivo da consulta/), 'Rotina');
    await user.click(screen.getByRole('checkbox', { name: /Li o aviso de privacidade/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    await waitFor(() => expect(screen.getByLabelText(/^E-mail/)).toHaveAttribute('aria-invalid', 'true'));
    expect(within(screen.getByRole('alert')).getByText(/E-mail inválido — confira o endereço/)).toBeInTheDocument();
  }, 30_000);

  it('keeps the clinic name on an invalid link the phone opened before', async () => {
    invoke.mockResolvedValue({ data: opened, error: null });
    const first = renderPage();
    expect(await screen.findByText('Clínica Exemplo')).toBeInTheDocument();
    first.unmount();
    invoke.mockResolvedValue(notFound());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Link inválido ou vencido' })).toBeInTheDocument();
    expect(screen.getByText('Clínica Exemplo')).toBeInTheDocument();
    expect(screen.getByText(/peça um novo à recepção da Clínica Exemplo/)).toBeInTheDocument();
  });

  it('explains an invalid link it never saw', async () => {
    invoke.mockResolvedValue(notFound());
    renderPage('B'.repeat(43));
    expect(await screen.findByRole('heading', { name: 'Link inválido ou vencido' })).toBeInTheDocument();
    expect(screen.getByText(/peça um novo à recepção da clínica/)).toBeInTheDocument();
  });

  it('lets the patient correct answers already sent through the same link', async () => {
    invoke.mockResolvedValue({ data: { ...opened, state: 'answered', answeredAt: '2026-11-10T13:00:00Z' }, error: null });
    renderPage();
    expect(await screen.findByText(/Para corrigir algo, responda de novo e envie/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar respostas' })).toBeInTheDocument();
  });

  it('does not offer the form in the legacy "reviewed" state', async () => {
    invoke.mockResolvedValue({ data: { ...opened, state: 'reviewed', form: null }, error: null });
    renderPage();
    expect(await screen.findByText('Suas respostas já foram conferidas')).toBeInTheDocument();
    expect(screen.getByText('Clínica Exemplo')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enviar respostas' })).not.toBeInTheDocument());
  });
});

describe('patient messages', () => {
  it('masks a CPF while typing', () => {
    expect(maskCpf('529')).toBe('529');
    expect(maskCpf('5299822')).toBe('529.982.2');
    expect(maskCpf('52998224725999')).toBe('529.982.247-25');
  });
  it('names the field when the answer is required', () => {
    expect(humanError({ id: 'x', label: 'Plano', type: 'text', field: 'insurance_payer' }, ' resposta obrigatória.')).toEqual({ message: 'Informe o nome do convênio', standalone: true });
    expect(humanError({ id: 'x', label: 'Sono', type: 'choice', options: ['a', 'b'] }, ' resposta obrigatória.')).toEqual({ message: 'Escolha uma opção', standalone: false });
  });
});
