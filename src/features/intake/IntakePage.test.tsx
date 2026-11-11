// Staff "Pré-consultas" page. Synthetic data only; the Edge Function is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import type { IntakeListItem, IntakeResponse } from './intakeApi';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

import IntakePage from './IntakePage';
import { acceptsLink } from './intakeApi';

const DOCTOR = 'e8100000-0000-4000-8000-000000000002';
const ADMIN = 'e8100000-0000-4000-8000-000000000001';
const CLINIC = 'e8200000-0000-4000-8000-000000000001';
const base: ClinicAccess = { kind: 'clinical', active: true, admin: false, actorId: DOCTOR, clinic: { id: CLINIC, name: 'Clínica Exemplo' },
  doctors: [{ id: DOCTOR, name: 'Dra. Exemplo', specialty: null }], staff: [] };
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const item = (over: Partial<IntakeListItem>): IntakeListItem => ({
  appointmentId: 'e8700000-0000-4000-8000-000000000001', doctorId: DOCTOR, doctorName: 'Dra. Exemplo', start: later(24), end: later(24.5),
  appointmentStatus: 'agendado', contactId: null, contactName: 'Maria Exemplo', requestId: null, state: 'none', openedAt: null, answeredAt: null,
  registrationReviewedAt: null, healthReviewedAt: null, revision: null, ...over,
});

function setup(opts: { access?: ClinicAccess; items?: IntakeListItem[]; stateError?: boolean; response?: Partial<IntakeResponse> } = {}) {
  invoke.mockImplementation(async (_fn: string, call?: { body?: Record<string, unknown> }) => {
    const body = call?.body ?? {};
    if (body.action === 'state') return opts.stateError
      ? { data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'Serviço indisponível.', code: 'server' }), { status: 500 }) }) }
      : { data: { ready: true, canEditForm: false, enabled: true }, error: null };
    if (body.action === 'list') return { data: { items: opts.items ?? [] }, error: null };
    if (body.action === 'link') return { data: { url: 'https://app.example.com.br/pre-consulta/' + 'A'.repeat(43) }, error: null };
    if (body.action === 'response') return { data: { request: { id: 'r1', state: 'answered', revision: 5, openedAt: null, answeredAt: later(-2), submissions: 2,
      expiresAt: later(30), whatsappConsent: false, registration: [], registrationReviewedAt: null, healthReviewedAt: later(-3), healthVisible: true,
      health: [{ id: 'alergias', label: 'Alergias', value: 'Dipirona' }], registrationChanges: null, healthChanges: null, ...opts.response } }, error: null };
    return { data: null, error: null };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ClinicAccessContext.Provider value={opts.access ?? base}><IntakePage embedded /></ClinicAccessContext.Provider></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Pré-consultas staff page', { timeout: 30_000 }, () => {
  beforeEach(() => invoke.mockReset());

  it('offers a link only for visits still ahead', async () => {
    setup({ items: [
      item({ appointmentId: 'e8700000-0000-4000-8000-000000000001', contactName: 'Futura' }),
      item({ appointmentId: 'e8700000-0000-4000-8000-000000000002', contactName: 'Passada', start: later(-5), end: later(-4.5) }),
      item({ appointmentId: 'e8700000-0000-4000-8000-000000000003', contactName: 'Realizada', appointmentStatus: 'realizado' }),
    ] });
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: /Copiar link da pré-consulta de Futura/ })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: /Copiar link/ })).toBeNull();
    expect(within(rows[2]).queryByRole('button', { name: /Copiar link/ })).toBeNull();
    expect(acceptsLink({ appointmentStatus: 'confirmado', start: later(-1), end: later(0.5) })).toBe(true);
    expect(acceptsLink({ appointmentStatus: 'faltou', start: later(5), end: later(6) })).toBe(false);
  });

  it.each([
    ['reception', { ...base, kind: 'reception' as const, actorId: 'e8100000-0000-4000-8000-000000000003' }, 'Nenhuma consulta dos médicos que você atende neste período.', false],
    ['doctor', base, 'Nenhuma consulta sua na agenda da clínica neste período.', false],
    ['admin who is not a doctor', { ...base, admin: true, actorId: ADMIN }, 'Nenhuma consulta para você acompanhar neste período.', true],
  ])('explains an empty week for the %s', async (_who, access, text, adminNote) => {
    setup({ access });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(!!screen.queryByText(/A administração não vê aqui as consultas de outros médicos/)).toBe(adminNote);
  });

  it('shows a failed state read instead of silently hiding the buttons', async () => {
    setup({ stateError: true, items: [item({})] });
    expect(await screen.findByText(/Não foi possível verificar se a pré-consulta está ativa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('shows the link in a dialog when the browser refuses the clipboard', async () => {
    const user = userEvent.setup();
    setup({ items: [item({})] });
    const button = await screen.findByRole('button', { name: /Copiar link da pré-consulta de Maria/ });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Copiar link' });
    expect(within(dialog).getByRole('textbox', { name: 'Link da pré-consulta' })).toHaveValue('https://app.example.com.br/pre-consulta/' + 'A'.repeat(43));
    expect(within(dialog).getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('tells the doctor the answers changed after the review, with what changed', async () => {
    const user = userEvent.setup();
    setup({ items: [item({ state: 'answered', requestId: 'r1', answeredAt: later(-2), healthReviewedAt: later(-3), healthChangedAfterReview: true })],
      response: { healthChanges: [{ id: 'alergias', label: 'Alergias', before: 'Nenhuma', after: 'Dipirona' }] } });
    expect(await screen.findByText('Alterada depois da conferência')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver respostas' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Respostas alteradas depois da sua conferência')).toBeInTheDocument();
    expect(within(dialog).getByText(/“Nenhuma” → “Dipirona”/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Marcar alterações como lidas' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByText(/Lidas em/)).toBeNull());
  });
});
