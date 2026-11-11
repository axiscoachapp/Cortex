import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppMessages } from './WhatsAppMessages';
import type { WhatsAppConversation, WhatsAppMessage } from './whatsappApi';
import { WhatsAppMediaError } from './whatsappMedia';

const mocks = vi.hoisted(() => ({ messages: vi.fn(), botSession: vi.fn(), contact: vi.fn(), download: vi.fn(), markRead: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { messages: mocks.messages, botSession: mocks.botSession } }));
vi.mock('./whatsappSend', async original => ({ ...await original<typeof import('./whatsappSend')>(), markWhatsAppConversationRead: mocks.markRead }));
vi.mock('./whatsappMedia', async original => ({ ...await original<typeof import('./whatsappMedia')>(), downloadWhatsAppMedia: mocks.download }));
vi.mock('./api', () => ({ receptionApi: { contact: mocks.contact } }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: ({ contact }: { contact: { id: string; name: string } }) => <div role="dialog" aria-label="Novo atendimento sintético">{contact.name}</div> }));

const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222';
const contactId = '55555555-5555-4555-8555-555555555555', caseId = '66666666-6666-4666-8666-666666666666';
const now = new Date();
const today = new Date(now.getTime() - 5 * 60_000).toISOString();
const older = '2026-01-10T12:30:00.000Z';
const conversation: WhatsAppConversation = {
  id: '33333333-3333-4333-8333-333333333333', profileName: 'Contato sintético A', waId: '5541999990001', contactId, caseId, queue: 'agenda', status: 'open',
  assignedTo: actor, assignedAt: older, openedAt: older, firstResponseAt: null, closedAt: null, lastInboundAt: today, windowOpenUntil: new Date(now.getTime() + 3_600_000).toISOString(),
  lastMessageAt: today, lastMessagePreview: 'Prévia', unreadCount: 0, optedOut: false, consented: true, revision: 1,
};
const message = (n: number, patch: Partial<WhatsAppMessage>): WhatsAppMessage => ({
  id: `4444444${n}-4444-4444-8444-444444444444`, direction: 'in', kind: 'text', body: '', media: null, template: null, status: 'received', error: null, sentBy: null, at: today, ...patch,
});
const photo = message(1, { kind: 'image', media: { mime: 'image/jpeg', filename: null, voice: false } });
const pdf = message(2, { kind: 'document', media: { mime: 'application/pdf', filename: 'exame.pdf', voice: false }, at: older });
const text = message(3, { body: 'Mensagem sintética de hoje' });
function mount(patch: Partial<WhatsAppConversation> = {}, items: WhatsAppMessage[] = [text, photo, pdf]) {
  mocks.messages.mockResolvedValue({ conversation: { ...conversation, ...patch }, messages: items, nextBefore: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppMessages actor={actor} clinic={clinic} conversation={{ ...conversation, ...patch }} onClose={vi.fn()} /></QueryClientProvider></MemoryRouter>);
}
const thread = () => screen.getByRole('list', { name: 'Mensagens da conversa' });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.botSession.mockResolvedValue({ session: null });
  mocks.markRead.mockResolvedValue(true);
  mocks.contact.mockResolvedValue({ id: contactId, clinicId: clinic, name: 'Maria Cadastro', phone: '+5541999990001', beneficiaries: [] });
  URL.createObjectURL = vi.fn(() => 'blob:synthetic');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('conversation detail leftovers (C22)', () => {
  it('shows the linked contact and case with their actions', async () => {
    mount();
    expect(await screen.findByText('Maria Cadastro')).toBeVisible();
    expect(mocks.contact).toHaveBeenCalledWith(contactId);
    expect(screen.getByRole('link', { name: 'Abrir contato' })).toHaveAttribute('href', `/recepcao/contatos?contato=${contactId}`);
    expect(screen.getByRole('link', { name: 'Abrir atendimento' })).toHaveAttribute('href', `/recepcao?case=${caseId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));
    expect(screen.getByRole('dialog', { name: 'Novo atendimento sintético' })).toHaveTextContent('Maria Cadastro');
  });

  it('shows nothing about links, and reads no contact, when the conversation has none', async () => {
    mount({ contactId: null, caseId: null });
    await screen.findByText('Mensagem sintética de hoje');
    expect(screen.queryByRole('link', { name: 'Abrir contato' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo atendimento' })).not.toBeInTheDocument();
    expect(mocks.contact).not.toHaveBeenCalled();
  });

  it('shows the time only for today and the date for older messages', async () => {
    mount();
    await screen.findByText('Mensagem sintética de hoje');
    const times = within(thread()).getAllByText((_, element) => element?.tagName === 'TIME').map(element => element.textContent);
    expect(times.filter(value => /^\d{2}:\d{2}$/.test(value ?? ''))).toHaveLength(2);
    expect(times).toContain('10/01/2026 · 09:30');
  });

  it('opens a received photo in place through the media action, and downloads documents', async () => {
    mocks.download.mockResolvedValue({ blob: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg' });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount();
    await screen.findByText('Mensagem sintética de hoje');
    fireEvent.click(screen.getByRole('button', { name: 'Ver imagem' }));
    expect(await screen.findByRole('img', { name: 'Imagem recebida' })).toHaveAttribute('src', 'blob:synthetic');
    expect(mocks.download).toHaveBeenCalledWith(photo.id, expect.any(AbortSignal));
    expect(click).not.toHaveBeenCalled();
    mocks.download.mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), mime: 'application/pdf' });
    const documentItem = screen.getByText(/exame\.pdf/).closest('li')!;
    expect(within(documentItem).queryByRole('button', { name: 'Ver imagem' })).not.toBeInTheDocument();
    fireEvent.click(within(documentItem).getByRole('button', { name: 'Baixar arquivo' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.download).toHaveBeenLastCalledWith(pdf.id, expect.any(AbortSignal));
  });

  it('says what went wrong when the file cannot be fetched, without raw server text', async () => {
    mocks.download.mockRejectedValue(new WhatsAppMediaError('Este arquivo não está mais disponível no WhatsApp.', 'not_found'));
    mount();
    await screen.findByText('Mensagem sintética de hoje');
    fireEvent.click(screen.getByRole('button', { name: 'Ver imagem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este arquivo não está mais disponível no WhatsApp.');
  });
});
