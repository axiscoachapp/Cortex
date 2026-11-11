import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useClinicAccess } from './accessContext';
import { appointmentTiming } from './appointmentTiming';
import { receptionApi } from './api';
import { clinicDateLabel, clinicDay, clinicTime } from './dates';
import { typeLabels } from './agendaTime';
import type { ReceptionAppointment } from './contracts';

const chip = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap';
export function StatusChip({ appointment: a }: { appointment: ReceptionAppointment }) {
  if (a.status === 'cancelado') return <span className={`${chip} border-muted-foreground/30 text-muted-foreground line-through`}>Cancelado</span>;
  if (a.status === 'realizado') return <span className={`${chip} border-muted-foreground/30 bg-muted text-muted-foreground`}>Realizado</span>;
  if (a.checkedInAt) return <span className={`${chip} border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200`}>Chegou {clinicTime(a.checkedInAt)}</span>;
  if (a.status === 'confirmado') return <span className={`${chip} border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200`}>Confirmado</span>;
  return <span className={`${chip} border-slate-400/40 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200`}>Agendado</span>;
}

/**
 * One appointment as a compact row: time · name · type · status, the main action
 * of the moment inline and the rest under "⋯". Each row owns its action, so its
 * error is shown right below it.
 */
export function ReceptionAppointmentCard({ appointment: a, onEdit, today = clinicDay(new Date().toISOString()) }: {
  appointment: ReceptionAppointment; onEdit: () => void; today?: string;
}) {
  const access = useClinicAccess(), client = useQueryClient(), timing = appointmentTiming(a);
  const [cancelling, setCancelling] = useState(false);
  const change = useMutation({
    mutationFn: (action: string) => receptionApi.changeAppointment(access!.clinic!.id, a.id, a.revision, action),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
      await client.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
  const pending = change.isPending;
  const act = (action: string) => { if (!pending) change.mutate(action); };
  const open = a.status !== 'cancelado' && a.status !== 'realizado';
  const isToday = timing.day === today;
  const past = !!timing.day && timing.day < today;
  // The main action of the moment: arrival on the day itself, the patient's confirmation before it.
  const primary = !open || !timing.valid ? null
    : isToday ? (a.checkedInAt ? null : { label: 'Registrar chegada', action: 'check_in' })
    : !past && a.status === 'agendado' ? { label: 'Paciente confirmou', action: 'confirm' } : null;
  const confirmInMenu = timing.valid && !past && a.status === 'agendado' && primary?.action !== 'confirm';
  const when = timing.valid ? `${clinicDateLabel(a.startTime)} às ${clinicTime(a.startTime)}` : 'horário inválido';
  return <article aria-label={`${timing.label} · ${a.patientName}`} className={`rounded-lg border bg-card px-3 py-2 ${a.status === 'cancelado' ? 'opacity-70' : ''}`}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="shrink-0 text-sm font-semibold tabular-nums">{timing.label}</span>
      <h4 className="min-w-0 flex-1 basis-40 text-sm font-medium [overflow-wrap:anywhere]">{a.patientName}</h4>
      <span className="text-xs text-muted-foreground">{typeLabels[a.type]}</span>
      <StatusChip appointment={a} />
      {open && <div className="ml-auto flex items-center gap-1">
        {primary && <Button size="sm" className="min-h-9" variant={isToday ? 'default' : 'outline'} disabled={pending} onClick={() => act(primary.action)}>{primary.label}</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-9 w-9" disabled={pending} aria-label={`Mais ações para ${a.patientName}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {confirmInMenu && <DropdownMenuItem onSelect={() => act('confirm')}>Paciente confirmou</DropdownMenuItem>}
            {timing.valid && a.checkedInAt && <DropdownMenuItem onSelect={() => act('undo_check_in')}>Desfazer chegada</DropdownMenuItem>}
            {timing.valid && <DropdownMenuItem onSelect={onEdit}>Remarcar</DropdownMenuItem>}
            {timing.valid && <DropdownMenuSeparator />}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setCancelling(true)}>Cancelar agendamento</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>}
    </div>
    {!timing.valid && <div className="mt-2 space-y-1 rounded-lg border border-amber-300/60 bg-amber-50/50 p-2 text-xs dark:bg-amber-950/20"><p className="font-semibold">Horário cadastrado inválido</p><p>{a.status === 'cancelado' ? 'Reserva cancelada. O intervalo original e o histórico foram preservados.' : a.status === 'realizado' ? 'Atendimento realizado. O intervalo original foi preservado; confira o cadastro com a administração.' : 'O intervalo original foi preservado. Para corrigir, cancele esta reserva e crie outra após conferir a data e o horário.'}</p></div>}
    {a.googleSyncStatus === 'pending' && <p className="mt-1 text-xs text-muted-foreground">Sincronização externa pendente. A reserva está registrada no Cortex.</p>}
    {a.googleSyncStatus === 'failed' && <p className="mt-1 text-xs text-muted-foreground">Não foi possível sincronizar com a agenda externa. A reserva está registrada no Cortex; confira a integração com a equipe responsável.</p>}
    {pending && <p role="status" className="mt-1 text-xs text-muted-foreground">Salvando…</p>}
    {change.error && !pending && <p role="alert" className="mt-1 text-xs text-destructive">{change.error instanceof Error ? change.error.message : 'Não foi possível concluir. Tente novamente.'}</p>}
    <AlertDialog open={cancelling} onOpenChange={setCancelling}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
          <AlertDialogDescription>
            {timing.valid
              ? `${a.patientName}, ${when}. O horário fica livre na agenda.`
              : `${a.patientName}, com horário inválido. O intervalo original e o histórico serão preservados.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Manter agendamento</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => act('cancel')}>Cancelar agendamento</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </article>;
}
