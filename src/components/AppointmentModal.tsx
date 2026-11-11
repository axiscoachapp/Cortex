import { canRemindAppointment } from '../../supabase/functions/_shared/reminders';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useState, useEffect, useRef } from 'react';
import { addMinutes, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Trash2, Mail, MessageCircle, Loader2, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { dialogLayout } from '@/lib/dialogLayout';
import { appointmentStatus, appointmentTypeLabel, typeLabel, type AppointmentStatus, type AppointmentType } from '@/lib/appointmentStatus';
import { nextHalfHour } from '@/lib/clinicWallTime';
import { clinicDateLabel, clinicDay, clinicTime, clinicTimestamp } from '@/features/reception/dates';
import { FormError } from '@/features/reception/FormError';
import { Appointment, Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const NEW_PATIENT = '__new__';

interface AppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  /** Real instants; shown and saved in clinic time. */
  defaultStart?: Date;
  defaultEnd?: Date;
  patients: Patient[];
  patientLookupUnavailable?: boolean;
  userId: string;
  googleConnected: boolean;
  onSaved: () => void;
}

type Field = 'newName' | 'newAge' | 'date' | 'start' | 'end' | 'title';
type FieldErrors = Partial<Record<Field, string>>;

/** Thrown by our own checks; its text is written for the doctor. */
class ShownError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayAsLocalDate = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};

function initialValues(appointment: Appointment | null, defaultStart?: Date, defaultEnd?: Date) {
  if (appointment) {
    const start = appointment.startTime.toISOString();
    return {
      patientId: appointment.patientId ?? '',
      title: appointment.title,
      type: appointment.type,
      day: clinicDay(start),
      startTime: clinicTime(start),
      endTime: clinicTime(appointment.endTime.toISOString()),
      status: appointment.status,
      notes: appointment.notes ?? '',
    };
  }
  const start = defaultStart ?? nextHalfHour();
  const end = defaultEnd && defaultEnd > start ? defaultEnd : addMinutes(start, 30);
  return {
    patientId: '',
    title: '',
    type: 'retorno' as AppointmentType,
    day: clinicDay(start.toISOString()),
    startTime: clinicTime(start.toISOString()),
    endTime: clinicTime(end.toISOString()),
    status: 'agendado' as AppointmentStatus,
    notes: '',
  };
}

