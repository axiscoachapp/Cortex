import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import type { WorkEntry } from '@/lib/clinicalWorkspace';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { parseConversationPage, conversationMessages, mergeConversationMessages } from '@/lib/patientConversation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel, PreBriefing } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { NewConsultationModal } from '@/components/NewConsultationModal';
import { WelcomeDashboard } from '@/components/WelcomeDashboard';
import { AppSidebar, MobileBottomBar } from '@/components/AppNavigation';
import { DiscardChangesDialog } from '@/components/DiscardChangesDialog';
import { FullScreenLoader } from '@/components/FullScreenLoader';
import { cn } from '@/lib/utils';
import { Patient, ChatMessage } from '@/types/patient';
import { useToast } from '@/hooks/use-toast';
import { useSeedPatients } from '@/hooks/useSeedPatients';
import { mapPatientRow } from '@/lib/patientMapper';
import { clinicDate } from '@/lib/dates';
import { functionErrorBody } from '@/lib/functionErrors';
import { SHELL_BREAKPOINT } from '@/lib/interfaceScale';
import { useUnsavedChanges, useExitGuard, afterConfirmedSaveOrDiscard } from '@/hooks/useUnsavedChanges';

// Three-column consultation = Tailwind `shell` (real pixels, not scaled).
const DESKTOP_LAYOUT_QUERY = `(min-width: ${SHELL_BREAKPOINT}px)`;
const PATIENT_CHANGE_MESSAGE = 'Há trabalho não concluído neste paciente. Os rascunhos salvos continuam com ele; textos ainda não enviados serão descartados.';
const PatientWorkspaceDialog = lazy(() => import('@/components/PatientWorkspaceDialog').then(module => ({ default: module.PatientWorkspaceDialog })));

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedAppointmentId,setSelectedAppointmentId]=useState<string|null>(null);
  const [patientMessages, setPatientMessages] = useState<Record<string, ChatMessage[]>>({});
  const [patientComplaints, setPatientComplaints] = useState<Record<string, string>>({});
  const [chatBusy, setChatBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [patientLoading,setPatientLoading]=useState(false);
  const [recoveryRequest,setRecoveryRequest]=useState(0);
  const [patientWork, setPatientWork] = useState<{ actor: string; patientId: string; manual: boolean; entry?: WorkEntry; appointmentId?: string; initialTitle: string } | null>(null);
  const patientWorkExit = useRef<() => boolean>(() => true);
  const patientWorkTrigger = useRef<HTMLElement | null>(null);
  const hasWork = chatBusy || snapshotBusy || captureBusy;
  const selectedId = selectedPatient?.id ?? '';
  const conversation = useInfiniteQuery({
    queryKey: ['patient-conversation', user?.id, selectedId],
    enabled: !!user && !!selectedId,
    initialPageParam: null as string | null,
    queryFn: async ({pageParam}) => {
      const {data,error}=await supabase.rpc('list_patient_chat_turns',{p_patient_id:selectedId,p_before:pageParam,p_limit:50});
      if(error)throw error;
      return parseConversationPage(data);
    },
    getNextPageParam: page => page.length === 50 ? page[page.length-1].id : undefined,
    refetchOnMount: 'always',
    staleTime: 0,
    refetchInterval: query => query.state.data?.pages.some(page=>page.some(turn=>turn.status==='pending' && Date.now()-Date.parse(turn.updatedAt)<300_000)) ? 5000 : false,
  });
  const chatMessages = mergeConversationMessages(patientMessages[selectedId] ?? [],conversationMessages(conversation.data?.pages.flat() ?? []));
  const chiefComplaint = patientComplaints[selectedId] ?? '';
  const setChatMessages = useCallback((value: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    setPatientMessages(previous => ({ ...previous, [selectedId]: typeof value === 'function' ? value(previous[selectedId] ?? []) : value }));
  }, [selectedId]);
  const [showNewConsultationModal, setShowNewConsultationModal] = useState(false);
  const [preBriefing, setPreBriefing] = useState<PreBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(false);
  const [briefingRequested, setBriefingRequested] = useState(false);
  // Phone/tablet: the dashboard, or the consultation with its Consulta/Perfil switch.
  const [mobileView, setMobileView] = useState<'home' | 'chat' | 'info'>('home');
  const [discardAsk, setDiscardAsk] = useState<{ proceed: () => void; cancel?: () => void } | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && !window.matchMedia(DESKTOP_LAYOUT_QUERY).matches);
  const preBriefingCache = useRef<Map<string, PreBriefing | null>>(new Map());
  const briefingInFlight = useRef(new Set<string>());
  const selectedPatientIdRef = useRef<string | null>(null);
  const selectedRevisionRef = useRef(0);
  selectedRevisionRef.current = selectedPatient?.revision ?? 0;
  const briefingRequestRef = useRef(0);
  // Data-router blocking also covers Back and links outside the sidebar.
  // https://reactrouter.com/6.30.1/hooks/use-blocker
  useUnsavedChanges(hasWork, captureBusy ? 'Pare a gravação e aguarde o salvamento antes de sair.' : 'Há trabalho não concluído. Sair desta tela? Rascunhos salvos poderão ser retomados; textos ainda não enviados serão descartados.', {
    blocking:captureBusy,
    onBlocked:useCallback(()=>toast({title:'Gravação ainda não salva',description:'Pare a gravação e aguarde o salvamento antes de sair desta tela.',variant:'destructive'}),[toast]),
  });
  // Runs `go` when the patient may change now, or after "Descartar alterações" in
  // the app's dialog; `cancel` when the change is refused or the doctor keeps editing.
  const whenPatientChangeAllowed = useCallback((nextId: string | null, go: () => void, cancel?: () => void) => {
    if(nextId===selectedPatientIdRef.current){go();return;}
    if (patientWork && !patientWorkExit.current()) {cancel?.();return;}
    if(captureBusy){toast({title:'Gravação ainda não salva',description:'Pare a gravação e aguarde o salvamento antes de mudar de paciente.',variant:'destructive'});cancel?.();return;}
    if(!hasWork){go();return;}
    setDiscardAsk({proceed:go,cancel});
  }, [hasWork,captureBusy,toast,patientWork]);
  // Sign out (sidebar or "Mais") also asks an open patient editor first.
  useExitGuard(useCallback(() => !patientWork || patientWorkExit.current(), [patientWork]));

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(!mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useSeedPatients(user?.id);

  // The directory has its own key: Pacientes/Agenda cache the full Patient[]
  // list under ['patients', uid, 'all'], and sharing one key crashed them.
  const { data: directory, isError: patientsError, refetch: retryPatients } = useQuery<{patients:Patient[];counts:{total:number;new:number;returns:number}}>({
    queryKey: ['patients', user?.id, 'directory'],
    queryFn: async () => {
      const {data,error}=await supabase.rpc('workspace_directory',{p_limit:100});
      if(error)throw error;
      const result=data as unknown as {patients:Parameters<typeof mapPatientRow>[0][];counts:{total:number;new:number;returns:number}};
      return {patients:result.patients.map(mapPatientRow),counts:result.counts};
    },
    enabled: !!user?.id,
  });
  const patients=directory?.patients ?? [];
  const {data: selectedDetail}=useQuery({
    queryKey:['patients',user?.id,'detail',selectedPatientIdRef.current],
    enabled:!!user&&!!selectedPatientIdRef.current,
    queryFn:async()=>{const {data,error}=await supabase.from('patients').select('*').eq('id',selectedPatientIdRef.current!).single();if(error||!data)throw error??new Error('Paciente indisponível');return mapPatientRow(data);},
  });

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const activatePatient = async (patient: Pick<Patient, 'id'>, complaint?: string, followUrl = false) => {
    const requestedId = patient.id;
    const alreadyActive=selectedPatientIdRef.current===requestedId && !!selectedPatient;
    if(alreadyActive && captureBusy){setMobileView('chat');return;}
    if (!followUrl) {
      const params = new URLSearchParams(location.search);
      params.set('patient', requestedId);
      afterConfirmedSaveOrDiscard(()=>navigate({ pathname: '/', search: params.toString() }));
    }
    selectedPatientIdRef.current = requestedId;
    if(!alreadyActive){
      setPatientWork(null); patientWorkExit.current = () => true;
      setSelectedPatient(null);setPatientLoading(true);
      briefingRequestRef.current++;
      setPreBriefing(null);setBriefingLoading(false);setBriefingError(false);setBriefingRequested(false);
    }
    if (complaint !== undefined) setPatientComplaints(previous => ({ ...previous, [requestedId]: complaint }));

    setMobileView('chat');
    try{
      const full=await queryClient.fetchQuery({queryKey:['patients',user?.id,'detail',requestedId],queryFn:async()=>{
        const {data,error}=await supabase.from('patients').select('*').eq('id',requestedId).single();if(error||!data)throw error??new Error('Paciente indisponível');return mapPatientRow(data);
      }});
      if(selectedPatientIdRef.current!==requestedId)return;
      setSelectedPatient(full);
      const cacheKey = `${full.id}/${full.revision ?? 0}/${clinicDate()}`;
      if (!alreadyActive && preBriefingCache.current.has(cacheKey)) {
        setPreBriefing(preBriefingCache.current.get(cacheKey) ?? null);
        setBriefingRequested(true);
      }
    }catch{
      if(selectedPatientIdRef.current===requestedId)toast({title:'Paciente indisponível',description:'Não foi possível carregar o prontuário. Selecione o paciente novamente para tentar.',variant:'destructive'});
    }finally{if(selectedPatientIdRef.current===requestedId)setPatientLoading(false);}
  };

  const loadBriefing = async (patient: Patient) => {
    const inFlightKey = `${patient.id}/${patient.revision ?? 0}/${clinicDate()}`;
    if (selectedPatientIdRef.current !== patient.id || briefingInFlight.current.has(inFlightKey)) return;
    const requestedId = patient.id;
    const requestedRevision = patient.revision ?? 0;
    selectedRevisionRef.current = requestedRevision;
    const request = ++briefingRequestRef.current;
    const isCurrentRequest = () => selectedPatientIdRef.current === requestedId && selectedRevisionRef.current === requestedRevision && briefingRequestRef.current === request;
    setBriefingError(false);
    setBriefingRequested(true);

    const cacheKey = `${requestedId}/${patient.revision ?? 0}/${clinicDate()}`;
    const cached = preBriefingCache.current.get(cacheKey);
    if (preBriefingCache.current.has(cacheKey)) {
      setPreBriefing(cached ?? null);
      setBriefingLoading(false);
      return;
    }

    setPreBriefing(null);
    setBriefingLoading(true);
    briefingInFlight.current.add(inFlightKey);
    try {
      const { data, error } = await supabase.functions.invoke('generate-prebriefing', {
        body: {
          patientId: requestedId,
          patientContext: {
            name: patient.name,
            age: patient.age,
            dateOfBirth:patient.dateOfBirth,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
          },
        },
      });
      // Refresh usage meter regardless of whether briefing was cached or generated.
      queryClient.invalidateQueries({ queryKey: ['usage-daily', user?.id] });
      if (error) {
        if (isCurrentRequest()) setBriefingError(true);
        const body = await functionErrorBody(error);
        if (body?.quotaExceeded) {
          toast({
            title: 'Limite diário atingido',
            description: 'O resumo pré-consulta não pôde ser gerado hoje.',
            variant: 'destructive',
          });
        } else {
          // Non-quota failure — surface a subtle notice instead of silently
          // degrading to the "primeira consulta" empty state.
          toast({
            title: 'Resumo pré-consulta indisponível',
            description: 'Não foi possível gerar o resumo agora. Você pode seguir com a consulta normalmente.',
          });
        }
      } else if (data) {
        if (typeof data !== 'object' || !['returnInfo','previousComplaint','pending','alert'].every(key=>typeof data[key] === 'string')) throw new Error('Resumo inválido');
        // A slow response for a previously selected patient must never
        // overwrite the briefing of the patient displayed now.
        if (isCurrentRequest()) { preBriefingCache.current.set(cacheKey, data); setPreBriefing(data); }
      } else if (isCurrentRequest()) {
        preBriefingCache.current.set(cacheKey, null);
      }
    } catch {
      if (isCurrentRequest()) {
        setBriefingError(true);
        toast({ title: 'Resumo pré-consulta indisponível', description: 'Tente novamente pelo resumo.' });
      }
    } finally {
      briefingInFlight.current.delete(inFlightKey);
      if (isCurrentRequest()) setBriefingLoading(false);
    }
  };

  const previousBriefingSource = useRef<{id:string;revision:number} | null>(null);
  useEffect(() => {
    if (!selectedPatient) { previousBriefingSource.current = null; return; }
    const source = {id:selectedPatient.id,revision:selectedPatient.revision ?? 0};
    const previous = previousBriefingSource.current;
    previousBriefingSource.current = source;
    if (previous?.id === source.id && previous.revision !== source.revision) {
      briefingRequestRef.current++;
      setPreBriefing(null);setBriefingRequested(false);setBriefingLoading(false);setBriefingError(false);
    }
    // An outdated summary needs explicit regeneration; chart reads never spend AI credits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?.id, selectedPatient?.revision]);

  const handleSelectPatient = (patient: Patient, appointmentId?:string) => {
    if(captureBusy && patient.id===selectedPatientIdRef.current){setMobileView('chat');return;}
    whenPatientChangeAllowed(patient.id, () => {
      setSelectedAppointmentId(appointmentId ?? null);
      void activatePatient(patient);
    });
  };
  const linkedPatientId = new URLSearchParams(location.search).get('patient');
  useEffect(() => {
    if (!linkedPatientId || linkedPatientId === selectedPatientIdRef.current) return;
    const linked = patients.find(patient => patient.id === linkedPatientId);
    whenPatientChangeAllowed(linkedPatientId, () => {
      // A URL-driven switch has no appointment context; never carry the
      // previous patient's appointment into the new patient's draft.
      setSelectedAppointmentId(null);
      void activatePatient(linked ?? {id:linkedPatientId} as Patient, undefined, true);
    });
    // Activation only follows the URL/patient-list change, not briefing responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedPatientId, patients]);

  // Keep the selectedPatient snapshot in sync with the patients query so
  // profile updates (diagnoses, medications) show up without re-selecting.
  useEffect(() => {
    setSelectedPatient(prev => {
      if (!prev) return prev;
      const fresh = selectedDetail?.id===prev.id?selectedDetail:null;
      if (!fresh) return prev;
      const next = fresh;
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [selectedDetail]);

  const handleStartConsultation = async (
    patientId: string | null,
    newPatientData: { name: string; age: number | null; profession: string; phone?: string; dateOfBirth?: string;email?:string;cpf?:string;sex?:string;healthInsurance?:string } | undefined,
    complaint: string
  ) => {
    if (captureBusy || (patientId === selectedPatientIdRef.current && hasWork)) {
      toast({ title:'Conclua o trabalho atual',description:'Salve ou encerre o trabalho deste paciente antes de iniciar outra consulta.',variant:'destructive' });
      throw new Error('Consulta atual ainda não concluída.');
    }
    if (!user || !await new Promise<boolean>(resolve => whenPatientChangeAllowed(newPatientData ? null : patientId, () => resolve(true), () => resolve(false)))) throw new Error('Consulta não iniciada.');
    let patient: Patient;

    if (newPatientData) {
      const { data, error } = await supabase
        .from('patients')
        .insert([{
          name: newPatientData.name,
          age: newPatientData.age,
          date_of_birth: newPatientData.dateOfBirth || null,
          profession: newPatientData.profession,
          last_visit: null,
          status: 'atendimento',
          user_id: user!.id,
          diagnoses: [],
          medications: [],
          allergies: [],
          phone: newPatientData.phone ?? null,
          email: newPatientData.email || null,
          cpf: newPatientData.cpf || null,
          sex: newPatientData.sex || null,
          health_insurance: newPatientData.healthInsurance || null,
        }])
        .select()
        .single();
      if (error) { toast({ title: 'Erro ao criar paciente', variant: 'destructive' }); throw error; }
      patient = mapPatientRow(data);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } else {
      // The directory only holds the first 100 patients; a patient picked via
      // search may be outside it, so load it directly when needed.
      let found = patients.find(p => p.id === patientId);
      if (!found && patientId) {
        const { data } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle();
        if (data) found = mapPatientRow(data);
      }
      if (!found) {
        toast({ title: 'Paciente não encontrado', description: 'Selecione o paciente novamente.', variant: 'destructive' });
        throw new Error('Paciente não encontrado.');
      }
      patient = found;
      const { error } = await supabase.from('patients').update({ status: 'atendimento' }).eq('id', patient.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    }

    // 'Nova Consulta' is unscheduled: drop any appointment selected earlier
    // (it belongs to another patient and would fail the draft's appointment FK).
    setSelectedAppointmentId(null);
    void activatePatient({id:patient.id}, complaint);
    toast({ title: 'Consulta iniciada', description: `Consulta com ${patient.name} iniciada.` });
  };

  if (loading) return <FullScreenLoader />;

  const homeActive = mobileView === 'home' || !selectedPatient;
  const showHome = () => setMobileView('home');

  return (
    <div className={cn('flex h-[100dvh] bg-background',captureBusy && 'pt-14')}>
      {/* The app's one sidebar. While a consultation is on screen it also holds
          today's agenda; on the dashboard the agenda is in the page already. */}
      <AppSidebar className="h-full" onHome={showHome} homeActive={homeActive}>
        {selectedPatient && mobileView !== 'home' && (
          <PatientSidebar
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={handleSelectPatient}
            onNewConsultation={() => setShowNewConsultationModal(true)}
            userId={user?.id ?? ''}
          />
        )}
      </AppSidebar>
      <div className="flex min-w-0 flex-1 flex-col">
      {selectedPatient && mobileView !== 'home' && (
        <div role="group" aria-label="Consulta ou perfil do paciente" className="shrink-0 border-b bg-background px-3 py-2 shell:hidden">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {([['chat', 'Consulta'], ['info', 'Perfil']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mobileView === id} onClick={() => setMobileView(id)}
                className={cn('min-h-11 rounded-lg text-sm font-medium transition-colors', mobileView === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Consultation row: chat and patient panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Center panel — dashboard or active consultation */}
        <div className={cn(
          'h-full min-w-0 flex flex-col',
          'shell:flex-1 shell:border-x shell:border-border/50',
          (mobileView === 'home' || mobileView === 'chat') ? 'flex-1' : 'hidden shell:flex',
        )}>
          {/* ChatPanel stays MOUNTED on mobile tab switches (CSS-hidden) so an
              active recording keeps running instead of being silently killed. */}
          {selectedPatient && (
            <div className={cn(
              'h-full min-h-0 flex-col',
              mobileView === 'chat' || (!isMobile && mobileView !== 'home') ? 'flex' : 'hidden',
            )}>
              <ChatPanel
                recoveryRequest={recoveryRequest}
                appointmentId={selectedAppointmentId}
                patient={selectedPatient}
                messages={chatMessages}
                conversationLoading={conversation.isLoading}
                conversationError={conversation.isError}
                onRetryConversation={() => void conversation.refetch()}
                onLoadOlderMessages={conversation.hasNextPage ? () => void conversation.fetchNextPage() : undefined}
                loadingOlderMessages={conversation.isFetchingNextPage}
                onMessagesChange={setChatMessages}
                chiefComplaint={chiefComplaint}
                preBriefing={preBriefing}
                briefingRequested={briefingRequested}
                briefingError={briefingError}
                onCaptureStateChange={setCaptureBusy}
                onOpenPatientWork={(manual,entry) => {
                  patientWorkTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  if (user && selectedPatient) setPatientWork({ actor: user.id, patientId: selectedPatient.id, manual, entry,
                    appointmentId: entry ? undefined : selectedAppointmentId ?? undefined, initialTitle: entry ? '' : chiefComplaint });
                }}
                onRetryBriefing={() => { if (selectedPatient) void loadBriefing(selectedPatient); }}
                onOpenPatientPanel={() => setMobileView('info')}
                onReturnToConsultation={() => setMobileView('chat')}
                briefingLoading={briefingLoading}
                userId={user?.id ?? ''}
                onConsultationSaved={() => { preBriefingCache.current.clear(); briefingRequestRef.current++; void queryClient.invalidateQueries({queryKey:['consultation-recovery',user?.id]}); }}
                onWorkStateChange={setChatBusy}
              />
            </div>
          )}
          {patientLoading && <p role="status" className="p-6 text-sm text-muted-foreground">Carregando prontuário…</p>}
          {!patientLoading && (!selectedPatient || mobileView === 'home' || (isMobile && mobileView !== 'chat')) && (
            <WelcomeDashboard
              patients={patients}
              counts={directory?.counts}
              onSelectPatient={handleSelectPatient}
              onNewConsultation={() => setShowNewConsultationModal(true)}
              onRetryPatients={() => void retryPatients()}
              openConsultation={selectedPatient ? { name: selectedPatient.name, onReturn: () => setMobileView('chat') } : undefined}
              patientsState={patientsError ? 'error' : directory ? 'ready' : 'loading'}
              onResumeConsultation={patientId => whenPatientChangeAllowed(patientId, () => {
                if (patientId === selectedPatientIdRef.current && selectedPatient?.id === patientId) {
                  setMobileView('chat');
                  setRecoveryRequest(value => value + 1);
                  return;
                }
                if (patientId !== selectedPatientIdRef.current) setSelectedAppointmentId(null);
                void activatePatient({id:patientId});
              })}
              userId={user?.id ?? ''}
            />
          )}
        </div>

        {/* Patient snapshot */}
        <div className={cn(
          'h-full flex flex-col relative',
          'shell:w-[17rem] shell:shrink-0 xl:w-[25%] xl:min-w-[270px] xl:max-w-[360px]',
          mobileView === 'info' ? 'flex-1' : selectedPatient && mobileView !== 'home' ? 'hidden shell:flex' : 'hidden',
        )}>
          <PatientSnapshot
            patient={selectedPatient}
            onWorkStateChange={setSnapshotBusy}
            onAskAI={() => {
              // On mobile, jump to the chat tab; on desktop, chat is already visible.
              if (selectedPatient) setMobileView('chat');
            }}
          />
        </div>

      </div>

      <MobileBottomBar placement="inline" onHome={showHome} homeActive={homeActive} />
      </div>

      {patientWork && patientWork.actor === user?.id && patientWork.patientId === selectedPatient?.id && (
        <Suspense fallback={<p role="status">Carregando acompanhamento…</p>}>
          <PatientWorkspaceDialog patientId={selectedPatient.id} returnFocus={patientWorkTrigger.current}
            manual={patientWork.manual} entry={patientWork.entry} appointmentId={patientWork.appointmentId} initialTitle={patientWork.initialTitle}
            onExitGuardChange={guard => { patientWorkExit.current = guard; }}
            onClose={() => { setPatientWork(null); patientWorkExit.current = () => true; }} />
        </Suspense>
      )}
      <NewConsultationModal
        open={showNewConsultationModal}
        onOpenChange={setShowNewConsultationModal}
        patients={patients}
        onStartConsultation={handleStartConsultation}
      />
      <DiscardChangesDialog open={!!discardAsk} message={PATIENT_CHANGE_MESSAGE}
        onKeep={() => { const ask = discardAsk; setDiscardAsk(null); ask?.cancel?.(); }}
        onDiscard={() => { const ask = discardAsk; setDiscardAsk(null); ask?.proceed(); }} />
    </div>
  );
};

export default Index;
