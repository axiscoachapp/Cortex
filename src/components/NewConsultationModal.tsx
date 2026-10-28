import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ageFromBirthdate } from '@/lib/patientImport';
import { clinicDate } from '@/lib/dates';
import { Patient } from '@/types/patient';

interface NewPatientData {
  name: string;
  age: number | null;
  dateOfBirth?: string;
  profession: string;
  phone?: string;
}

interface NewConsultationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  onStartConsultation: (patientId: string | null, newPatientData: NewPatientData | undefined, chiefComplaint: string) => Promise<void> | void;
}

export function NewConsultationModal({ open, onOpenChange, patients, onStartConsultation }: NewConsultationModalProps) {
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [newPatientProfession, setNewPatientProfession] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const resetForm = () => {
    setIsNewPatient(false); setSelectedPatientId(''); setNewPatientName('');
    setNewPatientAge(''); setDateOfBirth(''); setNewPatientProfession(''); setNewPatientPhone('');
    setChiefComplaint(''); setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setSubmitError('');
    try {
      if (isNewPatient) {
        await onStartConsultation(null, {
          name: newPatientName.trim(),
          age: dateOfBirth ? ageFromBirthdate(dateOfBirth, clinicDate()) : newPatientAge === '' ? null : Number(newPatientAge),
          dateOfBirth: dateOfBirth || undefined,
          profession: newPatientProfession.trim(),
          phone: newPatientPhone.trim() || undefined,
        }, chiefComplaint.trim());
      } else {
        await onStartConsultation(selectedPatientId, undefined, chiefComplaint.trim());
      }
      resetForm();
      onOpenChange(false);
    } catch {
      setSubmitError('Não foi possível iniciar a consulta. Seus dados foram mantidos; tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const validAge = newPatientAge === '' || (Number.isInteger(Number(newPatientAge)) && Number(newPatientAge) >= 0 && Number(newPatientAge) <= 130);
  const isValid = !!chiefComplaint.trim() && (isNewPatient ? !!newPatientName.trim() && (dateOfBirth ? ageFromBirthdate(dateOfBirth, clinicDate()) !== null : validAge) : !!selectedPatientId);
  const canClose = useUnsavedChanges(open && (!!chiefComplaint.trim() || !!newPatientName.trim() || !!dateOfBirth || !!newPatientAge || !!newPatientPhone || !!newPatientProfession));
  const close = (next: boolean) => {
    if (saving) return;
    if (!canClose(next)) return;
    if (!next) resetForm();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-[500px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Nova Consulta</DialogTitle>
          <DialogDescription className="sr-only">Selecione ou cadastre um paciente e informe a queixa principal para iniciar.</DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-5 mt-2" aria-busy={saving}>
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <fieldset disabled={saving} className="space-y-5">
          {/* Patient Selection Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={!isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(false)}
              className="flex-1"
            >
              Paciente Existente
            </Button>
            <Button
              type="button"
              variant={isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(true)}
              className="flex-1"
            >
              Novo Paciente
            </Button>
          </div>

          {!isNewPatient ? (
            <div className="space-y-2">
              <Label htmlFor="patient-select">Selecionar Paciente</Label>
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger id="patient-select">
                  <SelectValue placeholder="Selecione um paciente..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.name} - {patient.age === null ? 'Idade não informada' : `${patient.age} anos`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-patient-name">Nome do Paciente *</Label>
                <Input
                  id="new-patient-name"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="Nome completo"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-patient-birth-date">Data de nascimento (opcional)</Label>
                <Input id="new-patient-birth-date" type="date" max={clinicDate()} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-patient-age">Idade</Label>
                  <Input
                    id="new-patient-age"
                    type="number"
                      min={0}
                      max={130}
                      step={1}
                    disabled={!!dateOfBirth}
                    value={newPatientAge}
                    onChange={(e) => setNewPatientAge(e.target.value)}
                    placeholder="Ex: 35"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-patient-profession">Profissão</Label>
                  <Input
                    id="new-patient-profession"
                    value={newPatientProfession}
                    onChange={(e) => setNewPatientProfession(e.target.value)}
                    placeholder="Ex: Engenheiro"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-patient-phone">Telefone / WhatsApp <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input
                  id="new-patient-phone"
                  type="tel"
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="Ex: (11) 99999-9999"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="chief-complaint">Queixa Principal *</Label>
            <Textarea
              id="chief-complaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Descreva a queixa principal do paciente..."
              className="min-h-[100px] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => close(false)} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" variant="medical" disabled={!isValid || saving} className="flex-1">
              {saving ? 'Iniciando…' : 'Iniciar Consulta'}
            </Button>
          </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
