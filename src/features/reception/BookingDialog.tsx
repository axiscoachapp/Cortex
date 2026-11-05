import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { clinicTimestamp, clinicDay, clinicDateLabel } from './dates';
import { ReceptionNotice } from './ReceptionNotice';
import { ContactSearch } from './ContactSearch';
import { useRequestId } from './useRequestId';
import type { ContactOption } from './NewCaseDialog';
import type { BookingDetails, ReceptionCase, PatientOption } from './contracts';
import { relationshipLabels } from './linkRelationships';

export function BookingDialog({
  receptionCase,
  onClose,
  day: initialDay,
}: {
  receptionCase?: ReceptionCase;
  onClose: () => void;
  day?: string;
}) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const { toast } = useToast();
  const field = useId();
  const request = useRequestId();
  const [contact, setContact] = useState<ContactOption | null>(
    receptionCase ? { id: receptionCase.contactId, name: receptionCase.contactName, phone: receptionCase.phone } : null,
  );
  const [doctor, setDoctor] = useState(
    receptionCase?.doctorId ?? (access?.doctors.length === 1 ? access.doctors[0].id : ''),
  );
  const [day, setDay] = useState(initialDay ?? clinicDay(new Date().toISOString()));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('09:30');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [relationship, setRelationship] = useState<'self' | 'guardian' | 'family' | 'other'>('self');
  const [relationshipLocked, setRelationshipLocked] = useState(false);
  const [type, setType] = useState<BookingDetails['type']>('retorno');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  const reviewEpoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const working = busy || recovering;
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedChanges(
    touched || working,
    'Há um agendamento não confirmado. Deseja sair e descartar o preenchimento?',
    { blocking: working },
  );
  const snapshot = useQuery({
    queryKey: ['reception', access?.actorId, 'contact', contact?.id],
    queryFn: async () => {
      const value = await receptionApi.contact(contact!.id);
      if (value.id !== contact!.id || value.clinicId !== access?.clinic?.id)
        throw new Error('O contato não corresponde à clínica selecionada. Atualize a página.');
      return value;
    },
    enabled: !!contact,
    retry: false,
  });
  const patients = useQuery({
    queryKey: ['reception', access?.actorId, 'patient-search', doctor, search],
    queryFn: () => receptionApi.patients(access!.clinic!.id, doctor, search),
    enabled: !!doctor && search.trim().length >= 2 && mode === 'existing',
    retry: false,
  });
  function edited() {
    setTouched(true);
    setConfirmed(false);
  }
  const currentLink = snapshot.data?.beneficiaries.find(p => p.id === patient?.id && p.doctorId === doctor);
  const selectionDiffers = (link: typeof currentLink) => (relationshipLocked && !link) || (!!link && (
    link.relationship !== relationship || link.name !== patient?.name || link.dateOfBirth !== patient?.dateOfBirth
  ));
  const linkNeedsReview = mode === 'existing' && !!patient && (recoveryRequired || snapshot.isError || (!!snapshot.data && selectionDiffers(currentLink)));
  useLayoutEffect(() => {
    if (linkNeedsReview) { reviewEpoch.current += 1; setConfirmed(false); }
  }, [linkNeedsReview]);
  async function recoverLink() {
    if (pending.current || working || mode !== 'existing' || !patient || !contact || !doctor) return;
    pending.current = true; setRecovering(true); setRecoveryRequired(true); setConfirmed(false); setError(null);
    try {
      const result = await snapshot.refetch();
      if (!mounted.current) return;
      if (result.error) return;
      const link = result.data?.beneficiaries.find(p => p.id === patient.id && p.doctorId === doctor);
      if (!link) throw new Error('O vínculo selecionado não está disponível. Confira o cadastro com a administração antes de reservar.');
      setPatient(link); setRelationship(link.relationship); setRelationshipLocked(true); setRecoveryRequired(false);
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { pending.current = false; if (mounted.current) setRecovering(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || working || linkNeedsReview || !confirmed || !contact || !doctor || !access?.clinic || !snapshot.data || snapshot.isFetching || snapshot.isError) return;
    pending.current = true;
    const confirmedEpoch = reviewEpoch.current;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'existing' && !patient) throw new Error('Selecione e confirme o paciente que será atendido.');
      const details: BookingDetails = {
        doctorId: doctor,
        contactId: contact.id,
        patientId: mode === 'existing' ? patient!.id : null,
        caseId: receptionCase?.id ?? null,
        startTime: clinicTimestamp(day, start),
        endTime: clinicTimestamp(day, end),
        type,
      };
      if (mode === 'new')
        Object.assign(details, { beneficiaryName: name.trim(), dateOfBirth: birth || null, relationship });
      if (new Date(details.endTime) <= new Date(details.startTime))
        throw new Error('O término deve ser depois do início.');
      if (mode === 'existing') {
        await receptionApi.linkPatient(contact.id, doctor, patient!.id, relationship);
        if (!mounted.current) return;
        const contactKey = ['reception', access.actorId, 'contact', contact.id];
        await client.cancelQueries({ queryKey: contactKey, exact: true });
        if (!mounted.current) return;
        const latest = client.getQueryData<NonNullable<typeof snapshot.data>>(contactKey);
        const latestLink = latest?.beneficiaries.find(p => p.id === patient!.id && p.doctorId === doctor);
        if (reviewEpoch.current !== confirmedEpoch || !latest || client.getQueryState(contactKey)?.status === 'error' || selectionDiffers(latestLink)) {
          setRelationshipLocked(true); setRecoveryRequired(true); setConfirmed(false);
          throw new Error('O vínculo selecionado mudou ou ficou indisponível durante a confirmação. Recupere o vínculo antes de reservar.');
        }
        client.setQueryData<NonNullable<typeof snapshot.data>>(
          contactKey,
          (current) => current && ({
            ...current,
            beneficiaries: [
              ...current.beneficiaries.filter((p) => p.id !== patient!.id || p.doctorId !== doctor),
              { ...patient!, doctorId: doctor, relationship },
            ],
          }),
        );
        // Publish the confirmed link before locking a previously unlinked selection.
        // The link remains confirmed even if the following slot reservation fails.
        setRelationshipLocked(true);
      }
      if (!mounted.current) return;
      await receptionApi.book(access.clinic.id, details, request(details));
      if (!mounted.current) return;
      await client.invalidateQueries({ queryKey: ['reception'] });
      await client.invalidateQueries({ queryKey: ['appointments'] });
      if (!mounted.current) return;
      toast({ title: 'Agendamento confirmado', description: 'O horário foi reservado na agenda do médico.' });
      onClose();
    } catch (err) {
      if (mounted.current) setError(err);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const selectPatient = (value: typeof patient) => {
    if (value && (!snapshot.data || snapshot.isFetching || snapshot.isError)) return;
    const link = snapshot.data?.beneficiaries.find((p) => p.id === value?.id && p.doctorId === doctor);
    setPatient(value);
    setRelationship(link?.relationship ?? 'self');
    setRelationshipLocked(!!link);
    setRecoveryRequired(false);
    edited();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current && !working && guard(false)) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirmar agendamento</DialogTitle>
          <DialogDescription>
            Confira o paciente, a relação do contato e o horário antes de reservar.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          A reserva será feita após sua conferência. Todos os horários usam o fuso de São Paulo.
        </p>
        <ReceptionNotice error={error} />
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={working} className="space-y-4">
            {!contact ? (
              <ContactSearch
                onSelect={(value) => {
                  setContact(value);
                  edited();
                }}
              />
            ) : (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Contato: {contact.name}</p>
                <p className="text-xs text-muted-foreground break-words">{contact.phone || 'Sem telefone'}</p>
              </div>
            )}
            <div>
              <Label htmlFor={field + 'doctor'}>Médico da consulta</Label>
              <select
                id={field + 'doctor'}
                required
                disabled={!!receptionCase?.doctorId}
                className="block w-full border rounded-md p-2 text-sm bg-background"
                value={doctor}
                onChange={(e) => {
                  setDoctor(e.target.value);
                  selectPatient(null);
                  setSearch('');
                  edited();
                }}
              >
                <option value="">Selecione o médico</option>
                {access?.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {receptionCase?.doctorId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Para trocar de médico, encaminhe o atendimento na fila antes de agendar.
                </p>
              )}
            </div>
            {contact && doctor && (
              <>
                <ReceptionNotice
                  loading={snapshot.isFetching}
                  error={snapshot.error}
                  onRetry={() => void snapshot.refetch()}
                />
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="text-sm font-medium mb-2">Quem será atendido?</legend>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      name={field + 'mode'}
                      type="radio"
                      checked={mode === 'existing'}
                      onChange={() => {
                        setMode('existing');
                        selectPatient(null);
                        edited();
                      }}
                    />
                    Paciente já cadastrado com este médico
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      name={field + 'mode'}
                      type="radio"
                      checked={mode === 'new'}
                      onChange={() => {
                        setMode('new');
                        selectPatient(null);
                        setType('novo');
                        edited();
                      }}
                    />
                    Primeiro cadastro com este médico
                  </label>
                </fieldset>
                {mode === 'existing' ? (
                  <div className="space-y-2">
                    {snapshot.data?.beneficiaries
                      .filter((p) => p.doctorId === doctor)
                      .map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          aria-pressed={patient?.id === p.id}
                          disabled={snapshot.isFetching || snapshot.isError}
                          onClick={() => selectPatient(p)}
                          className={`block text-left rounded-lg border p-3 w-full text-sm ${patient?.id === p.id ? 'border-primary bg-primary/5' : ''}`}
                        >
                          {p.name}
                          {p.dateOfBirth && (
                            <span className="block text-xs text-muted-foreground">
                              Nascimento: {p.dateOfBirth.split('-').reverse().join('/')}
                            </span>
                          )}
                        </button>
                      ))}
                    <Label htmlFor={field + 'search'}>Buscar outro paciente na agenda deste médico</Label>
                    <Input
                      id={field + 'search'}
                      value={search}
                      maxLength={200}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <ReceptionNotice
                      loading={patients.isFetching}
                      error={patients.error}
                      onRetry={() => void patients.refetch()}
                    />
                    {patients.data?.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={patient?.id === p.id}
                        disabled={!snapshot.data || snapshot.isFetching || snapshot.isError}
                        className={`block text-left rounded-lg border p-3 w-full text-sm ${patient?.id === p.id ? 'border-primary bg-primary/5' : ''}`}
                        onClick={() => selectPatient(p)}
                      >
                        {p.name}
                        {p.dateOfBirth && (
                          <span className="block text-xs text-muted-foreground">
                            Nascimento: {p.dateOfBirth.split('-').reverse().join('/')}
                          </span>
                        )}
                      </button>
                    ))}
                    {patient && (
                      <p className="text-sm font-medium text-primary">Paciente selecionado: {patient.name}</p>
                    )}
                    {patients.data?.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhum paciente encontrado nesta busca.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={field + 'name'}>Nome do novo paciente</Label>
                      <Input
                        id={field + 'name'}
                        required
                        minLength={2}
                        maxLength={200}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          edited();
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor={field + 'birth'}>Nascimento (se conhecido)</Label>
                      <Input
                        id={field + 'birth'}
                        type="date"
                        max={clinicDay(new Date().toISOString())}
                        value={birth}
                        onChange={(e) => {
                          setBirth(e.target.value);
                          edited();
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground md:col-span-2">
                      O cadastro inicial ficará na lista privada deste médico. Nenhum histórico clínico será copiado de
                      outro profissional.
                    </p>
                  </div>
                )}
                <div>
                  <Label htmlFor={field + 'relationship'}>Relação do contato com o paciente</Label>
                  <select
                    id={field + 'relationship'}
                    disabled={relationshipLocked}
                    aria-describedby={relationshipLocked ? field + 'relationship-hint' : undefined}
                    className="block w-full border rounded-md p-2 text-sm bg-background"
                    value={relationship}
                    onChange={(e) => {
                      setRelationship(e.target.value as typeof relationship);
                      edited();
                    }}
                  >
                    {Object.entries(relationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {relationshipLocked && (
                    <p id={field + 'relationship-hint'} className="text-xs text-muted-foreground mt-1">
                      Relação já confirmada. Este agendamento preserva o vínculo registrado.
                    </p>
                  )}
                  {mode === 'existing' && patient && (relationshipLocked || currentLink) && <div className="mt-2 space-y-2">
                    {linkNeedsReview && <p role="status" className="text-sm">O vínculo selecionado mudou ou precisa de conferência. Recupere o vínculo e confirme novamente antes de reservar.</p>}
                    <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => void recoverLink()}>{recovering ? 'Recuperando vínculo…' : 'Recuperar vínculo selecionado'}</Button>
                  </div>}
                </div>
              </>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor={field + 'day'}>Data</Label>
                <Input
                  id={field + 'day'}
                  type="date"
                  required
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                    edited();
                  }}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={field + 'start'}>Início</Label>
                <Input
                  id={field + 'start'}
                  type="time"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    edited();
                  }}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={field + 'end'}>Término</Label>
                <Input
                  id={field + 'end'}
                  type="time"
                  required
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    edited();
                  }}
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor={field + 'type'}>Tipo</Label>
                <select
                  id={field + 'type'}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as typeof type);
                    edited();
                  }}
                  className="block w-full rounded-md border bg-background p-2 text-sm"
                >
                  <option value="novo">Primeira consulta</option>
                  <option value="retorno">Retorno</option>
                  <option value="seguimento">Seguimento</option>
                  <option value="urgencia">Encaixe avaliado pela equipe</option>
                </select>
              </div>
            </div>
            <div className="rounded-lg border bg-primary/5 p-3 text-xs space-y-2">
              <p>
                {access?.doctors.find((d) => d.id === doctor)?.name ?? 'Médico a selecionar'} ·{' '}
                {day ? clinicDateLabel(day + 'T12:00:00Z') : 'Data a selecionar'} · {start}–{end}
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  disabled={linkNeedsReview || snapshot.isFetching || snapshot.isError}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 accent-primary"
                />
                Conferi o paciente, a relação do contato e o horário. Confirmo a reserva.
              </label>
            </div>
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => {
                if (guard(false)) onClose();
              }}
            >
              Voltar
            </Button>
            <Button
              type="submit"
              disabled={
                working || linkNeedsReview || !confirmed || !contact || !doctor || !snapshot.data || snapshot.isFetching || snapshot.isError || (mode === 'existing' && !patient)
              }
            >
              {busy ? 'Confirmando…' : 'Confirmar agendamento'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
