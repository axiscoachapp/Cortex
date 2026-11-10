import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { useClinicAccess } from './accessContext';
import { NewCaseDialog, type ContactOption } from './NewCaseDialog';
import { ContactDirectory } from './ContactDirectory';
import { ContactCorrectionDialog } from './ContactCorrectionDialog';
import { ContactLinksDialog } from './ContactLinksDialog';

export default function ContactsPage() {
  const access = useClinicAccess();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ContactOption>();
  const [editing, setEditing] = useState<string | null>(null);
  const [viewingLinks, setViewingLinks] = useState<Pick<ContactOption, 'id' | 'name'> | null>(null);
  useEffect(() => { setViewingLinks(null); }, [access?.actorId, access?.clinic?.id, access?.admin, access?.active, access?.kind]);
  return (
    <div className="space-y-5">
      <PageHeading title="Contatos da recepção" description="Cadastro administrativo. Os prontuários permanecem separados por médico." actions={
        <Button
          className="min-h-11 gap-2"
          onClick={() => {
            setSelected(undefined);
            setCreating(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Novo atendimento
        </Button>
      } />
      <ContactDirectory onOpen={contact => { setSelected(contact); setCreating(true); }} onEdit={setEditing} onLinks={setViewingLinks} />
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
