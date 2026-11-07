// Public pre-consultation page. Synthetic data only; the Edge Function is mocked.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { starterForm } from '../../../supabase/functions/_shared/intakeForm';

// Radix checkboxes measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import PreConsultaPage from '@/pages/PreConsulta';

const TOKEN = 'A'.repeat(43);
const opened = { state: 'open', clinicName: 'Clínica Exemplo', doctorName: 'Dra. Ana Exemplo', start: '2026-11-10T13:00:00Z',
  form: starterForm('Clínica Exemplo'), formRevision: 3, answeredAt: null, privacyVersion: 'v1' };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pre-consulta/${TOKEN}`]}>
        <Routes><Route path="/pre-consulta/:token" element={<PreConsultaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public pre-consultation page', () => {
  beforeEach(() => invoke.mockReset());

  it('shows the clinic and appointment, hides insurance questions until "Convênio", and sends only visible answers', async () => {
    invoke.mockImplementation(async (_fn: string, opts?: { body: Record<string, unknown> }) =>
      opts?.body.action === 'open' ? { data: opened, error: null } : { data: { answeredAt: 'x', thanks: 'Obrigado!' }, error: null });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Pré-consulta' })).toBeInTheDocument();
    expect(screen.getByText(/com Dra\. Ana Exemplo/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Número da carteirinha/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nome completo/), 'Maria Exemplo');
    await user.type(screen.getByLabelText(/Data de nascimento/), '1990-05-20');
    await user.type(screen.getByLabelText(/^CPF/), '52998224725');
    await user.click(screen.getByRole('radio', { name: 'Convênio' }));
    expect(screen.getByLabelText(/Número da carteirinha/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Particular' }));
    expect(screen.queryByLabelText(/Número da carteirinha/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/motivo da consulta/), 'Rotina');

    // Privacy notice not confirmed: nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    expect(await screen.findByText('Confirme que leu o aviso de privacidade.')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('checkbox', { name: /Li o aviso de privacidade/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    expect(await screen.findByText('Respostas enviadas')).toBeInTheDocument();
    const sent = invoke.mock.calls[1][1].body;
    expect(sent).toMatchObject({ action: 'submit', token: TOKEN, formRevision: 3, privacyAccepted: true, whatsappConsent: false,
      answers: { nome: 'Maria Exemplo', nascimento: '1990-05-20', cpf: '52998224725', tipo_atendimento: 'Particular', motivo: 'Rotina' } });
    expect(Object.keys(sent.answers)).not.toContain('carteirinha');
  }, 30_000);

  it('marks required questions and invalid values before sending', async () => {
    invoke.mockResolvedValue({ data: opened, error: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Pré-consulta' });
    await user.type(screen.getByLabelText(/^CPF/), '11111111111');
    await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nome completo: resposta obrigatória.');
    expect(alert).toHaveTextContent('CPF: CPF inválido.');
    expect(screen.getByLabelText(/^CPF/)).toHaveAttribute('aria-invalid', 'true');
    expect(invoke).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('explains an invalid link and a reviewed form', async () => {
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'Link inválido ou vencido.', code: 'not_found' }), { status: 404 }) }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Link inválido ou vencido' })).toBeInTheDocument();
  });

  it('does not offer the form once the reception reviewed it', async () => {
    invoke.mockResolvedValue({ data: { ...opened, state: 'reviewed', form: null }, error: null });
    renderPage();
    expect(await screen.findByText('Suas respostas já foram conferidas')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enviar respostas' })).not.toBeInTheDocument());
  });
});
