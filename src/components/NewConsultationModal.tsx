import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
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
import { dialogLayout } from '@/lib/dialogLayout';
import { focusField } from '@/lib/focusField';
import { Patient } from '@/types/patient';
import { PatientAdministrativeFields } from '@/components/PatientAdministrativeFields';
import { patientRegistrationErrors, normalizeCpf, administrativeValues, administrativeFieldId } from '@/lib/patientRegistration';

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

const FIELD = {
  search: 'patient-search',
  name: 'new-patient-name',
  birthDate: 'new-patient-birth-date',
  age: 'new-patient-age',
  profession: 'new-patient-profession',
  complaint: 'chief-complaint',
} as const;

/** aria wiring for a field and the message rendered under it. */
const described = (id: string, error?: string) =>
  error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return <p id={`${id}-error`} className="text-sm text-destructive">{children}</p>;
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
  const [moreOpen, setMoreOpen] = useState(false);
  // Messages appear only after the first try to start, then follow the corrections.
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submitErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (submitError) submitErrorRef.current?.focus(); }, [submitError]);

  const resetForm = () => {
    setIsNewPatient(false); setSelectedPatientId(''); setSearch(''); setNewPatientName('');
    setNewPatientAge(''); setDateOfBirth(''); setNewPatientProfession(''); setAdministrative(administrativeValues());
    setChiefComplaint(''); setSubmitError(''); setAttempted(false); setMoreOpen(false);
  };

  const birthAge = dateOfBirth ? ageFromBirthdate(dateOfBirth, clinicDate()) : null;
  const registration = patientRegistrationErrors({
    name: newPatientName,
    age: dateOfBirth ? birthAge : newPatientAge === '' ? null : Number(newPatientAge),
    profession: newPatientProfession,
    ...administrative,
  });
  const selectedIsVisible = !!selectedPatientId && visiblePatients.some((p) => p.id === selectedPatientId);
  // In the order of the form, so the first one gets the focus.
  const problems: { id: string; message: string; optional?: boolean }[] = [];
  if (isNewPatient) {
    if (registration.name) problems.push({ id: FIELD.name, message: registration.name });
  } else if (!selectedIsVisible) {
    problems.push({ id: FIELD.search, message: 'Selecione um paciente na lista.' });
  }
  if (!chiefComplaint.trim()) problems.push({ id: FIELD.complaint, message: 'Descreva a queixa principal.' });
  if (isNewPatient) {
    if (dateOfBirth && birthAge === null) problems.push({ id: FIELD.birthDate, message: 'Informe uma data de nascimento válida, que não seja futura.', optional: true });
    if (registration.age) problems.push({ id: FIELD.age, message: registration.age, optional: true });
    if (registration.profession) problems.push({ id: FIELD.profession, message: registration.profession, optional: true });
    for (const key of ['phone', 'email', 'cpf', 'healthInsurance', 'sex'] as const) {
      if (registration[key]) problems.push({ id: administrativeFieldId('new-patient', key), message: registration[key]!, optional: true });
    }
  }
  const shown = (id: string) => (attempted ? problems.find((problem) => problem.id === id)?.message : undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (problems.length) {
      const first = problems[0];
      flushSync(() => {
        setAttempted(true);
        if (first.optional) setMoreOpen(true);
      });
      focusField(first.id);
      return;
    }
    setSaving(true);
    setSubmitError('');
    try {
      if (isNewPatient) {
        await onStartConsultation(null, {
          name: newPatientName.trim(),
          age: dateOfBirth ? birthAge : newPatientAge === '' ? null : Number(newPatientAge),
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
      setSubmitError('Não foi possível iniciar o atendimento. Seus dados foram mantidos; tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  const canClose = useUnsavedChanges(open && (!!chiefComplaint.trim() || !!newPatientName.trim() || !!dateOfBirth || !!newPatientAge || Object.values(administrative).some(Boolean) || !!newPatientProfession));
  const close = (next: boolean) => {
    if (saving) return;
    if (!canClose(next)) return;
    if (!next) resetForm();
    onOpenChange(next);
  };
  const chooseMode = (newPatient: boolean) => {
    setIsNewPatient(newPatient);
    setAttempted(false);
  };
  const moreErrors = attempted && problems.some((problem) => problem.optional);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle className="text-foreground">Iniciar atendimento</DialogTitle>
          <DialogDescription className="sr-only">Escolha ou cadastre o paciente e informe a queixa principal para começar.</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
          <div className={cn(dialogLayout.body, '[&_input]:h-11 [&_input]:min-w-0 [&_select]:h-11 [&_label]:block [&_label]:leading-snug')}>
          <fieldset disabled={saving} className="min-w-0 space-y-5">
          <div className="flex gap-2" role="group" aria-label="Paciente">
            <Button
              type="button"
              variant={!isNewPatient ? 'default' : 'outline'}
              size="sm"
              aria-pressed={!isNewPatient}
              onClick={() => chooseMode(false)}
              className="min-w-0 flex-1 h-auto min-h-11 whitespace-normal py-2"
            >
              Paciente existente
            </Button>
            <Button
              type="button"
              variant={isNewPatient ? 'default' : 'outline'}
              size="sm"
              aria-pressed={isNewPatient}
              onClick={() => chooseMode(true)}
              className="min-w-0 flex-1 h-auto min-h-11 whitespace-normal py-2"
            >
              Novo paciente
            </Button>
          </div>

          {!isNewPatient ? (
            <div className="space-y-2">
              <Label htmlFor={FIELD.search}>Buscar paciente</Label>
              <Input
                id={FIELD.search}
                value={search}
                onChange={(e) => {
                  // A new search hides the earlier choice, so drop it: the consultation
                  // must never start for a patient the doctor cannot see on screen.
                  setSearch(e.target.value);
                  setSelectedPatientId('');
                }}
                placeholder="Digite o nome (mín. 2 letras)"
                autoComplete="off"
                {...described(FIELD.search, shown(FIELD.search))}
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
                    {term ? 'Nenhum paciente encontrado. Use "Novo paciente" para cadastrar.' : 'Nenhum paciente cadastrado.'}
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
              <FieldError id={FIELD.search}>{shown(FIELD.search)}</FieldError>
              {!term && patients.length >= 100 && (
                <p className="text-xs text-muted-foreground">Mostrando os primeiros 100. Digite o nome para buscar os demais.</p>
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-2">
              <Label htmlFor={FIELD.name}>Nome</Label>
              <Input
                id={FIELD.name}
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                placeholder="Nome completo"
                autoComplete="off"
                {...described(FIELD.name, shown(FIELD.name))}
              />
              <FieldError id={FIELD.name}>{shown(FIELD.name)}</FieldError>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={FIELD.complaint}>Queixa principal</Label>
            <Textarea
              id={FIELD.complaint}
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Descreva o motivo da consulta"
              className="min-h-[100px] resize-none"
              {...described(FIELD.complaint, shown(FIELD.complaint))}
            />
            <FieldError id={FIELD.complaint}>{shown(FIELD.complaint)}</FieldError>
          </div>

          {isNewPatient && (
            <div className="rounded-lg border">
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls="new-patient-more"
                onClick={() => setMoreOpen((value) => !value)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
              >
                <span>
                  Mais dados (opcional)
                  {moreErrors && !moreOpen && <span className="ml-2 font-normal text-destructive">Revise os dados</span>}
                </span>
                <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 transition-transform', moreOpen && 'rotate-180')} />
              </button>
              {moreOpen && (
                <div id="new-patient-more" className="space-y-4 border-t px-3 pb-4 pt-3">
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor={FIELD.birthDate}>Data de nascimento (opcional)</Label>
                      <Input id={FIELD.birthDate} type="date" max={clinicDate()} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} {...described(FIELD.birthDate, shown(FIELD.birthDate))} />
                      <FieldError id={FIELD.birthDate}>{shown(FIELD.birthDate)}</FieldError>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor={FIELD.age}>Idade (opcional)</Label>
                      <Input
                        id={FIELD.age}
                        type="number"
                        min={0}
                        max={130}
                        step={1}
                        disabled={!!dateOfBirth}
                        value={newPatientAge}
                        onChange={(e) => setNewPatientAge(e.target.value)}
                        placeholder="Ex: 35"
                        {...described(FIELD.age, shown(FIELD.age))}
                      />
                      <FieldError id={FIELD.age}>{shown(FIELD.age)}</FieldError>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor={FIELD.profession}>Profissão (opcional)</Label>
                      <Input
                        id={FIELD.profession}
                        value={newPatientProfession}
                        onChange={(e) => setNewPatientProfession(e.target.value)}
                        placeholder="Ex: Engenheira"
                        {...described(FIELD.profession, shown(FIELD.profession))}
                      />
                      <FieldError id={FIELD.profession}>{shown(FIELD.profession)}</FieldError>
                    </div>
                  </div>
                  <PatientAdministrativeFields
                    prefix="new-patient"
                    value={administrative}
                    onChange={patch=>setAdministrative(previous=>({...previous,...patch}))}
                    errors={attempted ? registration : {}}
                  />
                </div>
              )}
            </div>
          )}
          </fieldset>
          </div>

          <div className={dialogLayout.footer}>
            {submitError && <p ref={submitErrorRef} role="alert" tabIndex={-1} className={dialogLayout.error}>{submitError}</p>}
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving} className={dialogLayout.button}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className={dialogLayout.button}>
                {saving ? 'Iniciando…' : 'Iniciar atendimento'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
