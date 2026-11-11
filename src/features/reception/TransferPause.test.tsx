// A paused re-verification keeps the transfer picker and the chosen person;
// only the final confirmation waits (review 2026-11-10, recepção finding 3).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppTransferAction } from './WhatsAppTransferAction';
import { ClinicAccessContext } from './accessContext';
import { SessionPausedContext } from '@/contexts/SessionVisibility';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation } from './whatsappApi';

const mocks = vi.hoisted(() => ({ state: vi.fn(), roster: vi.fn(), confirm: vi.fn(), actor: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('./whatsappAssignees', () => ({ readWhatsAppAssignees: mocks.roster }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./whatsappApi', () => ({ whatsappApi: { state: mocks.state } }));
const clinic = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333', target = '77777777-7777-4777-8777-777777777777', at = '2026-11-07T12:00:00Z';
const access: ClinicAccess = { actorId: mocks.actor, active: true, admin: false, kind: 'reception', clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] };
const conversation: WhatsAppConversation = { id, profileName: 'Contato sintético', waId: null, contactId: null, caseId: null, queue: 'agenda', status: 'open', assignedTo: access.actorId, assignedAt: at, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Prévia sintética', unreadCount: 1, optedOut: false, consented: true, revision: 7 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.mockResolvedValue({ serverReady: true, connected: true, canUseInbox: true });
  mocks.roster.mockResolvedValue({ items: [{ userId: target, name: 'Atendente sintético', role: 'reception', ambiguous: false }], nextBefore: null });
});

it('keeps the chosen person while paused and confirms only after the pause ends', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (paused: boolean) => <QueryClientProvider client={client}><SessionPausedContext.Provider value={paused}><ClinicAccessContext.Provider value={access}>
    <WhatsAppTransferAction actor={access.actorId} clinic={clinic} conversation={conversation} onConfirm={mocks.confirm} />
  </ClinicAccessContext.Provider></SessionPausedContext.Provider></QueryClientProvider>;
  const view = render(tree(false));
  fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }));
  const modal = await screen.findByRole('dialog', { name: 'Transferir conversa' });
  fireEvent.click(await within(modal).findByRole('button', { name: 'Selecionar Atendente sintético' }));
  view.rerender(tree(true));
  expect(within(modal).getByText(/Novo responsável/)).toHaveTextContent('Atendente sintético');
  expect(within(modal).getByText('Verificando acesso… A escolha continua preservada.')).toBeInTheDocument();
  const confirm = within(modal).getByRole('button', { name: 'Confirmar transferência' });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(mocks.confirm).not.toHaveBeenCalled();
  view.rerender(tree(false));
  expect(screen.getByRole('dialog', { name: 'Transferir conversa' })).toBe(modal);
  fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar transferência' }));
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(conversation, target);
});
