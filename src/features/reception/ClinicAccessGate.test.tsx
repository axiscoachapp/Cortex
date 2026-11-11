import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessGate } from './ClinicAccessGate';
import { ClinicAccessTransportError } from './accessErrors';
import { useSessionHidden, useSessionPaused } from '@/contexts/SessionVisibility';

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
            <Route path="/recepcao/agenda" element={<p>Agenda administrativa</p>} />
            <Route path="/trabalho" element={<Clinical />} />
            <Route path="/trabalho-extra" element={<Clinical />} />
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
  it.each(['/recepcao', '/RECEPCAO', '/%72ecepcao', '/RECEPCAO/agenda'])('blocks reception route aliases %s for a doctor without admin access', async path => {
    mocks.access.mockResolvedValue({ ...base, active: true, clinic: { id: base.actorId, name: 'Clínica sintética' } });
    mount(path);
    expect(await screen.findByRole('heading', { name: 'Área da recepção' })).toBeVisible();
    expect(screen.queryByText('Ambiente da recepção')).toBeNull();
    expect(screen.queryByText('Agenda administrativa')).toBeNull();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each(['/trabalho?queue=scheduling','/TRABALHO/?queue=scheduling','/%74rabalho?queue=scheduling'])('routes legacy scheduling %s to reception Calendar without private readers',async path=>{
    mocks.access.mockResolvedValue({...base,kind:'reception',active:true,clinic:{id:base.actorId,name:'Clínica'},doctors:[{id:base.actorId,name:'Médico',specialty:'geral'}]});
    mount(path);expect(await screen.findByText('Agenda administrativa')).toBeVisible();expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it.each(['/trabalho?patient=private&queue=scheduling','/trabalho-extra?queue=scheduling'])('does not treat %s as a reception scheduling link',async path=>{
    mocks.access.mockResolvedValue({...base,kind:'reception',active:true,clinic:{id:base.actorId,name:'Clínica'},doctors:[{id:base.actorId,name:'Médico',specialty:'geral'}]});
    mount(path);expect(await screen.findByText('Ambiente da recepção')).toBeVisible();expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('keeps inactive reception blocked on a legacy scheduling link',async()=>{
    mocks.access.mockResolvedValue({...base,kind:'reception',active:false,clinic:{id:base.actorId,name:'Clínica'},doctors:[{id:base.actorId,name:'Médico',specialty:'geral'}]});
    mount('/trabalho?queue=scheduling');expect(await screen.findByRole('heading',{name:'Acesso de recepção indisponível'})).toBeVisible();expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
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
  it('keeps reception administration visible with the banner during a transport failure, then recovers silently', async () => {
    const admin = { ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } };
    mocks.access.mockResolvedValue(admin);
    const view = mount('/recepcao');
    expect(await screen.findByText('Ambiente da recepção')).toBeVisible();
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await refetch(view.client);
    expect(await screen.findByRole('status', { name: 'Estado da conexão com a clínica' })).toHaveTextContent('Não foi possível atualizar o acesso à clínica');
    expect(screen.getByText('Ambiente da recepção')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-clinic-access-blocked]')).toBeNull();
    mocks.access.mockResolvedValue(admin);
    await refetch(view.client);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Estado da conexão com a clínica' })).toBeNull());
    expect(screen.getByText('Ambiente da recepção')).toBeVisible();
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

function ReceptionProbe() {
  const hidden = useSessionHidden(), paused = useSessionPaused();
  return <><p>Ambiente da recepção</p><textarea aria-label="Rascunho da recepção" />
    <output aria-label="Estado da guarda">{hidden ? 'oculto' : paused ? 'pausado' : 'livre'}</output></>;
}
describe('reception grace period for transport failures', () => {
  const reception = { ...base, kind: 'reception', active: true, clinic: { id: base.actorId, name: 'Clínica sintética' }, doctors: [{ id: base.actorId, name: 'Médico sintético', specialty: null }] };
  beforeEach(() => { vi.resetAllMocks(); mocks.userId = base.actorId; });
  afterEach(() => vi.useRealTimers());
  function mountReception() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/recepcao']}><Routes>
      <Route element={<ClinicAccessGate><Outlet /></ClinicAccessGate>}><Route path="/recepcao" element={<ReceptionProbe />} /></Route>
    </Routes></MemoryRouter></QueryClientProvider>);
    return client;
  }
  it('absorbs one transient poll failure with a quick retry, without banner or pause afterwards', async () => {
    mocks.access.mockResolvedValue(reception);
    const client = mountReception();
    const draft = await screen.findByRole('textbox', { name: 'Rascunho da recepção' });
    fireEvent.change(draft, { target: { value: 'Texto da recepção preservado' } });
    mocks.access.mockRejectedValueOnce(new ClinicAccessTransportError());
    await refetch(client);
    expect(mocks.access).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('status', { name: 'Estado da conexão com a clínica' })).toBeNull();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('livre');
    expect(draft).toBeVisible();
    expect(draft).toHaveValue('Texto da recepção preservado');
  });
  it('keeps reception working and paused while failing, then recovers silently', async () => {
    mocks.access.mockResolvedValue(reception);
    const client = mountReception();
    const draft = await screen.findByRole('textbox', { name: 'Rascunho da recepção' });
    fireEvent.change(draft, { target: { value: 'Texto da recepção preservado' } });
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await refetch(client);
    expect(await screen.findByRole('status', { name: 'Estado da conexão com a clínica' })).toBeVisible();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('pausado');
    expect(draft).toBeVisible();
    mocks.access.mockResolvedValue(reception);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar acesso novamente' }));
    await waitFor(() => expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('livre'));
    expect(screen.queryByRole('status', { name: 'Estado da conexão com a clínica' })).toBeNull();
    expect(draft).toHaveValue('Texto da recepção preservado');
  });
  it('blocks reception after 45 seconds without a verified read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.access.mockResolvedValue(reception);
    const client = mountReception();
    const draft = await screen.findByRole('textbox', { name: 'Rascunho da recepção' });
    mocks.access.mockRejectedValue(new ClinicAccessTransportError());
    await act(async () => { void client.invalidateQueries({ queryKey: ['clinic-access'] }); await vi.advanceTimersByTimeAsync(2_000); });
    await screen.findByRole('status', { name: 'Estado da conexão com a clínica' });
    await act(() => vi.advanceTimersByTimeAsync(30_000)); // two more failed 15 s polls
    expect(draft).toBeVisible();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('pausado');
    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(draft).not.toBeVisible();
    expect(screen.getByLabelText('Estado da guarda')).toHaveTextContent('oculto');
  });
  it('blocks reception at once on a definitive refusal, without retrying it', async () => {
    mocks.access.mockResolvedValue(reception);
    const client = mountReception();
    const draft = await screen.findByRole('textbox', { name: 'Rascunho da recepção' });
    mocks.access.mockRejectedValue(Object.assign(new Error('blocking'), { code: '42501' }));
    await refetch(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(draft).not.toBeVisible();
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status', { name: 'Estado da conexão com a clínica' })).toBeNull();
  });
  it('keeps Settings strict: the first transport failure unmounts them without retries', async () => {
    mocks.access.mockResolvedValue({ ...base, active: true, admin: true, clinic: { id: base.actorId, name: 'Clínica sintética' } });
    const view = mount('/configuracoes'); await screen.findByText('Configurações sintéticas');
    mocks.access.mockRejectedValue(new ClinicAccessTransportError()); await refetch(view.client);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText('Configurações sintéticas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editor administrativo sintético')).not.toBeInTheDocument();
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });
});
