import { useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PatientWorkspace } from '@/pages/ClinicalWorkspace';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WorkEntry } from '@/lib/clinicalWorkspace';

type Props = {
  patientId: string;
  manual: boolean;
  entry?: WorkEntry;
  appointmentId?: string;
  initialTitle?: string;
  onClose: () => void;
  onExitGuardChange?: (guard: () => boolean) => void;
  returnFocus?: HTMLElement | null;
};

/** The dialog's title is the label of the button that opened it. */
function workspaceTitle(manual: boolean, entry?: WorkEntry): string {
  if (manual) return 'Escrever evolução';
  if (entry === 'instruction') return 'Registrar orientações';
  if (entry === 'followup') return 'Planejar retorno';
  return 'Pendências e retornos';
}

export function PatientWorkspaceDialog(props: Props) {
  const { user } = useAuth();
  return <ScopedDialog key={`${user?.id}/${props.patientId}`} {...props} />;
}

function ScopedDialog({ patientId, manual, entry, appointmentId, initialTitle, onClose, onExitGuardChange, returnFocus }: Props) {
  const exit = useRef<() => boolean>(() => true);
  return <Dialog open onOpenChange={open => { if (!open && exit.current()) onClose(); }}>
    <DialogContent className="min-w-0 grid-cols-1 w-[calc(100%_-_1.5rem)] max-w-5xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6"
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus(); }}>
      <DialogHeader className="min-w-0 pr-7 text-left">
        <DialogTitle className="[overflow-wrap:anywhere]">{workspaceTitle(manual, entry)}</DialogTitle>
        <DialogDescription>
          {manual
            ? 'Escreva e revise a evolução desta consulta. As versões salvas permanecem no prontuário.'
            : 'Tarefas, orientações e retornos deste paciente. As versões salvas permanecem no prontuário.'}
        </DialogDescription>
      </DialogHeader>
      <PatientWorkspace patientId={patientId} manual={manual} entry={entry} appointmentParam={appointmentId} complaintParam={initialTitle}
        onExitGuardChange={guard => { exit.current = guard; onExitGuardChange?.(guard); }} />
    </DialogContent>
  </Dialog>;
}
