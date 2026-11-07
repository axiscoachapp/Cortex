import { useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PatientWorkspace } from '@/pages/ClinicalWorkspace';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  patientId: string;
  manual: boolean;
  appointmentId?: string;
  initialTitle?: string;
  onClose: () => void;
  onExitGuardChange?: (guard: () => boolean) => void;
  returnFocus?: HTMLElement | null;
};

export function PatientWorkspaceDialog(props: Props) {
  const { user } = useAuth();
  return <ScopedDialog key={`${user?.id}/${props.patientId}`} {...props} />;
}

function ScopedDialog({ patientId, manual, appointmentId, initialTitle, onClose, onExitGuardChange, returnFocus }: Props) {
  const exit = useRef<() => boolean>(() => true);
  return <Dialog open onOpenChange={open => { if (!open && exit.current()) onClose(); }}>
    <DialogContent className="w-[calc(100%_-_1.5rem)] max-w-5xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6"
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus(); }}>
      <DialogHeader className="pr-7 text-left">
        <DialogTitle>Acompanhamento do paciente</DialogTitle>
        <DialogDescription>Consultas manuais, tarefas e registros deste paciente. As versões salvas permanecem no prontuário.</DialogDescription>
      </DialogHeader>
      <PatientWorkspace patientId={patientId} manual={manual} appointmentParam={appointmentId} complaintParam={initialTitle}
        onExitGuardChange={guard => { exit.current = guard; onExitGuardChange?.(guard); }} />
    </DialogContent>
  </Dialog>;
}
