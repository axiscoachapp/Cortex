// Settings editors ask before discarding edits, and "Descartar mudanças" reads the server again.
// Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { starterForm } from '../../../supabase/functions/_shared/intakeForm';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), wa: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mocks.invoke(...a) } } }));
vi.mock('@/features/reception/accessContext', () => ({ useClinicAccess: () => ({ kind: 'clinical', active: true, admin: true,
  actorId: 'e8100000-0000-4000-8000-000000000001', clinic: { id: 'e8200000-0000-4000-8000-000000000001', name: 'Clínica sintética' }, doctors: [], staff: [] }) }));
vi.mock('./whatsappApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./whatsappApi')>(), whatsappCall: mocks.wa }));

import { IntakeFormEditor } from '@/features/intake/IntakeFormEditor';
import { FlowEditor } from './FlowEditor';
import { AutomationEditor } from './AutomationEditor';

const flow = { enabled: false, definition: { start: 'inicio', nodes: { inicio: { title: 'Início', text: 'Olá', options: [{ label: 'Recepção', goto: 'queue:geral' }] } } },
  hours: {}, afterHoursText: '', handoffText: 'A recepção continua.', defaultQueue: 'geral', revision: 1, updatedAt: null, starter: false };
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
);
const stale = () => ({ data: null, error: Object.assign(new Error('x'), { context: new Response(JSON.stringify({ error: 'O formulário mudou; atualize antes de salvar', code: 'stale' }), { status: 409 }) }) });

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.wa.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('pre-consultation form editor', { timeout: 30_000 }, () => {
  it('registers unsaved edits, and after a refused save "Descartar mudanças" reads the form again', async () => {
    mocks.invoke.mockImplementation(async (_fn: string, call?: { body?: { action?: string } }) =>
      call?.body?.action === 'saveForm' ? stale() : { data: { starter: false, revision: 2, enabled: true, form: starterForm('Clínica sintética'), updatedAt: null }, error: null });
    const user = userEvent.setup();
    wrap(<IntakeFormEditor />);
    const intro = await screen.findByLabelText('Apresentação');
    expect(confirmSessionExit()).toBe(true);
    await user.type(intro, ' Até já.');
    expect(confirmSessionExit()).toBe(false);
    expect(window.confirm).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Salvar formulário/ }));
    expect(await screen.findByText('O formulário mudou; atualize antes de salvar')).toBeInTheDocument();
    const reads = mocks.invoke.mock.calls.filter(([, c]) => c?.body?.action === 'form').length;
    await user.click(screen.getByRole('button', { name: 'Descartar mudanças' }));
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([, c]) => c?.body?.action === 'form').length).toBe(reads + 1));
    await waitFor(() => expect(screen.getByLabelText('Apresentação')).not.toHaveValue(expect.stringContaining('Até já.')));
    expect(confirmSessionExit()).toBe(true);
  });
});

describe('WhatsApp bot editor', { timeout: 30_000 }, () => {
  it('registers unsaved edits and refetches on discard', async () => {
    mocks.wa.mockImplementation(async (action: string) => action === 'flow' ? flow : null);
    const user = userEvent.setup();
    wrap(<FlowEditor />);
    const text = await screen.findByLabelText('Mensagem da etapa Início');
    await user.type(text, '!');
    expect(confirmSessionExit()).toBe(false);
    expect(screen.getByRole('button', { name: 'Salvar robô' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Descartar mudanças' }));
    await waitFor(() => expect(mocks.wa.mock.calls.filter(([a]) => a === 'flow')).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText('Mensagem da etapa Início')).toHaveValue('Olá'));
    expect(confirmSessionExit()).toBe(true);
  });
});

describe('automation dialog', { timeout: 30_000 }, () => {
  const props = { templates: [], doctors: [], initial: null, preset: null, saving: false, error: '', onSave: vi.fn() };
  it('closes at once when nothing changed', async () => {
    const onOpenChange = vi.fn();
    wrap(<AutomationEditor open onOpenChange={onOpenChange} {...props} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('asks before Escape or "Cancelar" discard typing, and stays open when refused', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    wrap(<AutomationEditor open onOpenChange={onOpenChange} {...props} />);
    await user.type(await screen.findByLabelText('Nome'), 'Lembrete 48 h');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
