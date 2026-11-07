import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSecurity from './AccountSecurity';

const mocks = vi.hoisted(() => ({ listFactors: vi.fn(), unenroll: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { mfa: mocks } } }));
const active = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', friendly_name: 'Ativo sintético', factor_type: 'totp', status: 'verified' };
const pending = { ...active, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', friendly_name: 'Pendente sintético', status: 'unverified' };
const phone = { ...active, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', friendly_name: 'Telefone sintético', factor_type: 'phone' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter><AccountSecurity /></MemoryRouter></QueryClientProvider>), client };
}
describe('TOTP metadata including abandoned setups', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    // Auth SDK totp contains verified factors only; all also contains pending setups.
    mocks.listFactors.mockResolvedValue({ data: { all: [active, pending, phone], totp: [active], phone: [phone] }, error: null });
    mocks.unenroll.mockResolvedValue({ error: null });
    mocks.challengeAndVerify.mockResolvedValue({ error: null });
    mocks.enroll.mockResolvedValue({ data: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'SYNTHETIC-NOT-A-REAL-SECRET' } }, error: null });
  });
  it('lists pending TOTP setups while keeping them out of the verified selector', async () => {
    mount();
    await screen.findByText('Pendente sintético · Configuração pendente');
    expect(screen.getByText('Ativo sintético · Ativo')).toBeVisible();
    expect(screen.queryByText('Telefone sintético')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: pending.friendly_name })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: active.friendly_name })).toHaveAttribute('value', active.id);
    expect(mocks.unenroll).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it('clears a code and its previous verification error when choosing another authenticator',async()=>{
    const other={...active,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',friendly_name:'Outro ativo sintético'};
    mocks.listFactors.mockResolvedValue({data:{all:[active,other]},error:null});
    mocks.challengeAndVerify.mockResolvedValue({error:Object.assign(new Error('PRIVATE SYNTHETIC MFA ERROR'),{code:'mfa_verification_failed'})});
    mount();await screen.findByRole('option',{name:active.friendly_name});
    fireEvent.change(screen.getByLabelText('Código do aplicativo'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('combobox',{name:'Autenticador'}),{target:{value:other.id}});
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Verificar código'})).toBeDisabled();
    expect(mocks.challengeAndVerify).toHaveBeenCalledTimes(1);expect(screen.queryByText('PRIVATE SYNTHETIC MFA ERROR')).not.toBeInTheDocument();
  });
  it('does not carry the old factor code into a newly enrolled setup',async()=>{
    mount();await screen.findByRole('option',{name:active.friendly_name});
    fireEvent.change(screen.getByLabelText('Código do aplicativo'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Adicionar autenticador'}));
    await screen.findByRole('heading',{name:'Configurar aplicativo'});expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');expect(screen.getByRole('button',{name:'Verificar código'})).toBeDisabled();expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('locks the verification factor and code until the submitted attempt finishes',async()=>{
    let finish!:(v:unknown)=>void;mocks.challengeAndVerify.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    mount();await screen.findByRole('option',{name:active.friendly_name});fireEvent.change(screen.getByLabelText('Código do aplicativo'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verificar código'}));
    await waitFor(()=>expect(mocks.challengeAndVerify).toHaveBeenCalledTimes(1));
    try{expect(screen.getByRole('combobox',{name:'Autenticador'})).toBeDisabled();expect(screen.getByLabelText('Código do aplicativo')).toBeDisabled();}
    finally{await act(async()=>finish({error:Object.assign(new Error('Synthetic expired challenge'),{code:'mfa_challenge_expired'})}));}
    expect(await screen.findByRole('alert')).toHaveFocus();expect(screen.getByLabelText('Código do aplicativo')).toBeEnabled();
  });
  it('clears only pending TOTP setups before another enrollment', async () => {
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    await screen.findByRole('heading', { name: 'Configurar aplicativo' });
    await waitFor(() => expect(mocks.enroll).toHaveBeenCalledTimes(1));
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: pending.id });
    expect(mocks.unenroll.mock.invocationCallOrder[0]).toBeLessThan(mocks.enroll.mock.invocationCallOrder[0]);
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });
  it('stops enrollment when the SDK returns a pending-factor cleanup error', async () => {
    mocks.unenroll.mockResolvedValue({ error: Object.assign(new Error('Synthetic cleanup denied'), { code: 'insufficient_aal' }) });
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: pending.id });
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Configurar aplicativo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar autenticador' })).toBeEnabled();
  });
  it('refocuses an identical later failure while preserving edits and allowing code entry', async () => {
    mocks.unenroll.mockResolvedValue({ error: Object.assign(new Error('Synthetic cleanup denied'), { code: 'insufficient_aal' }) });
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    const input = screen.getByLabelText('Código do aplicativo'), selector = screen.getByRole('combobox', { name: 'Autenticador' });
    fireEvent.change(selector, { target: { value: active.id } }); fireEvent.change(input, { target: { value: '1234' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' })); });
    expect(screen.getByRole('alert')).toHaveFocus(); expect(input).toHaveValue('1234'); expect(selector).toHaveValue(active.id);
    input.focus(); fireEvent.change(input, { target: { value: '12345' } });
    expect(input).toHaveFocus(); expect(input).toHaveValue('12345');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' })); });
    expect(screen.getByRole('alert')).toHaveFocus(); expect(input).toHaveValue('12345'); expect(selector).toHaveValue(active.id);
    expect(mocks.unenroll).toHaveBeenCalledTimes(2); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it('refreshes factor metadata after enrollment instead of keeping the removed pending setup', async () => {
    const fresh = { ...pending, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', friendly_name: 'Nova configuração sintética' };
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active, pending, phone], totp: [active] }, error: null })
      .mockResolvedValue({ data: { all: [active, fresh, phone], totp: [active] }, error: null });
    mount(); await screen.findByText('Pendente sintético · Configuração pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    await screen.findByRole('heading', { name: 'Configurar aplicativo' });
    await screen.findByText('Nova configuração sintética · Configuração pendente');
    expect(screen.queryByText('Pendente sintético · Configuração pendente')).not.toBeInTheDocument();
    expect(screen.getByText('Ativo sintético · Ativo')).toBeVisible();
    expect(mocks.listFactors).toHaveBeenCalledTimes(2);
  });
  it('clears the canceled setup selection and code before verifying an active factor', async () => {
    const fresh = { ...pending, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', friendly_name: 'Nova configuração sintética' };
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active, pending] }, error: null })
      .mockResolvedValueOnce({ data: { all: [active, fresh] }, error: null })
      .mockResolvedValue({ data: { all: [active] }, error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    await screen.findByText('Nova configuração sintética · Configuração pendente');
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar configuração' }));
    await screen.findByText('Autenticador removido.');
    expect(screen.queryByRole('heading', { name: 'Configurar aplicativo' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Autenticador' })).toHaveValue(active.id);
    expect(screen.getByRole('button', { name: 'Verificar código' })).toBeDisabled();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
    await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: active.id, code: '654321' }));
    expect(mocks.unenroll.mock.calls).toEqual([[{ factorId: pending.id }], [{ factorId: fresh.id }]]);
  });
  it.each([false, true])('clears code and selection after removing an active factor (explicit selection: %s)', async explicit => {
    const other = { ...active, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', friendly_name: 'Outro ativo sintético' };
    const removed = explicit ? other : active, remaining = explicit ? active : other;
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active, other] }, error: null })
      .mockResolvedValue({ data: { all: [remaining] }, error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(); await screen.findByRole('option', { name: other.friendly_name });
    if (explicit) fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText(removed.friendly_name + ' · Ativo').closest('li')!.querySelector('button')!);
    await screen.findByText('Autenticador removido.');
    await waitFor(() => expect(screen.queryByRole('option', { name: removed.friendly_name })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue(remaining.id);
    expect(screen.getByRole('button', { name: 'Verificar código' })).toBeDisabled();
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: removed.id });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
  it.each(['dismissed', 'denied'])('preserves setup and code when cancellation is %s', async outcome => {
    vi.spyOn(window, 'confirm').mockReturnValue(outcome !== 'dismissed');
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar autenticador' }));
    await screen.findByRole('heading', { name: 'Configurar aplicativo' });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    mocks.unenroll.mockClear();
    if (outcome === 'denied') mocks.unenroll.mockResolvedValue({ error: new Error('Synthetic cancellation denied') });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancelar configuração' })); });
    expect(screen.getByRole('heading', { name: 'Configurar aplicativo' })).toBeVisible();
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('123456');
    expect(screen.queryByText('Autenticador removido.')).not.toBeInTheDocument();
    expect(mocks.unenroll).toHaveBeenCalledTimes(outcome === 'denied' ? 1 : 0);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('excludes a removed active factor while the metadata refetch is still pending', async () => {
    const remaining = { ...active, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', friendly_name: 'Outro ativo sintético' };
    let release!: (value: { data: { all: typeof active[] }; error: null }) => void;
    const delayed = new Promise<{ data: { all: typeof active[] }; error: null }>(resolve => { release = resolve; });
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active, remaining] }, error: null }).mockReturnValue(delayed);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText(active.friendly_name + ' · Ativo').closest('li')!.querySelector('button')!);
    try {
      await screen.findByText('Autenticador removido.');
      expect(screen.queryByRole('option', { name: active.friendly_name })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveValue(remaining.id);
      fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '654321' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
      await waitFor(() => expect(mocks.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({ factorId: remaining.id, code: '654321' }));
    } finally { await act(async () => { release({ data: { all: [remaining] }, error: null }); }); }
  });
  it('keeps the last removed factor absent even when metadata refresh fails', async () => {
    let release!: (value: { data: null; error: Error }) => void;
    const delayed = new Promise<{ data: null; error: Error }>(resolve => { release = resolve; });
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active] }, error: null }).mockReturnValue(delayed);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(); await screen.findByRole('option', { name: active.friendly_name });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    try {
      await screen.findByText('Autenticador removido.');
      expect(screen.queryByLabelText('Código do aplicativo')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    } finally { await act(async () => { release({ data: null, error: new Error('Synthetic refresh denied') }); }); }
    await screen.findByText(/Não foi possível carregar autenticadores/);
    expect(screen.queryByRole('button', { name: 'Verificar código' })).not.toBeInTheDocument();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('does not restore removed metadata when an older in-flight read finishes', async () => {
    let release!: (value: { data: { all: typeof active[] }; error: null }) => void;
    const delayed = new Promise<{ data: { all: typeof active[] }; error: null }>(resolve => { release = resolve; });
    mocks.listFactors.mockResolvedValueOnce({ data: { all: [active] }, error: null })
      .mockReturnValueOnce(delayed).mockResolvedValue({ data: { all: [] }, error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { client } = mount(); await screen.findByRole('option', { name: active.friendly_name });
    let refresh!: Promise<void>;
    await act(async () => { refresh = client.refetchQueries({ queryKey: ['mfa-factors', '11111111-1111-4111-8111-111111111111'] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    try { await screen.findByText('Autenticador removido.'); }
    finally { await act(async () => { release({ data: { all: [active] }, error: null }); await refresh; }); }
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Código do aplicativo')).not.toBeInTheDocument();
    expect(client.getQueryData(['mfa-factors', '11111111-1111-4111-8111-111111111111'])).toEqual([]);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });
});
