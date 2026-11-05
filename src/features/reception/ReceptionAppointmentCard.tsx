import { Button } from '@/components/ui/button';
import { useClinicAccess } from './accessContext';
import { appointmentTiming } from './appointmentTiming';
import type { ReceptionAppointment } from './contracts';

const statusLabels = { agendado: 'Agendado', confirmado: 'Confirmado', cancelado: 'Cancelado', realizado: 'Realizado' };
export function ReceptionAppointmentCard({ appointment: a, pending, onAction, onEdit }: {
  appointment: ReceptionAppointment; pending: boolean; onAction: (action: string) => void; onEdit: () => void;
}) {
  const access = useClinicAccess(), timing = appointmentTiming(a);
  return <article className={`rounded-xl border bg-card p-4 space-y-3 ${a.status === 'cancelado' ? 'opacity-65' : ''}`}>
    <div className="flex flex-wrap justify-between gap-2">
      <span className="font-semibold text-sm tabular-nums break-words">{timing.label}</span>
      <span className="text-xs">{a.checkedInAt ? 'Chegada registrada · ' : ''}{statusLabels[a.status]}</span>
    </div>
    <div><h3 className="font-semibold break-words">{a.patientName}</h3><p className="text-xs text-muted-foreground mt-1">
      {access?.doctors.find(d => d.id === a.doctorId)?.name ?? 'Médico'} · {a.type === 'novo' ? 'Primeira consulta' : a.type === 'retorno' ? 'Retorno' : a.type === 'seguimento' ? 'Seguimento' : 'Encaixe'}
    </p></div>
    {!timing.valid && <div className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-3 text-xs space-y-1"><p className="font-semibold">Horário cadastrado inválido</p><p>{a.status === 'cancelado' ? 'Reserva cancelada. O intervalo original e o histórico foram preservados.' : a.status === 'realizado' ? 'Atendimento realizado. O intervalo original foi preservado; confira o cadastro com a administração.' : 'O intervalo original foi preservado. Para corrigir, cancele esta reserva e crie outra após conferir a data e o horário.'}</p></div>}
    {['pending', 'failed'].includes(a.googleSyncStatus) && <p className="text-xs text-muted-foreground">Sincronização externa pendente. A reserva está registrada no Cortex.</p>}
    {a.status !== 'cancelado' && a.status !== 'realizado' && <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={pending || !timing.valid} onClick={() => onAction('confirm')}>Confirmar presença</Button>
      <Button size="sm" variant="outline" disabled={pending || !timing.valid} onClick={() => onAction(a.checkedInAt ? 'undo_check_in' : 'check_in')}>{a.checkedInAt ? 'Desfazer chegada' : 'Registrar chegada'}</Button>
      <Button size="sm" variant="outline" disabled={pending || !timing.valid} onClick={onEdit}>Remarcar</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
        const message = timing.valid ? `Cancelar o agendamento de ${a.patientName} às ${timing.label}?` : `Cancelar o agendamento de ${a.patientName} com horário inválido? O intervalo original e o histórico serão preservados.`;
        if (window.confirm(message)) onAction('cancel');
      }}>Cancelar agendamento</Button>
    </div>}
  </article>;
}
