import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactsPage from './ContactsPage';
import { ClinicAccessContext } from './accessContext';
import { CONTACT_SEARCH_DEBOUNCE_MS } from './ContactDirectory';
import type { ClinicAccess } from './contracts';

const mocks = vi.hoisted(() => ({ contacts: vi.fn(), contact: vi.fn(), createContact: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('./api', () => ({ receptionApi: { contacts: mocks.contacts, contact: mocks.contact, createContact: mocks.createContact } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: ({ contact }: { contact?: { name: string } }) => <div role="dialog" aria-label="Atendimento sintético">{contact?.name}</div> }));
vi.mock('./ContactCorrectionDialog', () => ({ ContactCorrectionDialog: () => null }));
vi.mock('./ContactLinksDialog', () => ({ ContactLinksDialog: () => null }));

const clinic = '22222222-2222-4222-8222-222222222222', contactId = '33333333-3333-4333-8333-333333333333';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const maria = { id: contactId, name: 'Maria Sintética', phone: '+5541999990001', createdAt: '2026-11-07T12:00:00Z' };
const jose = { id: '44444444-4444-4444-8444-444444444444', name: 'José Sintético', phone: '+5541988880002', createdAt: '2026-11-06T12:00:00Z' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(value: ClinicAccess = access, path = '/recepcao/contatos') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><ClinicAccessContext.Provider value={value}><ContactsPage /></ClinicAccessContext.Provider></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => { vi.resetAllMocks(); mocks.contacts.mockResolvedValue({ items: [maria, jose], nextCursor: null }); });

describe('contacts page (UX 27)', () => {
  it('lists contacts as rows with the phone and the renamed action, and a "Novo contato" primary action', async () => {
    mount();
    const row = (await screen.findByRole('heading', { name: maria.name })).closest('article')!;
    expect(within(row).getByText('(41) 99999-0001')).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: 'Novo atendimento para este contato' }));
    expect(screen.getByRole('dialog', { name: 'Atendimento sintético' })).toHaveTextContent(maria.name);
    expect(screen.getByRole('button', { name: 'Novo contato' }).className).toContain('bg-primary');
  });

  it('tells a receptionist who can correct a contact, and not the administrator', async () => {
    const view = mount();
    await screen.findByRole('heading', { name: maria.name });
    expect(screen.getByText('Para corrigir o nome ou o telefone de um contato, peça ao administrador da clínica.')).toBeVisible();
    view.unmount();
    mount({ ...access, admin: true });
    await screen.findByRole('heading', { name: maria.name });
    expect(screen.queryByText(/peça ao administrador da clínica/)).not.toBeInTheDocument();
  });

  it('waits 300 ms after typing, trims the search and keeps the previous results visible while loading', async () => {
    mount();
    await screen.findByRole('heading', { name: jose.name });
    const pending = deferred<{ items: typeof maria[]; nextCursor: null }>();
    mocks.contacts.mockReturnValue(pending.promise);
    const pause = (ms: number) => act(() => new Promise(resolve => setTimeout(resolve, ms)));
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar contatos' }), { target: { value: '  Ma' } });
    await pause(CONTACT_SEARCH_DEBOUNCE_MS / 2);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar contatos' }), { target: { value: '  Maria ' } });
    await pause(CONTACT_SEARCH_DEBOUNCE_MS / 2);
    // Typing again restarted the wait: still one read.
    expect(mocks.contacts).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(2));
    expect(mocks.contacts.mock.calls[1].slice(0, 3)).toEqual([clinic, 'Maria', null]);
    // The earlier results stay on screen, without actions, until the new ones arrive.
    expect(screen.getByRole('heading', { name: jose.name })).toBeVisible();
    expect(within(screen.getByRole('heading', { name: jose.name }).closest('article')!).getByRole('button', { name: 'Novo atendimento para este contato' })).toBeDisabled();
    expect(screen.getByText('Buscando contatos…')).toBeVisible();
    await act(async () => pending.resolve({ items: [maria], nextCursor: null }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: jose.name })).not.toBeInTheDocument());
    expect(within(screen.getByRole('heading', { name: maria.name }).closest('article')!).getByRole('button', { name: 'Novo atendimento para este contato' })).toBeEnabled();
  });

  it('creates a contact from "Novo contato", checking the phone under the field', async () => {
    mocks.createContact.mockResolvedValue('55555555-5555-4555-8555-555555555555');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Novo contato' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo contato' });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Ana Nova' } });
    fireEvent.change(within(dialog).getByLabelText('Telefone com DDD (opcional)'), { target: { value: '419' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar contato' }));
    expect(within(dialog).getByText('Informe DDD + número, por exemplo (41) 99999-0000.')).toBeVisible();
    expect(mocks.createContact).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Telefone com DDD (opcional)'), { target: { value: '(41) 99999-0000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar contato' }));
    await waitFor(() => expect(mocks.createContact).toHaveBeenCalledWith(clinic, 'Ana Nova', '(41) 99999-0000', expect.any(String)));
    const saved = (await screen.findByText((_, element) => element?.tagName === 'P' && element.textContent === 'Contato salvo: Ana Nova.')).parentElement!;
    expect(saved).toHaveAttribute('role', 'status');
    fireEvent.click(within(saved).getByRole('button', { name: 'Novo atendimento para este contato' }));
    expect(screen.getByRole('dialog', { name: 'Atendimento sintético' })).toHaveTextContent('Ana Nova');
  });

  it('opens one contact by id when coming from a conversation', async () => {
    mocks.contact.mockResolvedValue({ id: contactId, clinicId: clinic, name: maria.name, phone: maria.phone, beneficiaries: [] });
    mount(access, `/recepcao/contatos?contato=${contactId}`);
    const focus = await screen.findByRole('region', { name: 'Contato aberto' });
    expect(await within(focus).findByRole('heading', { name: maria.name })).toBeVisible();
    expect(mocks.contact).toHaveBeenCalledWith(contactId);
    fireEvent.click(within(focus).getByRole('button', { name: 'Fechar contato' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Contato aberto' })).not.toBeInTheDocument());
  });
});
