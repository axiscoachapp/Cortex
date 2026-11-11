import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useSessionPaused } from '@/contexts/SessionVisibility';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { clinicTimestamp, clinicDay, nextClinicDay } from './dates';
import { ReceptionNotice } from './ReceptionNotice';
import { ContactSearch } from './ContactSearch';
import { useRequestId } from './useRequestId';
import type { ContactOption } from './NewCaseDialog';
import type { BookingDetails, ReceptionCase, PatientOption } from './contracts';
import { relationshipLabels } from './linkRelationships';
import { addMinutes, bookingSummary, dayHeading, freeSlots, minutesBetween, occupiedIntervals, typeMinutes } from './agendaTime';
import { DayAgenda } from './DayAgenda';
import { FormError } from './FormError';
import { dialogLayout } from './dialogLayout';

const CONFLICT = 'Este horário já está ocupado na agenda do médico, por uma consulta ou um compromisso particular. Escolha outro horário.';

function dayWindow(day: string) {
  try { return { start: clinicTimestamp(day, '00:00'), end: clinicTimestamp(nextClinicDay(day), '00:00') }; } catch { return null; }
}
function slotInterval(day: string, start: string, end: string) {
  try {
    const startTime = clinicTimestamp(day, start), endTime = clinicTimestamp(day, end);
    return Date.parse(endTime) > Date.parse(startTime) ? { startTime, endTime } : null;
  } catch { return null; }
}

