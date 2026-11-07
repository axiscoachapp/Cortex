import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessGate } from './ClinicAccessGate';
import { ClinicAccessTransportError } from './accessErrors';
import { useSessionHidden } from '@/contexts/SessionVisibility';

const mocks = vi.hoisted(() => ({ access: vi.fn(), clinicalRender: vi.fn(), clinicalUnmount: vi.fn(), userId: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: mocks.userId }, signOut: vi.fn() }),
}));
vi.mock('./api', () => ({ receptionApi: { access: mocks.access } }));
const base = {
  kind: 'clinical',
  active: false,
  admin: false,
  actorId: '11111111-1111-4111-8111-111111111111',
  clinic: null,
  doctors: [],
  staff: [],
};
function Clinical() {
  mocks.clinicalRender();
  const hidden = useSessionHidden();
  useEffect(() => () => mocks.clinicalUnmount(), []);
  return <><p>Prontuário privado</p><textarea aria-label="Rascunho clínico" />
    {!hidden && createPortal(<p aria-label="Captura sintética">Captura sintética</p>, document.body)}</>;
}
function SettingsReview() {
  return <><p>Configurações sintéticas</p>{createPortal(<p aria-label="Editor administrativo sintético">Editor administrativo sintético</p>, document.body)}</>;
}
function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/?patient=other')}>Outro prontuário</button>
    <button onClick={() => navigate('/seguranca')}>Segurança</button><button onClick={() => navigate('/')}>Voltar ao prontuário</button></>;
}
function tree(client: QueryClient, initial = '/') {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Navigation />
        <Routes>
          <Route element={<ClinicAccessGate><Outlet /></ClinicAccessGate>}>
            <Route path="/" element={<Clinical />} />
            <Route path="/recepcao" element={<p>Ambiente da recepção</p>} />
            <Route path="/configuracoes" element={<SettingsReview />} />
            <Route path="/configuracoes-extra" element={<Clinical />} />
          </Route>
          <Route path="/seguranca" element={<p>Segurança sintética</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function mount(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(tree(client, initial));
  return { ...result, client };
}
async function refetch(client: QueryClient) { await act(async () => { await client.invalidateQueries({ queryKey: ['clinic-access'] }); }); }
describe('reception routing before clinical components mount', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.userId = base.actorId; });
  it('redirects reception without mounting clinical data readers', async () => {
    mocks.access.mockResolvedValue({
      ...base,
      kind: 'reception',
      active: true,
      clinic: { id: base.actorId, name: 'Clínica' },
      doctors: [{ id: base.actorId, name: 'Médico', specialty: 'geral' }],
    });
    mount();
    expect(await screen.findByText('Ambiente da recepção')).toBeInTheDocument();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('fails closed when role verification fails', async () => {
    mocks.access.mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('preserves an existing standalone doctor workspace', async () => {
    mocks.access.mockResolvedValue(base);
    mount();
    expect(await screen.findByText('Prontuário privado')).toBeInTheDocument();
  });
  it('keeps a verified clinical workspace, draft and focus during transport failure and recovery', async () => {
    mocks.access.mockResolvedValue(base);
    const { client } = mount();
    expect(await screen.findByText('Prontuário privado')).toBeVisible();
    const draft = screen.getByRole('textbox', { name: 'Rascunho clínico' }) as HTMLTextAreaElement;
    draft.value = 'Rascunho sintético preservado';
    draft.focus();
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['clinic-access'] });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('atendimento permanece aberto');
    expect(screen.getByText('Prontuário privado')).toBeVisible();
    expect(draft).toHaveValue('Rascunho sintético preservado');
    expect(draft).toHaveFocus();
    expect(mocks.clinicalUnmount).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue(base);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['clinic-access'] });
    });
    expect(await screen.findByText('Prontuário privado')).toBeVisible();
    expect(mocks.clinicalUnmount).not.toHaveBeenCalled();
  });
  it('does not grant clinical access on an initial transport failure', async () => {
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each(['42501', 'INVALID_RESPONSE'])('does not revive old permission after %s then transport, even after remount', async (code) => {
    mocks.access.mockResolvedValue(base);
    const view = mount();
    await screen.findByText('Prontuário privado');
    mocks.access.mockRejectedValue(Object.assign(new Error('blocking'), { code }));
    await refetch(view.client);
    await screen.findByRole('alert');
    expect(screen.getByText('Prontuário privado')).not.toBeVisible();
    expect(screen.queryByLabelText('Captura sintética')).toBeNull();
    expect(document.querySelector('[data-clinic-access-blocked]')).not.toBeNull();
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await refetch(view.client);
    expect(screen.getByText('Prontuário privado')).not.toBeVisible();
    view.unmount();
    mocks.clinicalRender.mockClear();
    render(tree(view.client));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue(base);
    await refetch(view.client);
    expect(await screen.findByText('Prontuário privado')).toBeVisible();
  });
  it('requires fresh verification after a cached-success remount', async () => {
    mocks.access.mockResolvedValue(base);
    const view = mount();
    await screen.findByText('Prontuário privado');
    await act(async () => screen.getByRole('button', { name: /^Segurança$/ }).click());
    await screen.findByText('Segurança sintética');
    mocks.clinicalRender.mockClear();
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await act(async () => screen.getByRole('button', { name: 'Voltar ao prontuário' }).click());
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
    view.client.clear();
  });
  it('does not authorize another query-string patient from a failed verification', async () => {
    mocks.access.mockResolvedValue(base);
    const view = mount();
    await screen.findByText('Prontuário privado');
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await refetch(view.client);
    mocks.clinicalRender.mockClear();
    await act(async () => screen.getByRole('button', { name: 'Outro prontuário' }).click());
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('does not inherit a previous user or a mismatched actor response', async () => {
    mocks.access.mockResolvedValue(base);
    const view = mount();
    await screen.findByText('Prontuário privado');
    mocks.userId = '22222222-2222-4222-8222-222222222222';
    view.rerender(tree(view.client));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText('Prontuário privado')).toBeNull();
  });
  it('does not keep reception administration visible during transport failure', async () => {
    mocks.access.mockResolvedValue({ ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } });
    const view = mount('/recepcao');
    expect(await screen.findByText('Ambiente da recepção')).toBeVisible();
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await refetch(view.client);
    await screen.findByRole('alert');
    expect(screen.getByText('Ambiente da recepção')).not.toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
  });
  it('does not turn offboarded staff into a standalone doctor', async () => {
    mocks.access.mockResolvedValue({ ...base, kind: 'reception' });
    mount();
    expect(await screen.findByText('Acesso de recepção indisponível')).toBeInTheDocument();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each(['/configuracoes', '/configuracoes/', '/CONFIGURACOES/', '/configura%63oes', '/%63onfiguracoes', '/configuracoes//'])('allows active reception to open the explicit settings route %s', async path => {
    mocks.access.mockResolvedValue({ ...base, kind: 'reception', active: true, clinic: { id: base.actorId, name: 'Clínica sintética' }, doctors: [{ id: base.actorId, name: 'Médico sintético', specialty: null }] });
    mount(path + '?secao=seguranca');
    expect(await screen.findByText('Configurações sintéticas')).toBeVisible();
    expect(screen.queryByText('Ambiente da recepção')).not.toBeInTheDocument(); expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each([
    { active: false, doctors: [{ id: base.actorId, name: 'Médico sintético', specialty: null }] },
    { active: true, doctors: [] },
  ])('keeps unavailable reception out of settings', async state => {
    mocks.access.mockResolvedValue({ ...base, ...state, kind: 'reception', clinic: { id: base.actorId, name: 'Clínica sintética' } });
    mount('/configuracoes'); expect(await screen.findByText('Acesso de recepção indisponível')).toBeVisible();
    expect(screen.queryByText('Configurações sintéticas')).not.toBeInTheDocument();
  });
  it('does not expand the settings exception to another path prefix', async () => {
    mocks.access.mockResolvedValue({ ...base, kind: 'reception', active: true, clinic: { id: base.actorId, name: 'Clínica sintética' }, doctors: [{ id: base.actorId, name: 'Médico sintético', specialty: null }] });
    mount('/configuracoes-extra'); expect(await screen.findByText('Ambiente da recepção')).toBeVisible(); expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each(['/configuracoes', '/configuracoes/', '/CONFIGURACOES/', '/configura%63oes', '/%63onfiguracoes', '/configuracoes//'])('blocks admin settings %s instead of continuing them during a transport failure', async path => {
    mocks.access.mockResolvedValue({ ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } });
    const view = mount(path); await screen.findByText('Configurações sintéticas');
    mocks.access.mockRejectedValue(new ClinicAccessTransportError()); await refetch(view.client);
    expect(await screen.findByRole('alert')).toBeVisible(); expect(screen.queryByText('Configurações sintéticas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editor administrativo sintético')).not.toBeInTheDocument();
    mocks.access.mockResolvedValue({ ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } }); await refetch(view.client);
    expect(await screen.findByText('Configurações sintéticas')).toBeVisible(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['/configuracoes', '/configura%63oes'])('unmounts the settings portal on %s when a definitive access refusal hides the page', async path => {
    mocks.access.mockResolvedValue({ ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } });
    const view = mount(path); await screen.findByLabelText('Editor administrativo sintético');
    mocks.access.mockRejectedValue(new Error('Synthetic refusal')); await refetch(view.client); await screen.findByRole('alert');
    expect(screen.queryByLabelText('Editor administrativo sintético')).not.toBeInTheDocument();
    expect(screen.queryByText('Configurações sintéticas')).not.toBeInTheDocument();
  });
  it.each([true, false])('honors an authoritative clinical-to-reception transition (active=%s)', async (active) => {
    mocks.access.mockResolvedValue(base);
    const view = mount();
    await screen.findByText('Prontuário privado');
    mocks.access.mockResolvedValue({ ...base, kind: 'reception', active, clinic: { id: base.actorId, name: 'Clínica sintética' }, doctors: [{ id: base.actorId, name: 'Médico sintético', specialty: null }] });
    await refetch(view.client);
    await screen.findByText(active ? 'Ambiente da recepção' : 'Acesso de recepção indisponível');
    expect(screen.queryByText('Prontuário privado')).toBeNull();
  });
});
