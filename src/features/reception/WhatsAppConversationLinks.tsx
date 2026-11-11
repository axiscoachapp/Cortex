import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { receptionApi } from './api';
import { NewCaseDialog } from './NewCaseDialog';
import { displayPhone } from './queueTime';

/**
 * The contact and the case a conversation is linked to, when the server has them. Only ids come
 * from the conversation; the contact's name is read with the reception's own access rules.
 */
export function WhatsAppConversationLinks({ actor, contactId, caseId }: { actor: string; contactId: string | null; caseId: string | null }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const contact = useQuery({
    queryKey: ['reception', actor, 'contact', contactId],
    queryFn: () => receptionApi.contact(contactId!),
    enabled: !!contactId,
    retry: false, staleTime: 60_000, refetchOnWindowFocus: false,
  });
  if (!contactId && !caseId) return null;
  const data = contact.data && contact.data.id === contactId ? contact.data : null;
  return <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
    {contactId && <p className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
      Contato: <strong className="font-medium">{data ? data.name : contact.isError ? 'cadastrado' : '…'}</strong>
      {data?.phone ? <span className="text-muted-foreground"> · {displayPhone(data.phone)}</span> : null}
    </p>}
    {contactId && <Button asChild variant="outline" className="min-h-11"><Link to={`/recepcao/contatos?contato=${contactId}`}>Abrir contato</Link></Button>}
    {caseId && <Button asChild variant="outline" className="min-h-11"><Link to={`/recepcao?case=${caseId}`}>Abrir atendimento</Link></Button>}
    {contactId && <Button variant="outline" className="min-h-11" disabled={!data} onClick={() => setCreating(true)}>Novo atendimento</Button>}
    {creating && data && <NewCaseDialog contact={{ id: data.id, name: data.name, phone: data.phone }} onClose={() => setCreating(false)}
      onCreated={id => { setCreating(false); navigate('/recepcao?case=' + id); }} />}
  </div>;
}
