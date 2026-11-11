import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { NewCaseDialog, type ContactOption } from './NewCaseDialog';
import { NewContactDialog } from './NewContactDialog';
import { ContactDirectory } from './ContactDirectory';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { ContactLinksDialog } from './ContactLinksDialog';
import { BookingDialog } from './BookingDialog';
import { ReceptionNotice } from './ReceptionNotice';
import { displayPhone } from './queueTime';
import { relationshipLabels } from './linkRelationships';

export default function ContactsPage() {
  const access = useClinicAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [created, setCreated] = useState<ContactOption | null>(null);
  const [selected, setSelected] = useState<ContactOption>();
  const [editing, setEditing] = useState<string | null>(null);
  const [viewingLinks, setViewingLinks] = useState<Pick<ContactOption, 'id' | 'name'> | null>(null);
  const [booking, setBooking] = useState<ContactOption | null>(null);
  useEffect(() => { setViewingLinks(null); setCreated(null); setBooking(null); }, [access?.actorId, access?.clinic?.id, access?.admin, access?.active, access?.kind]);
  // "Abrir contato" from a conversation lands here with the contact's id (never its name or phone).
  const focus = z.string().uuid().safeParse(params.get('contato'));
  const openCase = (contact: ContactOption) => { setSelected(contact); setCreating(true); };
  return (
    <div className="space-y-5">
      <PageHeading title="Contatos" description="Pessoas que entram em contato com a clínica." actions={
        <Button className="min-h-11 gap-2" onClick={() => setAddingContact(true)}>
          <Plus className="w-4 h-4" />
          Novo contato
        </Button>
      } />
      {created && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="[overflow-wrap:anywhere]">Contato salvo: <strong className="font-medium">{created.name}</strong>.</p>
        <Button variant="outline" className="min-h-11" onClick={() => openCase(created)}>Novo atendimento para este contato</Button>
      </div>}
      {focus.success && access?.clinic && <ContactFocus key={`${access.actorId}:${access.clinic.id}:${focus.data}`} contactId={focus.data}
        onOpen={openCase} onEdit={access.admin ? setEditing : undefined}
        onClose={() => setParams(old => { const next = new URLSearchParams(old); next.delete('contato'); return next; })} />}
      <ContactDirectory onOpen={openCase} onEdit={setEditing} onLinks={setViewingLinks} onBook={setBooking} />
      {booking && <BookingDialog key={booking.id} contact={booking} onClose={() => setBooking(null)} />}
      {addingContact && <NewContactDialog onClose={() => setAddingContact(false)} onCreated={contact => { setAddingContact(false); setCreated(contact); }} />}
      {creating && (
        <NewCaseDialog
          contact={selected}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate('/recepcao?case=' + id);
          }}
        />
      )}
      {editing && <ContactCorrectionDialog contactId={editing} onClose={() => setEditing(null)} />}
      {viewingLinks && access?.admin && <ContactLinksDialog contactId={viewingLinks.id} contactName={viewingLinks.name} onClose={() => setViewingLinks(null)} />}
    </div>
  );
}

/** One contact opened from elsewhere (a WhatsApp conversation), read by id. */
function ContactFocus({ contactId, onOpen, onEdit, onClose }: {
  contactId: string; onOpen: (contact: ContactOption) => void; onEdit?: (id: string) => void; onClose: () => void;
}) {
  const access = useClinicAccess();
  const contact = useQuery({
    queryKey: ['reception', access?.actorId, 'contact', contactId],
    queryFn: () => receptionApi.contact(contactId),
    retry: false, staleTime: 0,
  });
  const data = contact.data?.id === contactId ? contact.data : null;
  return <section aria-label="Contato aberto" className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <h2 className="text-lg font-semibold">{data?.name ?? 'Contato'}</h2>
        {data && <p className="text-sm text-muted-foreground tabular-nums">{data.phone ? displayPhone(data.phone) : 'Sem telefone cadastrado'}</p>}
      </div>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Fechar contato" onClick={onClose}><X className="h-4 w-4" /></Button>
    </div>
    <ReceptionNotice loading={contact.isPending} error={contact.error} onRetry={() => void contact.refetch()} />
    {data && <>
      {data.beneficiaries.length > 0 && <ul className="space-y-1 text-sm">
        {data.beneficiaries.map(person => <li key={person.id + person.doctorId}>
          {person.name} · {access?.doctors.find(d => d.id === person.doctorId)?.name ?? 'Médico'} · {relationshipLabels[person.relationship]}
        </li>)}
      </ul>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => onOpen({ id: data.id, name: data.name, phone: data.phone })}>Novo atendimento para este contato</Button>
        {onEdit && <Button variant="ghost" className="min-h-11" onClick={() => onEdit(data.id)}>Corrigir contato</Button>}
      </div>
    </>}
  </section>;
}
