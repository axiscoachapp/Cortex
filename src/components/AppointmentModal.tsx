import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Trash2, Mail, MessageCircle, Loader2, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectSeparator,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Appointment, Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const NEW_PATIENT = '__new__';

interface AppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  defaultStart?: Date;
  defaultEnd?: Date;
  patients: Patient[];
  userId: string;
  googleConnected: boolean;
  onSaved: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  novo: 'Novo',
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  urgencia: 'Urgência',
};

const STATUS_LABELS: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  realizado: 'Realizado',
};

function toTimeString(date: Date) {
  return format(date, 'HH:mm');
}

function buildDateTime(date: Date, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const result = new Date(date);
  result.setHours(h, m, 0, 0);
  return result;
}

export function AppointmentModal({
  open,
  onOpenChange,
  appointment,
  defaultStart,
  defaultEnd,
  patients,
  userId,
  googleConnected,
  onSaved,
}: AppointmentModalProps) {
  const isEdit = !!appointment;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'novo' | 'retorno' | 'seguimento' | 'urgencia'>('retorno');
  const [date, setDate] = useState<Date>(defaultStart ?? new Date());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [status, setStatus] = useState<'agendado' | 'confirmado' | 'cancelado' | 'realizado'>('agendado');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [loadingWa, setLoadingWa] = useState(false);

  // New patient inline fields
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const isNewPatient = patientId === NEW_PATIENT;

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setPatientId(appointment.patientId ?? '');
      setTitle(appointment.title);
      setType(appointment.type);
      setDate(appointment.startTime);
      setStartTime(toTimeString(appointment.startTime));
      setEndTime(toTimeString(appointment.endTime));
      setStatus(appointment.status);
      setNotes(appointment.notes ?? '');
    } else {
      setPatientId('');
      setTitle('');
      setType('retorno');
      setDate(defaultStart ?? new Date());
      setStartTime(defaultStart ? toTimeString(defaultStart) : '09:00');
      setEndTime(defaultEnd ? toTimeString(defaultEnd) : '09:30');
      setStatus('agendado');
      setNotes('');
    }
    setNewName('');
    setNewAge('');
    setNewPhone('');
  }, [open, appointment, defaultStart, defaultEnd]);

  // Auto-fill title when patient or type changes
  useEffect(() => {
    if (isEdit) return;
    if (isNewPatient) {
      if (newName.trim()) setTitle(`${newName.trim()} — ${TYPE_LABELS[type]}`);
    } else {
      const p = patients.find(p => p.id === patientId);
      if (p) setTitle(`${p.name} — ${TYPE_LABELS[type]}`);
    }
  }, [patientId, type, isEdit, newName, isNewPatient]);

  const selectedPatient = isNewPatient ? undefined : patients.find(p => p.id === patientId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isNewPatient) {
      if (!newName.trim()) {
        toast({ title: 'Nome do paciente é obrigatório', variant: 'destructive' });
        return;
      }
      if (!newAge || parseInt(newAge) < 0) {
        toast({ title: 'Idade inválida', variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    try {
      const startDt = buildDateTime(date, startTime);
      const endDt = buildDateTime(date, endTime);

      // Create new patient inline if needed
      let resolvedPatientId: string | null = patientId || null;
      if (isNewPatient) {
        const { data: newPatient, error: patientError } = await supabase
          .from('patients')
          .insert([{
            user_id: userId,
            name: newName.trim(),
            age: parseInt(newAge),
            phone: newPhone.trim() || null,
            last_visit: startDt.toISOString().split('T')[0],
            status: 'novo',
          }])
          .select('id')
          .single();
        if (patientError) throw patientError;
        resolvedPatientId = newPatient.id;
        queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      }

      const payload = {
        user_id: userId,
        patient_id: resolvedPatientId,
        title: title.trim(),
        type,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        status,
        notes: notes.trim() || null,
      };

      let savedId = appointment?.id;

      if (isEdit) {
        const { error } = await supabase
          .from('appointments')
          .update(payload)
          .eq('id', appointment!.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('appointments')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        savedId = data.id;
      }

      // Sync to Google Calendar if connected
      if (googleConnected && savedId) {
        supabase.functions.invoke('sync-google-calendar', {
          body: {
            action: isEdit ? 'update' : 'create',
            userId,
            appointment: {
              id: savedId,
              title: payload.title,
              start_time: payload.start_time,
              end_time: payload.end_time,
              notes: payload.notes,
              google_event_id: appointment?.googleEventId,
            },
          },
        }).catch(() => {}); // non-blocking
      }

      toast({
        title: isEdit ? 'Consulta atualizada!' : 'Consulta agendada!',
        description: isNewPatient ? `Paciente "${newName.trim()}" cadastrado e vinculado.` : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!appointment) return;
    setDeleting(true);
    try {
      if (googleConnected && appointment.googleEventId) {
        supabase.functions.invoke('sync-google-calendar', {
          body: { action: 'delete', userId, appointment: { id: appointment.id, google_event_id: appointment.googleEventId } },
        }).catch(() => {});
      }
      const { error } = await supabase.from('appointments').delete().eq('id', appointment.id);
      if (error) throw error;
      toast({ title: 'Consulta excluída' });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao excluir', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleEmailReminder = async () => {
    if (!appointment) return;
    setSendingEmail(true);
    try {
      const { error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: appointment.id, type: 'email', userId },
      });
      if (error) throw error;
      toast({ title: 'Lembrete enviado por email!' });
    } catch {
      toast({ title: 'Erro ao enviar email', variant: 'destructive' });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleWhatsAppReminder = async () => {
    if (!appointment) return;
    setLoadingWa(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-appointment-reminder', {
        body: { appointmentId: appointment.id, type: 'whatsapp', userId },
      });
      if (error) throw error;
      if (data?.waLink) window.open(data.waLink, '_blank');
    } catch {
      toast({ title: 'Erro ao gerar link WhatsApp', variant: 'destructive' });
    } finally {
      setLoadingWa(false);
    }
  };

  const canSave = title.trim() && (!isNewPatient || (newName.trim() && newAge));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Consulta' : 'Nova Consulta'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 mt-2">
          {/* Patient */}
          <div className="space-y-1.5">
            <Label>Paciente</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar paciente..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PATIENT}>
                  <span className="flex items-center gap-2 text-medical-blue font-medium">
                    <UserPlus className="w-3.5 h-3.5" />
                    Novo Paciente...
                  </span>
                </SelectItem>
                {patients.length > 0 && <SelectSeparator />}
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.age} anos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Inline new patient form */}
            {isNewPatient && (
              <div className="rounded-lg border border-medical-blue/20 bg-medical-blue-light/40 p-3 space-y-3 mt-2">
                <p className="text-xs font-medium text-medical-blue flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />
                  Novo paciente — será cadastrado ao agendar
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Nome completo"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Idade *</Label>
                    <Input
                      type="number"
                      min={0}
                      max={130}
                      value={newAge}
                      onChange={e => setNewAge(e.target.value)}
                      placeholder="Ex: 42"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Telefone <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                    <Input
                      value={newPhone}
                      onChange={e => setNewPhone(e.target.value)}
                      placeholder="(11) 9 9999-9999"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Título da consulta"
              required
            />
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={v => setType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Selecionar data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={d => d && setDate(d)}
                  locale={ptBR}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Início</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Fim</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Motivo, observações pré-consulta..."
              className="min-h-[80px] resize-none"
            />
          </div>

          {/* Reminder buttons (edit only, existing patient only) */}
          {isEdit && selectedPatient && (
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 flex-1"
                onClick={handleEmailReminder}
                disabled={sendingEmail || !selectedPatient.email}
                title={!selectedPatient.email ? 'Paciente sem email cadastrado' : undefined}
              >
                {sendingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Lembrete Email
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 flex-1 text-whatsapp-green border-whatsapp-green/30 hover:bg-whatsapp-green/10"
                onClick={handleWhatsAppReminder}
                disabled={loadingWa || !selectedPatient.phone}
                title={!selectedPatient.phone ? 'Paciente sem telefone cadastrado' : undefined}
              >
                {loadingWa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                WhatsApp
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="medical" disabled={saving || !canSave}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isEdit ? 'Atualizar' : isNewPatient ? 'Cadastrar e Agendar' : 'Agendar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
