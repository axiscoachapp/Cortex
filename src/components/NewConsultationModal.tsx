import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mapPatientRow } from '@/lib/patientMapper';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ageFromBirthdate } from '@/lib/patientImport';
import { clinicDate } from '@/lib/dates';
import { Patient } from '@/types/patient';
import { PatientAdministrativeFields } from '@/components/PatientAdministrativeFields';
import { validatePatientRegistration, normalizeCpf, administrativeValues } from '@/lib/patientRegistration';

interface NewPatientData {
  name: string;
  age: number | null;
  dateOfBirth?: string;
  profession: string;
  phone?: string;
  email?: string;
  cpf?: string;
  sex?: string;
  healthInsurance?: string;
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
  const [search, setSearch] = useState('');
  const term = search.trim().replace(/[%_,()]/g, '');
  // Server-side search: the directory passed in only holds the first 100 patients.
  const searchResults = useQuery({
    queryKey: ['patients', 'consultation-search', term],
    enabled: open && term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('patients').select('*').is('archived_at', null).ilike('name', `%${term}%`).order('name').limit(30);
      if (error) throw error;
      return (data ?? []).map(mapPatientRow);
    },
  });
  const visiblePatients: Patient[] =
    term.length >= 2
      ? (searchResults.data ?? [])
      : patients.filter((p) => !term || p.name.toLowerCase().includes(term.toLowerCase()));
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [newPatientProfession, setNewPatientProfession] = useState('');
  const [administrative, setAdministrative] = useState(administrativeValues());
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const resetForm = () => {
    setIsNewPatient(false); setSelectedPatientId(''); setSearch(''); setNewPatientName('');
    setNewPatientAge(''); setDateOfBirth(''); setNewPatientProfession('');setAdministrative(administrativeValues());
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
          ...administrative,
          cpf: normalizeCpf(administrative.cpf) || undefined,
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
  const registrationError=validatePatientRegistration({name:newPatientName,age:dateOfBirth?ageFromBirthdate(dateOfBirth,clinicDate()):newPatientAge===''?null:Number(newPatientAge),profession:newPatientProfession,...administrative});
  const selectedIsVisible = !!selectedPatientId && visiblePatients.some((p) => p.id === selectedPatientId);
  const isValid = !!chiefComplaint.trim() && (isNewPatient ? !registrationError && (dateOfBirth ? ageFromBirthdate(dateOfBirth, clinicDate()) !== null : validAge) : selectedIsVisible);
  const canClose = useUnsavedChanges(open && (!!chiefComplaint.trim() || !!newPatientName.trim() || !!dateOfBirth || !!newPatientAge || Object.values(administrative).some(Boolean) || !!newPatientProfession));
  const close = (next: boolean) => {
    if (saving) return;
    if (!canClose(next)) return;
    if (!next) resetForm();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Nova Consulta</DialogTitle>
          <DialogDescription className="sr-only">Selecione ou cadastre um paciente e informe a queixa principal para iniciar.</DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-5 mt-2 [&_input]:h-11 [&_input]:min-w-0 [&_select]:h-11 [&_label]:block [&_label]:leading-snug" aria-busy={saving}>
          {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
          <fieldset disabled={saving} className="space-y-5">
          {/* Patient Selection Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={!isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(false)}
              className="min-w-0 flex-1 h-auto min-h-11 whitespace-normal py-2"
            >
              Paciente Existente
            </Button>
            <Button
              type="button"
              variant={isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(true)}
              className="min-w-0 flex-1 h-auto min-h-11 whitespace-normal py-2"
            >
              Novo Paciente
            </Button>
          </div>

          {!isNewPatient ? (
            <div className="space-y-2">
              <Label htmlFor="patient-search">Buscar paciente</Label>
              <Input
                id="patient-search"
                value={search}
                onChange={(e) => {
                  // A new search hides the earlier choice, so drop it: the consultation
                  // must never start for a patient the doctor cannot see on screen.
                  setSearch(e.target.value);
                  setSelectedPatientId('');
                }}
                placeholder="Digite o nome (mín. 2 letras)"
                autoComplete="off"
              />
              <div role="listbox" aria-label="Pacientes" className="max-h-56 overflow-y-auto rounded-md border divide-y">
                {searchResults.isError && term.length >= 2 ? (
                  <p role="alert" className="p-3 text-sm text-destructive">
                    Não foi possível buscar.{' '}
                    <button type="button" className="underline" onClick={() => searchResults.refetch()}>
                      Tentar novamente
                    </button>
                  </p>
                ) : searchResults.isFetching && term.length >= 2 && !searchResults.data ? (
                  <p role="status" className="p-3 text-sm text-muted-foreground">Buscando…</p>
                ) : visiblePatients.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {term ? 'Nenhum paciente encontrado. Use "Novo Paciente" para cadastrar.' : 'Nenhum paciente cadastrado.'}
                  </p>
                ) : (
                  visiblePatients.map((patient) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedPatientId === patient.id}
                      key={patient.id}
                      onClick={() => setSelectedPatientId(patient.id)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60',
                        selectedPatientId === patient.id && 'bg-primary/10 font-medium',
                      )}
                    >
                      {patient.name}
                      <span className="text-muted-foreground">
                        {' · '}
                        {patient.age === null ? 'Idade não informada' : `${patient.age} anos`}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {!term && patients.length >= 100 && (
                <p className="text-xs text-muted-foreground">Mostrando os primeiros 100. Digite o nome para buscar os demais.</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="new-patient-name">Nome do Paciente *</Label>
                  <Input
                    id="new-patient-name"
                    value={newPatientName}
                    onChange={(e) => setNewPatientName(e.target.value)}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="new-patient-birth-date">Data de nascimento (opcional)</Label>
                  <Input id="new-patient-birth-date" type="date" max={clinicDate()} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
                </div>
                <div className="min-w-0 space-y-2">
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
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="new-patient-profession">Profissão</Label>
                  <Input
                    id="new-patient-profession"
                    value={newPatientProfession}
                    onChange={(e) => setNewPatientProfession(e.target.value)}
                    placeholder="Ex: Engenheiro"
                  />
                </div>
              </div>
              <PatientAdministrativeFields prefix="new-patient" value={administrative} onChange={patch=>setAdministrative(previous=>({...previous,...patch}))} />
              {registrationError && newPatientName && <p role="alert" className="text-sm text-destructive">{registrationError}</p>}
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

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => close(false)} className="w-full sm:w-auto">
              Cancelar
            </Button>
            <Button type="submit" variant="medical" disabled={!isValid || saving} className="w-full sm:w-auto">
              {saving ? 'Iniciando…' : 'Iniciar Consulta'}
            </Button>
          </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