export function BookingDialog({
  receptionCase,
  onClose,
  day: initialDay,
  doctor: initialDoctor,
  start: initialStart,
  paused: casePaused = false,
}: {
  receptionCase?: ReceptionCase;
  onClose: () => void;
  day?: string;
  doctor?: string;
  // A free time chosen in the agenda ("Agendar neste horário").
  start?: string;
  // The bound case's last refetch failed: keep the form, wait to confirm.
  paused?: boolean;
}) {
  const sessionPaused = useSessionPaused();
  const paused = casePaused || sessionPaused;
  const access = useClinicAccess();
  const client = useQueryClient();
  const { toast } = useToast();
  const field = useId();
  const request = useRequestId();
  const [contact, setContact] = useState<ContactOption | null>(
    receptionCase ? { id: receptionCase.contactId, name: receptionCase.contactName, phone: receptionCase.phone } : null,
  );
  const [doctor, setDoctor] = useState(
    receptionCase?.doctorId ?? (initialDoctor && access?.doctors.some(d => d.id === initialDoctor) ? initialDoctor : access?.doctors.length === 1 ? access.doctors[0].id : ''),
  );
  const [day, setDay] = useState(initialDay ?? clinicDay(new Date().toISOString()));
  const [type, setType] = useState<BookingDetails['type']>('retorno');
  const [typeChosen, setTypeChosen] = useState(false);
  const [start, setStart] = useState(initialStart ?? '09:00');
  const [end, setEnd] = useState(() => addMinutes(initialStart ?? '09:00', typeMinutes.retorno) ?? '09:30');
  // auto: follow the next free slot; chip: a chosen slot; manual: typed under "Outro horário".
  const [timeSource, setTimeSource] = useState<'auto' | 'chip' | 'manual'>(initialStart ? 'chip' : 'auto');
  const [manualOpen, setManualOpen] = useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [modeChosen, setModeChosen] = useState(false);
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [name, setName] = useState('');
  const [nameFromContact, setNameFromContact] = useState(false);
  const [birth, setBirth] = useState('');
  const [relationship, setRelationship] = useState<'self' | 'guardian' | 'family' | 'other'>('self');
  const [relationshipLocked, setRelationshipLocked] = useState(false);
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
  // The chosen doctor's day: what the agenda shows plus the doctor's own busy periods.
  const range = day ? dayWindow(day) : null;
  const agenda = useQuery({
    queryKey: ['reception', access?.actorId, 'calendar', access?.clinic?.id, day, 'day', doctor],
    queryFn: () => receptionApi.appointments(access!.clinic!.id, range!.start, range!.end, doctor),
    enabled: !!access?.clinic && !!doctor && !!range,
    retry: false,
  });
  const busyDay = useQuery({
    queryKey: ['reception', access?.actorId, 'busy', access?.clinic?.id, day, 'day', doctor],
    queryFn: () => receptionApi.busyIntervals(access!.clinic!.id, range!.start, range!.end, doctor),
    enabled: !!access?.clinic && !!doctor && !!range,
    retry: false,
  });
  const dayReady = !!agenda.data && !busyDay.isPending;
  const occupied = dayReady ? occupiedIntervals(agenda.data!.items, agenda.data!.blocks, busyDay.data ?? [], doctor) : [];
  const duration = typeMinutes[type];
  const slots = dayReady && range ? freeSlots(day, occupied, duration) : [];
  const slotKey = slots.join(',');
  useEffect(() => {
    if (timeSource !== 'auto' || !dayReady) return;
    if (slots.length) {
      setStart(slots[0]);
      setEnd(addMinutes(slots[0], duration) ?? slots[0]);
    } else setManualOpen(true);
    // slotKey stands for slots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSource, dayReady, slotKey, duration]);
  const interval = day ? slotInterval(day, start, end) : null;
  const clash = !!interval && occupied.some(x => x.start < Date.parse(interval.endTime) && x.end > Date.parse(interval.startTime));

  function edited() {
    setTouched(true);
  }
  const doctorLinks = snapshot.data?.beneficiaries.filter(p => p.doctorId === doctor) ?? [];
  // A contact with nobody registered for this doctor starts at "Primeiro cadastro".
  // Decided once per contact and doctor: a later refetch never switches the form under the user.
  const autoModeFor = useRef('');
  useEffect(() => {
    if (modeChosen || !snapshot.data || snapshot.isFetching || !doctor || patient) return;
    if (autoModeFor.current === snapshot.data.id + ':' + doctor) return;
    autoModeFor.current = snapshot.data.id + ':' + doctor;
    const next = doctorLinks.length ? 'existing' : 'new';
    setMode(next);
    if (next === 'new' && !typeChosen) setType('novo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeChosen, snapshot.data, snapshot.isFetching, doctor]);
  // "É o próprio paciente": the patient's name is the contact's, until someone types another.
  useEffect(() => {
    if (mode !== 'new' || !contact) return;
    if (relationship === 'self' && (!name || nameFromContact)) { setName(contact.name); setNameFromContact(true); }
    if (relationship !== 'self' && nameFromContact) { setName(''); setNameFromContact(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, relationship, contact?.id]);

  const currentLink = snapshot.data?.beneficiaries.find(p => p.id === patient?.id && p.doctorId === doctor);
  const selectionDiffers = (link: typeof currentLink) => (relationshipLocked && !link) || (!!link && (
    link.relationship !== relationship || link.name !== patient?.name || link.dateOfBirth !== patient?.dateOfBirth
  ));
  const linkNeedsReview = mode === 'existing' && !!patient && (recoveryRequired || snapshot.isError || (!!snapshot.data && selectionDiffers(currentLink)));
  useLayoutEffect(() => {
    if (linkNeedsReview) reviewEpoch.current += 1;
  }, [linkNeedsReview]);
  async function recoverLink() {
    if (pending.current || working || mode !== 'existing' || !patient || !contact || !doctor) return;
    pending.current = true; setRecovering(true); setRecoveryRequired(true); setError(null);
    try {
      const result = await snapshot.refetch();
      if (!mounted.current) return;
      if (result.error) return;
      const link = result.data?.beneficiaries.find(p => p.id === patient.id && p.doctorId === doctor);
      if (!link) throw new Error('Este paciente não está mais ligado ao contato. Confira o cadastro com a administração antes de agendar.');
      setPatient(link); setRelationship(link.relationship); setRelationshipLocked(true); setRecoveryRequired(false);
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { pending.current = false; if (mounted.current) setRecovering(false); }
  }
  const nameMissing = mode === 'new' && name.trim().length < 2;
  const blocked = working || paused || linkNeedsReview || !contact || !doctor || !snapshot.data || snapshot.isFetching || snapshot.isError
    || (mode === 'existing' && !patient) || nameMissing || !interval;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || blocked || !contact || !access?.clinic || !snapshot.data) return;
    pending.current = true;
    const confirmedEpoch = reviewEpoch.current;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'existing' && !patient) throw new Error('Selecione o paciente que será atendido.');
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
          setRelationshipLocked(true); setRecoveryRequired(true);
          throw new Error('A relação registrada mudou durante o agendamento. Use a relação registrada e agende de novo.');
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
      if (!mounted.current) return;
      setError(err);
      // A conflict means the day changed: show it as it is now.
      if ((err as { code?: string })?.code === '23P01') { void agenda.refetch(); void busyDay.refetch(); }
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
  const chooseSlot = (value: string) => {
    setStart(value); setEnd(addMinutes(value, duration) ?? value); setTimeSource('chip'); edited();
  };
  const doctorName = access?.doctors.find((d) => d.id === doctor)?.name;
  const title = receptionCase ? 'Agendar consulta' : 'Novo agendamento';
  const errorText = (error as { code?: string } | null)?.code === '23P01' ? CONFLICT : undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current && !working && guard(false)) onClose();
      }}
    >
      <DialogContent className={`max-w-3xl ${dialogLayout.content}`}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Escolha o paciente e o horário.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <fieldset disabled={working} className={dialogLayout.body}>
            {!contact ? (
              <ContactSearch
                allowCreate={!receptionCase}
                onSelect={(value) => {
                  setContact(value);
                  edited();
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">Contato: {contact.name}</p>
                  <p className="text-xs text-muted-foreground break-words">{contact.phone || 'Sem telefone'}</p>
                </div>
                {!receptionCase && <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => {
                  setContact(null); selectPatient(null); setModeChosen(false); setName(''); setNameFromContact(false);
                }}>Trocar contato</Button>}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <Label htmlFor={field + 'doctor'}>Médico da consulta</Label>
                <select
                  id={field + 'doctor'}
                  required
                  disabled={!!receptionCase?.doctorId}
                  className="block min-h-11 w-full border rounded-md p-2 text-sm bg-background"
                  value={doctor}
                  onChange={(e) => {
                    setDoctor(e.target.value);
                    selectPatient(null);
                    setSearch('');
                    setModeChosen(false);
                    if (timeSource === 'chip') setTimeSource('auto');
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
              <div className="min-w-0">
                <Label htmlFor={field + 'day'}>Data</Label>
                <Input
                  id={field + 'day'}
                  type="date"
                  required
                  className="h-11"
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                    if (timeSource === 'chip') setTimeSource('auto');
                    edited();
                  }}
                />
              </div>
            </div>
            {contact && doctor && (
              <>
                <ReceptionNotice
                  loading={snapshot.isFetching}
                  error={snapshot.error}
                  onRetry={() => void snapshot.refetch()}
                />
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="text-sm font-medium mb-1">Quem será atendido?</legend>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      name={field + 'mode'}
                      type="radio"
                      checked={mode === 'existing'}
                      onChange={() => {
                        setMode('existing');
                        setModeChosen(true);
                        selectPatient(null);
                        edited();
                      }}
                    />
                    Paciente já cadastrado com este médico
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      name={field + 'mode'}
                      type="radio"
                      checked={mode === 'new'}
                      onChange={() => {
                        setMode('new');
                        setModeChosen(true);
                        selectPatient(null);
                        if (!typeChosen) setType('novo');
                        edited();
                      }}
                    />
                    Primeiro cadastro com este médico
                  </label>
                </fieldset>
                {mode === 'existing' ? (
                  <div className="space-y-2">
                    {doctorLinks.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          aria-pressed={patient?.id === p.id}
                          disabled={snapshot.isFetching || snapshot.isError}
                          onClick={() => selectPatient(p)}
                          className={`block min-h-11 text-left rounded-lg border p-3 w-full text-sm ${patient?.id === p.id ? 'border-primary bg-primary/5' : ''}`}
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
                      className="h-11"
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
                        className={`block min-h-11 text-left rounded-lg border p-3 w-full text-sm ${patient?.id === p.id ? 'border-primary bg-primary/5' : ''}`}
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
                        className="h-11"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setNameFromContact(false);
                          edited();
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor={field + 'birth'}>Nascimento (se souber)</Label>
                      <Input
                        id={field + 'birth'}
                        type="date"
                        className="h-11"
                        max={clinicDay(new Date().toISOString())}
                        value={birth}
                        onChange={(e) => {
                          setBirth(e.target.value);
                          edited();
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground md:col-span-2">
                      O cadastro fica na lista deste médico. Nenhum histórico de outro profissional é copiado.
                    </p>
                  </div>
                )}
                <div>
                  <Label htmlFor={field + 'relationship'}>Relação do contato com o paciente</Label>
                  <select
                    id={field + 'relationship'}
                    disabled={relationshipLocked}
                    aria-describedby={relationshipLocked ? field + 'relationship-hint' : undefined}
                    className="block min-h-11 w-full border rounded-md p-2 text-sm bg-background"
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
                      Relação já registrada no cadastro.
                    </p>
                  )}
                  {mode === 'existing' && patient && (relationshipLocked || currentLink) && <div className="mt-2 space-y-2">
                    {linkNeedsReview && <p role="status" className="text-sm">A relação registrada mudou. Use a relação registrada e confira antes de agendar.</p>}
                    <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => void recoverLink()}>{recovering ? 'Conferindo a relação…' : 'Usar a relação registrada'}</Button>
                  </div>}
                </div>
              </>
            )}
            <div className="max-w-xs">
              <Label htmlFor={field + 'type'}>Tipo</Label>
              <select
                id={field + 'type'}
                value={type}
                onChange={(e) => {
                  const next = e.target.value as typeof type;
                  setType(next);
                  setTypeChosen(true);
                  if (timeSource === 'chip') setEnd(addMinutes(start, typeMinutes[next]) ?? end);
                  edited();
                }}
                className="block min-h-11 w-full rounded-md border bg-background p-2 text-sm"
              >
                <option value="novo">Primeira consulta</option>
                <option value="retorno">Retorno</option>
                <option value="seguimento">Seguimento</option>
                <option value="urgencia">Encaixe avaliado pela equipe</option>
              </select>
            </div>
            <section aria-label="Horário" className="space-y-3">
              <h3 className="text-sm font-medium">Horário</h3>
              {!doctor ? <p className="text-sm text-muted-foreground">Escolha o médico para ver os horários livres.</p>
                : !range ? <p className="text-sm text-muted-foreground">Informe uma data válida.</p>
                : agenda.isError ? <ReceptionNotice error={agenda.error} onRetry={() => void agenda.refetch()} />
                : !dayReady ? <ReceptionNotice loading />
                : <>
                  <p className="text-xs text-muted-foreground">{dayHeading(day)} · {doctorName} · horários livres para {duration} min</p>
                  {slots.length ? (
                    <div role="group" aria-label="Horários livres" className="flex flex-wrap gap-2">
                      {slots.map(slot => (
                        <Button key={slot} type="button" size="sm" className="min-h-11 min-w-[4.5rem] tabular-nums"
                          variant={timeSource !== 'manual' && start === slot ? 'default' : 'outline'}
                          aria-pressed={timeSource !== 'manual' && start === slot}
                          onClick={() => chooseSlot(slot)}>{slot}</Button>
                      ))}
                    </div>
                  ) : <p className="text-sm">Nenhum horário livre neste dia. Escolha outra data ou use outro horário.</p>}
                  {busyDay.isError && <p className="text-xs text-muted-foreground">Não foi possível conferir os compromissos particulares do médico. O horário é conferido ao agendar.</p>}
                  <details className="rounded-lg border p-2" open={agenda.data!.items.length + agenda.data!.blocks.length + (busyDay.data?.length ?? 0) <= 6 || undefined}>
                    <summary className="cursor-pointer select-none py-1 text-sm">O dia de {doctorName}</summary>
                    <div className="pt-2">
                      <DayAgenda day={day} doctor={doctor} items={agenda.data!.items} blocks={agenda.data!.blocks} busy={busyDay.data ?? []} emptyText="Nenhum compromisso neste dia." />
                    </div>
                  </details>
                </>}
              <div>
                <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" aria-expanded={manualOpen} onClick={() => setManualOpen(open => !open)}>
                  Outro horário
                </Button>
                {manualOpen && (
                  <div className="mt-2 grid max-w-md grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={field + 'start'}>Início</Label>
                      <Input
                        id={field + 'start'}
                        type="time"
                        required
                        className="h-11"
                        value={start}
                        onChange={(e) => {
                          const length = minutesBetween(start, end);
                          setStart(e.target.value);
                          const next = addMinutes(e.target.value, length > 0 ? length : duration);
                          if (next) setEnd(next);
                          setTimeSource('manual');
                          edited();
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor={field + 'end'}>Término</Label>
                      <Input
                        id={field + 'end'}
                        type="time"
                        required
                        className="h-11"
                        value={end}
                        aria-invalid={!interval}
                        onChange={(e) => {
                          setEnd(e.target.value);
                          setTimeSource('manual');
                          edited();
                        }}
                      />
                    </div>
                    {!interval && <p role="alert" className="col-span-2 text-sm text-destructive">O término deve ser depois do início, no mesmo dia.</p>}
                  </div>
                )}
                {clash && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Este horário cruza um compromisso já marcado. Confira antes de agendar.</p>}
              </div>
            </section>
          </fieldset>
          <div className={dialogLayout.footer}>
            <FormError error={error} message={errorText} />
            {paused && <p role="status" className="text-right text-xs text-muted-foreground">Verificando acesso… O preenchimento continua preservado.</p>}
            <div className={dialogLayout.actions}>
              <Button
                type="button"
                variant="outline"
                className={dialogLayout.button}
                disabled={working}
                onClick={() => {
                  if (guard(false)) onClose();
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" className={dialogLayout.button} disabled={blocked}>
                {busy ? 'Agendando…' : interval ? bookingSummary(day, start, doctorName) : 'Agendar'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
