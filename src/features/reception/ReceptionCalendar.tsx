import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { clinicDay, clinicDateLabel, clinicTime, clinicTimestamp, nextClinicDay } from './dates';
import type { ReceptionAppointment } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';
import { BookingDialog } from './BookingDialog';
import { useRequestId } from './useRequestId';
import { appointmentTiming } from './appointmentTiming';
import { ReceptionAppointmentCard } from './ReceptionAppointmentCard';

export default function ReceptionCalendar() {
  const access = useClinicAccess();
  const client = useQueryClient();
  const [day, setDay] = useState(() => clinicDay(new Date().toISOString()));
  const [doctor, setDoctor] = useState('');
  const [view, setView] = useState<'day' | 'week'>('day');
  const [booking, setBooking] = useState(false);
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
  const change = useMutation({
    mutationFn: ({ appointment, action }: { appointment: ReceptionAppointment; action: string }) =>
      receptionApi.changeAppointment(access!.clinic!.id, appointment.id, appointment.revision, action),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['reception'] });
      await client.invalidateQueries({ queryKey: ['appointments'] });
    },
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
  const timed = appointments.data?.items.map(appointment => ({ appointment, day: appointmentTiming(appointment).day })) ?? [];
  const undated = timed.filter(item => item.day === null);
  const renderAppointment = (appointment: ReceptionAppointment) => <ReceptionAppointmentCard key={appointment.id} appointment={appointment} pending={change.isPending} onAction={action => change.mutate({ appointment, action })} onEdit={() => setEditing(appointment)} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agenda da equipe</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Confirmação humana · horários de São Paulo · somente agendas permitidas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access?.admin && (
            <Button variant="outline" onClick={() => setBlocking(true)}>
              Bloquear horário
            </Button>
          )}
          <Button className="gap-2" onClick={() => setBooking(true)}>
            <Plus className="w-4 h-4" />
            Novo agendamento
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label htmlFor="reception-calendar-date">Data da agenda</Label>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="outline"
              aria-label="Período anterior"
              disabled={!day}
              onClick={() => chooseDay(nextClinicDay(day, view === 'day' ? -1 : -7))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Input
              id="reception-calendar-date"
              type="date"
              value={day}
              onChange={(e) => chooseDay(e.target.value)}
              className="w-auto min-w-0"
            />
            <Button
              size="icon"
              variant="outline"
              aria-label="Próximo período"
              disabled={!day}
              onClick={() => chooseDay(nextClinicDay(day, view === 'day' ? 1 : 7))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor="reception-calendar-doctor">Agenda do médico</Label>
          <select
            id="reception-calendar-doctor"
            className="block border rounded-md bg-card p-2 text-sm max-w-full"
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
          >
            <option value="">Todas as agendas permitidas</option>
            {access?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="Período da agenda" className="flex gap-1">
          <Button
            size="sm"
            variant={view === 'day' ? 'default' : 'outline'}
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            Dia
          </Button>
          <Button
            size="sm"
            variant={view === 'week' ? 'default' : 'outline'}
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Semana
          </Button>
        </div>
      </div>
      <ReceptionNotice error={periodError || change.error || unblock.error} />
      <ReceptionNotice
        loading={appointments.isPending && !!day}
        error={appointments.error}
        onRetry={() => void appointments.refetch()}
      />
      {!day && <p className="text-sm text-muted-foreground">Selecione uma data para consultar a agenda.</p>}
      {!!undated.length && <section aria-labelledby="reception-undated-heading" className="space-y-3">
        <h2 id="reception-undated-heading" className="font-semibold text-base">Reservas sem data válida de início</h2>
        <p className="text-sm text-muted-foreground">Estas reservas não foram atribuídas a um dia. Confira o cadastro antes de criar outra.</p>
        <div className="grid lg:grid-cols-2 gap-3">{undated.map(item => renderAppointment(item.appointment))}</div>
      </section>}
      {appointments.data &&
        days.map((date) => {
          const items = timed.filter(item => item.day === date).map(item => item.appointment);
          const blocks = appointments.data.blocks.filter(
            (b) => clinicDay(b.startTime) <= date && clinicDay(b.endTime) >= date,
          );
          return (
            <section key={date} className="space-y-3">
              <h2 className="font-semibold text-base border-b pb-2">{clinicDateLabel(date + 'T12:00:00Z')}</h2>
              {blocks.map((block) => (
                <div
                  key={block.id + date}
                  className="border rounded-lg bg-muted p-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-xs break-words">
                    Bloqueado · {access?.doctors.find((d) => d.id === block.doctorId)?.name} ·{' '}
                    {clinicTime(block.startTime)}–{clinicTime(block.endTime)} · {block.reason}
                  </p>
                  {access?.admin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unblock.isPending}
                      onClick={() => unblock.mutate(block)}
                    >
                      Remover bloqueio
                    </Button>
                  )}
                </div>
              ))}
              {!items.length && (
                <p className="text-sm text-muted-foreground border rounded-lg p-5 bg-card">
                  Nenhum agendamento neste dia e filtro.
                </p>
              )}
              <div className="grid lg:grid-cols-2 gap-3">
                {items.map(renderAppointment)}
              </div>
            </section>
          );
        })}
      {booking && <BookingDialog day={day || undefined} onClose={() => setBooking(false)} />}
      {editing && <RescheduleDialog appointment={editing} onClose={() => setEditing(null)} />}
      {blocking && <BlockDialog day={day || clinicDay(new Date().toISOString())} onClose={() => setBlocking(false)} />}
    </div>
  );
}

function RescheduleDialog({ appointment, onClose }: { appointment: ReceptionAppointment; onClose: () => void }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const [day, setDay] = useState(clinicDay(appointment.startTime));
  const [start, setStart] = useState(clinicTime(appointment.startTime));
  const [end, setEnd] = useState(clinicTime(appointment.endTime));
  const [confirmed, setConfirmed] = useState(false);
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Remarcar consulta</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {appointment.patientName} · horário atual: {clinicDateLabel(appointment.startTime)} às{' '}
          {clinicTime(appointment.startTime)}
        </p>
        <ReceptionNotice error={mutation.error} />
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) mutation.mutate();
          }}
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <div>
              <Label htmlFor="reschedule-date">Nova data</Label>
              <Input
                id="reschedule-date"
                type="date"
                required
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setConfirmed(false);
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="reschedule-start">Novo início</Label>
                <Input
                  id="reschedule-start"
                  type="time"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="reschedule-end">Novo término</Label>
                <Input
                  id="reschedule-end"
                  type="time"
                  required
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </div>
            </div>
            <label className="flex gap-2 text-xs">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Conferi o novo horário e confirmo a remarcação.
            </label>
          </fieldset>
          <Button disabled={!confirmed || mutation.isPending} type="submit">
            Confirmar remarcação
          </Button>
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bloquear horário</DialogTitle>
        </DialogHeader>
        <ReceptionNotice error={mutation.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <div>
              <Label htmlFor="block-doctor">Médico do bloqueio</Label>
              <select
                id="block-doctor"
                required
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                className="block border rounded-md p-2 bg-background w-full text-sm"
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="block-start">Início do bloqueio</Label>
                <Input id="block-start" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="block-end">Término do bloqueio</Label>
                <Input id="block-end" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="block-reason">Motivo administrativo</Label>
              <Input
                id="block-reason"
                required
                minLength={2}
                maxLength={120}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </fieldset>
          <Button disabled={mutation.isPending} type="submit">
            Confirmar bloqueio
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
