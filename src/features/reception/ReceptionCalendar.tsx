import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { clinicDay, clinicDateLabel, clinicTime, clinicTimestamp, nextClinicDay } from './dates';
import type { ReceptionAppointment } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';
import { BookingDialog } from './BookingDialog';
import { useRequestId } from './useRequestId';
import { appointmentTiming } from './appointmentTiming';
import { ReceptionAppointmentCard } from './ReceptionAppointmentCard';
import { DayAgenda } from './DayAgenda';
import { addMinutes, bookingSummary, dayEntries, dayHeading, minutesBetween } from './agendaTime';
import { FormError } from './FormError';
import { dialogLayout } from './dialogLayout';

function intervalError(day: string, start: string, end: string): string | null {
  try {
    const startTime = clinicTimestamp(day, start), endTime = clinicTimestamp(day, end);
    return Date.parse(endTime) > Date.parse(startTime) ? null : 'O término deve ser depois do início, no mesmo dia.';
  } catch {
    return 'Informe data e horários válidos no fuso de São Paulo.';
  }
}

export default function ReceptionCalendar() {
  const access = useClinicAccess();
  const client = useQueryClient();
  const today = clinicDay(new Date().toISOString());
  const [day, setDay] = useState(today);
  const [doctor, setDoctor] = useState('');
  const [view, setView] = useState<'day' | 'week'>('day');
  const [booking, setBooking] = useState<{ doctor?: string; day?: string; start?: string } | null>(null);
  const [editing, setEditing] = useState<ReceptionAppointment | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [periodError, setPeriodError] = useState<unknown>(null);
  const start = day ? clinicTimestamp(day, '00:00') : null;
  const end = day ? clinicTimestamp(nextClinicDay(day, view === 'day' ? 1 : 7), '00:00') : null;
  const appointments = useQuery({
    queryKey: ['reception', access?.actorId, 'calendar', access?.clinic?.id, day, view, doctor],
    queryFn: () => receptionApi.appointments(access!.clinic!.id, start!, end!, doctor || null),
    enabled: !!access?.clinic && !!start && !!end,
    retry: false,
    refetchInterval: 15_000,
  });
  // The doctors' own commitments: only start and end, shown as "Ocupado".
  const busy = useQuery({
    queryKey: ['reception', access?.actorId, 'busy', access?.clinic?.id, day, view, doctor],
    queryFn: () => receptionApi.busyIntervals(access!.clinic!.id, start!, end!, doctor || null),
    enabled: !!access?.clinic && !!start && !!end,
    retry: false,
    refetchInterval: 15_000,
  });
  const unblock = useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) => receptionApi.unblock(id, revision),
    onSettled: () => client.invalidateQueries({ queryKey: ['reception'] }),
  });
  function chooseDay(value: string) {
    try {
      if (value) clinicTimestamp(value, '00:00');
      setDay(value);
      setPeriodError(null);
    } catch (err) {
      setPeriodError(err);
    }
  }
  const days = day ? Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => nextClinicDay(day, i)) : [];
  const items = appointments.data?.items ?? [];
  const blocks = appointments.data?.blocks ?? [];
  const busyItems = busy.data ?? [];
  const undated = items.filter(appointment => appointmentTiming(appointment).day === null);
  const doctors = (access?.doctors ?? []).filter(d => !doctor || d.id === doctor);
  const nameOf = (id: string) => access?.doctors.find(d => d.id === id)?.name ?? 'Médico';
  const renderAppointment = (appointment: ReceptionAppointment) =>
    <ReceptionAppointmentCard appointment={appointment} today={today} onEdit={() => setEditing(appointment)} />;
  const renderBlockAction = (block: { id: string; revision: number }) => access?.admin
    ? <Button size="sm" variant="outline" className="min-h-9" disabled={unblock.isPending} onClick={() => unblock.mutate(block)}>Remover bloqueio</Button>
    : null;
  return (
    <div className="space-y-5">
      <PageHeading title="Agenda da equipe" description="Horários de Brasília." actions={
        <div className="flex flex-wrap gap-2">
          {access?.admin && (
            <Button variant="outline" className="min-h-11" onClick={() => setBlocking(true)}>
              Bloquear horário
            </Button>
          )}
          <Button className="min-h-11 gap-2" onClick={() => setBooking({ day: day || undefined, doctor: doctor || undefined })}>
            <Plus className="w-4 h-4" />
            Novo agendamento
          </Button>
        </div>
      } />
      <div className="grid items-end gap-3 rounded-xl border bg-card p-3 md:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="reception-calendar-date">Data da agenda</Label>
          <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <Input
              id="reception-calendar-date"
              type="date"
              value={day}
              onChange={(e) => chooseDay(e.target.value)}
              className="col-span-3 h-11 min-w-0 sm:col-span-1"
            />
            <Button
              size="icon"
              variant="outline"
              className="h-11 w-full sm:w-11"
              aria-label="Período anterior"
              disabled={!day}
              onClick={() => chooseDay(nextClinicDay(day, view === 'day' ? -1 : -7))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-11 w-full sm:w-11"
              aria-label="Próximo período"
              disabled={!day}
              onClick={() => chooseDay(nextClinicDay(day, view === 'day' ? 1 : 7))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" className="h-11 px-3" disabled={day === today} onClick={() => chooseDay(today)}>Hoje</Button>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="reception-calendar-doctor">Agenda do médico</Label>
          <select
            id="reception-calendar-doctor"
            className="block min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
          >
            <option value="">Todos os médicos</option>
            {access?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="Período da agenda" className="flex gap-1 md:col-span-2 2xl:col-span-1">
          <Button
            size="sm"
            className="min-h-11 flex-1"
            variant={view === 'day' ? 'default' : 'outline'}
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            Dia
          </Button>
          <Button
            size="sm"
            className="min-h-11 flex-1"
            variant={view === 'week' ? 'default' : 'outline'}
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Semana
          </Button>
        </div>
      </div>
      <ReceptionNotice error={periodError || unblock.error} />
      <ReceptionNotice
        loading={appointments.isPending && !!day}
        error={appointments.error}
        onRetry={() => void appointments.refetch()}
      />
      {busy.isError && appointments.data && (
        <p role="status" className="text-xs text-muted-foreground">
          Não foi possível conferir os compromissos particulares dos médicos. O horário é conferido ao agendar.
        </p>
      )}
      {!day && <p className="text-sm text-muted-foreground">Selecione uma data para consultar a agenda.</p>}
      {!!undated.length && <section aria-labelledby="reception-undated-heading" className="space-y-3">
        <h2 id="reception-undated-heading" className="font-semibold text-base">Reservas sem data válida de início</h2>
        <p className="text-sm text-muted-foreground">Estas reservas não foram atribuídas a um dia. Confira o cadastro antes de criar outra.</p>
        <div className="space-y-1.5">{undated.map(appointment => <div key={appointment.id}>{renderAppointment(appointment)}</div>)}</div>
      </section>}
      {appointments.data &&
        days.map((date) => {
          const bookable = date >= today;
          // In the week, a doctor with nothing that day is left out; the day view lists every doctor with their free time.
          const shown = view === 'day' ? doctors : doctors.filter(d => dayEntries(date, d.id, items, blocks, busyItems).length > 0);
          return (
            <section key={date} aria-label={dayHeading(date, today)} className="space-y-3">
              <h2 className="border-b pb-2 text-base font-semibold">{dayHeading(date, today)}</h2>
              {!shown.length && (
                <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">Nenhum agendamento neste dia.</p>
              )}
              <div className={view === 'day' && shown.length > 1 ? 'grid gap-4 2xl:grid-cols-2' : 'space-y-4'}>
                {shown.map(d => (
                  <div key={d.id} className="min-w-0 space-y-2">
                    {doctors.length > 1 && <h3 className="text-sm font-semibold text-muted-foreground">{d.name}</h3>}
                    <DayAgenda
                      day={date} doctor={d.id} items={items} blocks={blocks} busy={busyItems}
                      withFree={view === 'day' && bookable}
                      renderAppointment={renderAppointment}
                      renderBlockAction={renderBlockAction}
                      onBook={bookable ? start => setBooking({ doctor: d.id, day: date, start }) : undefined}
                      emptyText="Nenhum agendamento neste dia."
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      {booking && <BookingDialog day={booking.day} doctor={booking.doctor} start={booking.start} onClose={() => setBooking(null)} />}
      {editing && <RescheduleDialog appointment={editing} doctorName={nameOf(editing.doctorId)} onClose={() => setEditing(null)} />}
      {blocking && <BlockDialog day={day || today} onClose={() => setBlocking(false)} />}
    </div>
  );
}

function RescheduleDialog({ appointment, doctorName, onClose }: { appointment: ReceptionAppointment; doctorName: string; onClose: () => void }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const [day, setDay] = useState(clinicDay(appointment.startTime));
  const [start, setStart] = useState(clinicTime(appointment.startTime));
  const [end, setEnd] = useState(clinicTime(appointment.endTime));
  const validationError = intervalError(day, start, end);
  const mutation = useMutation({
    mutationFn: () =>
      receptionApi.changeAppointment(
        access!.clinic!.id,
        appointment.id,
        appointment.revision,
        'reschedule',
        clinicTimestamp(day, start),
        clinicTimestamp(day, end),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
      await client.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
  });
  // The end follows the start, keeping the appointment's length.
  function moveStart(value: string) {
    const length = minutesBetween(start, end);
    setStart(value);
    const next = length > 0 ? addMinutes(value, length) : null;
    if (next) setEnd(next);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className={dialogLayout.content}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>Remarcar</DialogTitle>
          <DialogDescription>
            {appointment.patientName} · marcado para {clinicDateLabel(appointment.startTime)} às {clinicTime(appointment.startTime)}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validationError && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className={dialogLayout.body}><fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
            <div>
              <Label htmlFor="reschedule-date">Nova data</Label>
              <Input id="reschedule-date" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="reschedule-start">Novo início</Label>
                <Input id="reschedule-start" type="time" required value={start} onChange={(e) => moveStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="reschedule-end">Novo término</Label>
                <Input
                  id="reschedule-end"
                  type="time"
                  required
                  value={end}
                  aria-invalid={!!validationError}
                  aria-describedby={validationError ? 'reschedule-interval-error' : undefined}
                  onChange={(e) => setEnd(e.target.value)}
                />
                {validationError && <p id="reschedule-interval-error" role="alert" className="mt-1 text-sm text-destructive">{validationError}</p>}
              </div>
            </div>
          </fieldset></div>
          <div className={dialogLayout.footer}>
            <FormError error={mutation.error} />
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" className={dialogLayout.button} disabled={mutation.isPending} onClick={onClose}>Cancelar</Button>
              <Button className={dialogLayout.button} disabled={!!validationError || mutation.isPending} type="submit">
                {mutation.isPending ? 'Remarcando…' : validationError ? 'Remarcar' : bookingSummary(day, start, doctorName).replace(/^Agendar/, 'Remarcar para')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BlockDialog({ day: initialDay, onClose }: { day: string; onClose: () => void }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const request = useRequestId();
  const [doctor, setDoctor] = useState('');
  const [day, setDay] = useState(initialDay);
  const [start, setStart] = useState('12:00');
  const [end, setEnd] = useState('13:00');
  const [reason, setReason] = useState('Indisponível');
  const validationError = intervalError(day, start, end);
  const mutation = useMutation({
    mutationFn: () => {
      const details = { doctor, day, start, end, reason };
      return receptionApi.block(
        access!.clinic!.id,
        doctor,
        clinicTimestamp(day, start),
        clinicTimestamp(day, end),
        reason,
        request(details),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className={dialogLayout.content}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>Bloquear horário</DialogTitle>
          <DialogDescription>O intervalo fica indisponível para agendamentos na agenda escolhida.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!validationError && !mutation.isPending) mutation.mutate();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className={dialogLayout.body}><fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
            <div>
              <Label htmlFor="block-doctor">Médico do bloqueio</Label>
              <select
                id="block-doctor"
                required
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                className="block min-h-11 border rounded-md p-2 bg-background w-full text-sm"
              >
                <option value="">Selecione o médico</option>
                {access?.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="block-date">Data do bloqueio</Label>
              <Input id="block-date" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="block-start">Início do bloqueio</Label>
                <Input id="block-start" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="block-end">Término do bloqueio</Label>
                <Input id="block-end" type="time" required value={end} aria-invalid={!!validationError} aria-describedby={validationError ? 'block-interval-error' : undefined} onChange={(e) => setEnd(e.target.value)} />
                {validationError && <p id="block-interval-error" role="alert" className="mt-1 text-sm text-destructive">{validationError}</p>}
              </div>
            </div>
            <div>
              <Label htmlFor="block-reason">Motivo</Label>
              <Input
                id="block-reason"
                required
                minLength={2}
                maxLength={120}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </fieldset></div>
          <div className={dialogLayout.footer}>
            <FormError error={mutation.error} />
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" className={dialogLayout.button} disabled={mutation.isPending} onClick={onClose}>Cancelar</Button>
              <Button className={dialogLayout.button} disabled={!!validationError || mutation.isPending} type="submit">
                {mutation.isPending ? 'Bloqueando…' : 'Bloquear horário'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