export function AppointmentModal({
  open,
  onOpenChange,
  appointment,
  defaultStart,
  defaultEnd,
  patients,
  patientLookupUnavailable = false,
  userId,
  googleConnected,
  onSaved,
}: AppointmentModalProps) {
  const isEdit = !!appointment;
  const patientLocked = appointment?.receptionManaged === true;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AppointmentType>('retorno');
  const [day, setDay] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [status, setStatus] = useState<AppointmentStatus>('agendado');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [loadingWa, setLoadingWa] = useState(false);
  const [waLinks, setWaLinks] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<Error | null>(null);
  const appointmentKey = appointment ? `${appointment.id}/${appointment.revision ?? 1}` : '';
  const activeAppointmentId = useRef(appointmentKey);
  activeAppointmentId.current = appointmentKey;
  const fieldRefs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  const bindField = (field: Field) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  // New patient inline fields
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [initialForm, setInitialForm] = useState('');

  const isNewPatient = !patientLocked && patientId === NEW_PATIENT;

  useEffect(() => {
    if (!open) return;
    setLoadingWa(false);
    const values = initialValues(appointment, defaultStart, defaultEnd);
    setPatientId(values.patientId);
    setTitle(values.title);
    setType(values.type);
    setDay(values.day);
    setStartTime(values.startTime);
    setEndTime(values.endTime);
    setStatus(values.status);
    setNotes(values.notes);
    setNewName('');
    setNewAge('');
    setNewPhone('');
    setErrors({});
    setFormError(null);
    setInitialForm(
      JSON.stringify([
        values.patientId,
        values.title,
        values.type,
        values.day,
        values.startTime,
        values.endTime,
        values.status,
        values.notes,
        '',
        '',
        '',
      ]),
    );
  }, [open, appointment, defaultStart, defaultEnd]);

  // Auto-fill title when patient or type changes
  useEffect(() => {
    if (isEdit) return;
    if (isNewPatient) {
      if (newName.trim()) setTitle(`${newName.trim()} — ${typeLabel(type)}`);
    } else {
      const p = patients.find((p) => p.id === patientId);
      if (p) setTitle(`${p.name} — ${typeLabel(type)}`);
    }
  }, [patientId, type, isEdit, newName, isNewPatient, patients]);

  const selectedPatient = isNewPatient ? undefined : patients.find((p) => p.id === patientId);

  const clearError = (field: Field) => setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));

  /** Field messages in the order the fields appear; the first one gets focus. */
  const validate = (): { errors: FieldErrors; start?: string; end?: string } => {
    const found: FieldErrors = {};
    if (isNewPatient && !newName.trim()) found.newName = 'Informe o nome do paciente.';
    if (isNewPatient && newAge !== '' && (!Number.isInteger(Number(newAge)) || Number(newAge) < 0 || Number(newAge) > 130))
      found.newAge = 'Informe uma idade entre 0 e 130 anos.';
    if (!DAY.test(day)) found.date = 'Escolha a data.';
    if (!startTime) found.start = 'Informe o horário de início.';
    if (!endTime) found.end = 'Informe o horário de fim.';
    else if (startTime && endTime <= startTime) found.end = 'O fim deve ser depois do início.';
    let start: string | undefined;
    let end: string | undefined;
    if (!found.date && !found.start && !found.end) {
      try {
        start = clinicTimestamp(day, startTime);
        end = clinicTimestamp(day, endTime);
      } catch {
        found.start = 'Horário inválido. Confira o início e o fim.';
      }
    }
    if (!title.trim())
      found.title = patientId ? 'Informe um título.' : 'Escolha o paciente ou escreva um título.';
    return { errors: found, start, end };
  };

  const showFieldErrors = (found: FieldErrors) => {
    setErrors(found);
    const order: Field[] = ['newName', 'newAge', 'date', 'start', 'end', 'title'];
    const first = order.find((field) => found[field]);
    const element = first ? fieldRefs.current[first] : null;
    if (element) {
      element.scrollIntoView?.({ block: 'center' });
      element.focus();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || deleting) return;
    setFormError(null);
    if (patientLookupUnavailable) {
      setFormError(new ShownError('A lista de pacientes não carregou. Feche, toque em “Recarregar pacientes” e tente de novo.'));
      return;
    }
    const checked = validate();
    if (Object.values(checked.errors).some(Boolean) || !checked.start || !checked.end) {
      showFieldErrors(checked.errors);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      // Create new patient inline if needed
      let resolvedPatientId: string | null = patientLocked ? appointment!.patientId : patientId || null;
      if (isNewPatient) {
        const { data: newPatient, error: patientError } = await supabase
          .from('patients')
          .insert([
            {
              user_id: userId,
              name: newName.trim(),
              age: newAge === '' ? null : Number(newAge),
              phone: newPhone.trim() || null,
              last_visit: null,
              status: 'novo',
            },
          ])
          .select('id')
          .single();
        if (patientError) throw patientError;
        resolvedPatientId = newPatient.id;
        // Keep the created patient selected if the appointment write fails,
        // so retrying does not create a duplicate patient.
        setPatientId(newPatient.id);
        queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      }

      const payload = {
        user_id: userId,
        patient_id: resolvedPatientId,
        title: title.trim(),
        type,
        start_time: checked.start,
        end_time: checked.end,
        status,
        notes: notes.trim() || null,
        ...(googleConnected ? { google_sync_status: 'pending', google_sync_error: null } : {}),
      };

      let savedId = appointment?.id;

      if (isEdit) {
        const { data: updated, error } = await supabase
          .from('appointments')
          .update(payload)
          .eq('id', appointment!.id)
          .eq('user_id', userId)
          .eq('revision', appointment!.revision ?? 1)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!updated) throw new ShownError('O agendamento mudou em outra tela. Feche, atualize a agenda e faça a alteração de novo.');
      } else {
        const { data, error } = await supabase.from('appointments').insert([payload]).select().single();
        if (error) throw error;
        savedId = data.id;
      }

      // Sync to Google Calendar if connected — non-blocking, but surface failures
      if (googleConnected && savedId) {
        supabase.functions
          .invoke('sync-google-calendar', {
            body: {
              action: isEdit ? 'update' : 'create',
              appointment: {
                id: savedId,
                google_event_id: appointment?.googleEventId,
              },
            },
          })
          .then(({ data: syncResult, error: syncError }) => {
            queryClient.invalidateQueries({ queryKey: ['appointments', userId] });
            if (syncError || syncResult?.success !== true) {
              toast({
                title: 'Google Calendar não sincronizado',
                description: 'A consulta foi salva, mas não foi enviada ao Google Calendar.',
              });
            }
          })
          .catch(() => {
            queryClient.invalidateQueries({ queryKey: ['appointments', userId] });
          });
      }

      toast({
        title: isEdit ? 'Agendamento atualizado' : 'Consulta agendada',
        description: isNewPatient ? `Paciente "${newName.trim()}" cadastrado e vinculado.` : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ShownError
          ? error
          : new ShownError('Não foi possível salvar o agendamento. Os dados continuam aqui; tente de novo.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!appointment || deleting || saving) return;
    const start = appointment.startTime.toISOString();
    if (
      !window.confirm(
        `Cancelar a consulta "${appointment.title}" de ${clinicDateLabel(start)} ${clinicTime(start)}? O histórico será preservado.`,
      )
    )
      return;
    setFormError(null);
    setDeleting(true);
    try {
      const { data: cancelled, error } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('id', appointment.id)
        .eq('user_id', userId)
        .eq('revision', appointment.revision ?? 1)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!cancelled) throw new ShownError('O agendamento mudou em outra tela. Feche e atualize a agenda antes de cancelar.');
      let syncPending = false;
      if (googleConnected && appointment.googleEventId) {
        try {
          const { error: syncError } = await supabase.functions.invoke('sync-google-calendar', {
            body: { action: 'update', appointment: { id: appointment.id } },
          });
          syncPending = !!syncError;
        } catch {
          syncPending = true;
        }
      }
      toast({
        title: 'Agendamento cancelado',
        description: syncPending ? 'Cancelamento registrado no Cortex; sincronização com o Google Calendar pendente.' : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ShownError ? error : new ShownError('Não foi possível cancelar. Atualize a agenda e tente de novo.'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleEmailReminder = async () => {
    if (!appointment || !canRemindAppointment(status, appointment.startTime)) return;
    setFormError(null);
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: appointment.id, type: 'email', userId, expectedRevision: appointment.revision ?? 1 },
      });
      if (error || data?.success !== true) throw error ?? new Error('Envio não confirmado');
      toast({ title: 'Lembrete enviado por e-mail' });
      onSaved();
    } catch {
      setFormError(new ShownError('Não foi possível enviar o lembrete por e-mail. Tente de novo.'));
    } finally {
      setSendingEmail(false);
    }
  };

  const handleWhatsAppReminder = async () => {
    if (!appointment || !canRemindAppointment(status, appointment.startTime)) return;
    const requestedId = appointmentKey;
    setFormError(null);
    setLoadingWa(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: appointment.id, type: 'whatsapp', userId, expectedRevision: appointment.revision ?? 1 },
      });
      if (error) throw error;
      if (typeof data?.waLink !== 'string') throw new Error('Link ausente');
      const link = new URL(data.waLink);
      if (link.protocol !== 'https:' || link.hostname !== 'wa.me') throw new Error('Link inválido');
      setWaLinks((previous) => ({ ...previous, [requestedId]: link.href }));
      if (activeAppointmentId.current === requestedId) {
        window.open(link.href, '_blank', 'noopener,noreferrer');
        toast({
          title: 'Link do WhatsApp pronto',
          description: 'Revise e envie a mensagem no WhatsApp. A abertura do link não confirma o envio.',
        });
      }
    } catch {
      if (activeAppointmentId.current === requestedId)
        setFormError(new ShownError('Não foi possível gerar o link do WhatsApp. Tente de novo.'));
    } finally {
      if (activeAppointmentId.current === requestedId) setLoadingWa(false);
    }
  };

  const dirty =
    initialForm !==
    JSON.stringify([patientId, title, type, day, startTime, endTime, status, notes, newName, newAge, newPhone]);
  const canClose = useUnsavedChanges(open && dirty);
  const requestClose = (next: boolean) => {
    if (saving || deleting || !canClose(next)) return;
    onOpenChange(next);
  };
  const busy = saving || deleting;
  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`appointment-${field}-error`} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;
  const invalid = (field: Field, describedBy?: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [errors[field] ? `appointment-${field}-error` : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined,
  });

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className={`sm:max-w-[40rem] ${dialogLayout.content}`}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>{isEdit ? 'Editar agendamento' : 'Novo agendamento'}</DialogTitle>
          <DialogDescription className="sr-only">
            Defina o paciente, a data, os horários e o tipo deste agendamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className={dialogLayout.body}>
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              {/* Patient */}
              <div className="space-y-1.5">
                <Label htmlFor="appointment-patient">
                  Paciente {!patientLocked && <span className="font-normal text-muted-foreground">(opcional)</span>}
                </Label>
                {patientLookupUnavailable && (
                  <p role="alert" className="text-xs text-destructive">
                    A lista de pacientes não carregou. Recarregue a lista antes de salvar.
                  </p>
                )}
                <Select
                  disabled={patientLookupUnavailable || patientLocked}
                  value={patientId}
                  onValueChange={(value) => {
                    setPatientId(value);
                    clearError('title');
                  }}
                >
                  <SelectTrigger
                    id="appointment-patient"
                    aria-describedby={patientLocked ? 'appointment-patient-guidance' : undefined}
                    className="min-h-11"
                  >
                    <SelectValue placeholder={patientLocked ? 'Paciente original indisponível' : 'Selecionar paciente'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_PATIENT}>
                      <span className="flex items-center gap-2 text-medical-blue font-medium">
                        <UserPlus className="w-3.5 h-3.5" />
                        Novo paciente
                      </span>
                    </SelectItem>
                    {patients.length > 0 && <SelectSeparator />}
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {p.age === null ? 'Idade não informada' : `${p.age} anos`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {patientLocked && (
                  <p id="appointment-patient-guidance" className="text-xs text-muted-foreground">
                    Reserva criada pela recepção. Para trocar o paciente, cancele este agendamento e faça uma nova reserva na recepção.
                  </p>
                )}

                {/* Inline new patient form */}
                {isNewPatient && (
                  <div className="rounded-lg border border-medical-blue/20 bg-medical-blue-light/40 p-3 space-y-3 mt-2">
                    <p className="text-xs font-medium text-medical-blue flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" />
                      Novo paciente — será cadastrado ao agendar
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="appointment-new-name" className="text-xs">
                        Nome
                      </Label>
                      <Input
                        id="appointment-new-name"
                        ref={bindField('newName')}
                        value={newName}
                        aria-required="true"
                        {...invalid('newName')}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          clearError('newName');
                          clearError('title');
                        }}
                        placeholder="Nome completo"
                      />
                      {fieldError('newName')}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="appointment-new-age" className="text-xs">
                          Idade <span className="text-muted-foreground font-normal">(opcional)</span>
                        </Label>
                        <Input
                          id="appointment-new-age"
                          ref={bindField('newAge')}
                          type="number"
                          min={0}
                          max={130}
                          value={newAge}
                          {...invalid('newAge')}
                          onChange={(e) => {
                            setNewAge(e.target.value);
                            clearError('newAge');
                          }}
                          placeholder="Ex: 42"
                        />
                        {fieldError('newAge')}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="appointment-new-phone" className="text-xs">
                          Telefone <span className="text-muted-foreground font-normal">(opcional)</span>
                        </Label>
                        <Input
                          id="appointment-new-phone"
                          type="tel"
                          value={newPhone}
                          onChange={(e) => setNewPhone(e.target.value)}
                          placeholder="(11) 9 9999-9999"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label htmlFor="appointment-date">Data</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="appointment-date"
                      ref={bindField('date')}
                      type="button"
                      variant="outline"
                      {...invalid('date')}
                      className={cn('h-auto min-h-11 w-full justify-start whitespace-normal text-left font-normal', !day && 'text-muted-foreground')}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        {DAY.test(day) ? format(dayAsLocalDate(day), "d 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Selecionar data'}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={DAY.test(day) ? dayAsLocalDate(day) : undefined}
                      onSelect={(d) => {
                        if (!d) return;
                        setDay(format(d, 'yyyy-MM-dd'));
                        clearError('date');
                      }}
                      locale={ptBR}
                      weekStartsOn={1}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {fieldError('date')}
              </div>

              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="appointment-start">Início</Label>
                  <Input
                    id="appointment-start"
                    ref={bindField('start')}
                    type="time"
                    value={startTime}
                    aria-required="true"
                    {...invalid('start')}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      clearError('start');
                      clearError('end');
                    }}
                  />
                  {fieldError('start')}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="appointment-end">Fim</Label>
                  <Input
                    id="appointment-end"
                    ref={bindField('end')}
                    type="time"
                    value={endTime}
                    aria-required="true"
                    {...invalid('end')}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      clearError('end');
                    }}
                  />
                  {fieldError('end')}
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">Horário de Brasília.</p>

              {/* Type */}
              <div className="space-y-1.5">
                <Label htmlFor="appointment-type">Tipo</Label>
                <Select value={type} onValueChange={(value: AppointmentType) => setType(value)}>
                  <SelectTrigger id="appointment-type" className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(appointmentTypeLabel).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Title + status */}
              <div className="space-y-1.5">
                <Label htmlFor="appointment-title">Título</Label>
                <Input
                  id="appointment-title"
                  ref={bindField('title')}
                  value={title}
                  aria-required="true"
                  {...invalid('title')}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearError('title');
                  }}
                  placeholder="Preenchido ao escolher o paciente"
                />
                {fieldError('title')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appointment-status">Status</Label>
                <Select value={status} onValueChange={(value: AppointmentStatus) => setStatus(value)}>
                  <SelectTrigger id="appointment-status" className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(appointmentStatus).map(([v, look]) => (
                      <SelectItem key={v} value={v}>
                        {look.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="appointment-notes">
                  Observações <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id="appointment-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Motivo, observações pré-consulta..."
                  aria-describedby="appointment-notes-hint"
                  className="min-h-[80px] resize-none"
                />
                <p id="appointment-notes-hint" className="text-xs text-muted-foreground">
                  Uso interno: não é enviado ao paciente nem ao Google Calendar.
                </p>
              </div>

              {/* Reminder buttons (edit only, existing patient only) */}
              {isEdit && selectedPatient && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-1.5 flex-1"
                    onClick={handleEmailReminder}
                    disabled={sendingEmail || !selectedPatient.email || !canRemindAppointment(status, appointment!.startTime)}
                    title={!selectedPatient.email ? 'Paciente sem e-mail cadastrado' : undefined}
                  >
                    {sendingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                    Lembrete por e-mail
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-1.5 flex-1 text-whatsapp-green border-whatsapp-green/30 hover:bg-whatsapp-green/10"
                    onClick={handleWhatsAppReminder}
                    disabled={loadingWa || !selectedPatient.phone || !canRemindAppointment(status, appointment!.startTime)}
                    title={!selectedPatient.phone ? 'Paciente sem telefone cadastrado' : undefined}
                  >
                    {loadingWa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                    WhatsApp
                  </Button>
                </div>
              )}
              {appointment && canRemindAppointment(status, appointment.startTime) && waLinks[appointmentKey] && (
                <div role="status" className="text-xs space-y-1">
                  <p>Link pronto. O lembrete só será enviado quando você confirmar no WhatsApp.</p>
                  <a
                    href={waLinks[appointmentKey]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-medical-blue underline"
                  >
                    Abrir WhatsApp para revisar e enviar
                  </a>
                </div>
              )}

              {appointment && !canRemindAppointment(status, appointment.startTime) && (
                <p className="text-xs text-muted-foreground">
                  Lembretes disponíveis apenas para agendamentos futuros agendados ou confirmados.
                </p>
              )}

              {isEdit && appointment.status !== 'cancelado' && (
                <div className="border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleDelete}
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Cancelar agendamento
                  </Button>
                </div>
              )}
            </fieldset>
          </div>

          <div className={dialogLayout.footer}>
            <FormError error={formError} />
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" className={dialogLayout.button} disabled={busy} onClick={() => requestClose(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="medical" className={dialogLayout.button} disabled={busy}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {isEdit ? 'Salvar alterações' : isNewPatient ? 'Cadastrar e agendar' : 'Agendar'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
