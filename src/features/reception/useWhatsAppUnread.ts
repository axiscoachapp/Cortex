import { useQuery } from '@tanstack/react-query';
import { useClinicAccess } from './accessContext';
import { whatsappApi } from './whatsappApi';

export const UNREAD_POLL_MS = 30_000;
const PAGE = 100;

/**
 * Open conversations with unread messages that this person can answer (unassigned or theirs), for
 * the "Conversas" toggle. A light read of one page, refreshed every 30 s while `enabled` and the tab
 * is visible. Any failure (WhatsApp not connected, no inbox access, network) shows no count.
 */
export function useWhatsAppUnread(enabled: boolean): { count: number; more: boolean } | null {
  const access = useClinicAccess();
  const actor = access?.actorId, clinic = access?.clinic?.id;
  const allowed = !!access?.active && !!clinic && !!actor && (access.admin || access.kind === 'reception');
  const query = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'unread'],
    queryFn: async ({ signal }) => {
      const page = await whatsappApi.conversations({ filter: 'open', limit: PAGE }, signal);
      const count = page.conversations.filter(row => row.unreadCount > 0 && (row.assignedTo === null || row.assignedTo === actor)).length;
      return { count, more: page.nextBefore !== null };
    },
    enabled: enabled && allowed,
    retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: UNREAD_POLL_MS, refetchIntervalInBackground: false,
  });
  if (!enabled || !allowed || !query.isSuccess) return null;
  return query.data;
}

export function conversationsLabel(unread: { count: number; more: boolean } | null) {
  if (!unread || unread.count === 0) return 'Conversas';
  return `Conversas (${unread.count}${unread.more ? '+' : ''})`;
}
