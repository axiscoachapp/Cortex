import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel, PreBriefing } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { NewConsultationModal } from '@/components/NewConsultationModal';
import { WelcomeDashboard } from '@/components/WelcomeDashboard';
import { Button } from '@/components/ui/button';
import { LogOut, Home, PanelLeft, Mic, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Patient, ChatMessage } from '@/types/patient';
import { useToast } from '@/hooks/use-toast';
import { useSeedPatients } from '@/hooks/useSeedPatients';
import { mapPatientRow } from '@/lib/patientMapper';
import { clinicDate } from '@/lib/dates';
import { functionErrorBody } from '@/lib/functionErrors';
import { useUnsavedChanges, afterConfirmedSaveOrDiscard } from '@/hooks/useUnsavedChanges';

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut, loading } = useAuth();
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
  const hasWork = chatBusy || snapshotBusy || captureBusy;
  const selectedId = selectedPatient?.id ?? '';
  const chatMessages = patientMessages[selectedId] ?? [];
  const chiefComplaint = patientComplaints[selectedId] ?? '';
  const setChatMessages = useCallback((value: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    setPatientMessages(previous => ({ ...previous, [selectedId]: typeof value === 'function' ? value(previous[selectedId] ?? []) : value }));
  }, [selectedId]);
  const [showNewConsultationModal, setShowNewConsultationModal] = useState(false);
  const [preBriefing, setPreBriefing] = useState<PreBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(false);
  const [mobileView, setMobileView] = useState<'home' | 'list' | 'chat' | 'info'>('home');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);
  const preBriefingCache = useRef<Map<string, PreBriefing>>(new Map());
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
  const confirmPatientChange = useCallback((nextId: string | null) => {
    if(nextId===selectedPatientIdRef.current)return true;
    if(captureBusy){toast({title:'Gravação ainda não salva',description:'Pare a gravação e aguarde o salvamento antes de mudar de paciente.',variant:'destructive'});return false;}
    return !hasWork || window.confirm('Há trabalho não concluído. Mudar de paciente? Os rascunhos permanecem vinculados ao paciente original.');
  }, [hasWork,captureBusy,toast]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useSeedPatients(user?.id);

  const { data: directory, isError: patientsError, refetch: retryPatients } = useQuery<{patients:Patient[];counts:{total:number;new:number;returns:number}}>({
    queryKey: ['patients', user?.id],
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

  const handleSignOut = async () => {
    if (captureBusy) { toast({title:'Gravação ainda não salva',description:'Pare a gravação e aguarde o salvamento antes de sair da conta.',variant:'destructive'}); return; }
    if (hasWork && !window.confirm('Sair da conta com trabalho não concluído? Textos ainda não enviados serão descartados.')) return;
    try { await signOut(); navigate('/auth'); }
    catch { toast({title:'Não foi possível sair da conta',description:'A sessão continua aberta. Verifique sua conexão e tente novamente.',variant:'destructive'}); }
  };

  const activatePatient = async (patient: Patient, complaint?: string, followUrl = false) => {
    const requestedId = patient.id;
    const alreadyActive=selectedPatientIdRef.current===requestedId && !!selectedPatient;
    if(alreadyActive && captureBusy){setMobileView('chat');return;}
    if (!followUrl) {
      const params = new URLSearchParams(location.search);
      params.set('patient', requestedId);
      afterConfirmedSaveOrDiscard(()=>navigate({ pathname: '/', search: params.toString() }));
    }
    selectedPatientIdRef.current = requestedId;
    if(!alreadyActive){setSelectedPatient(null);setPatientLoading(true);}
    if (complaint !== undefined) setPatientComplaints(previous => ({ ...previous, [requestedId]: complaint }));

    setMobileView('chat');
    try{
      const full=await queryClient.fetchQuery({queryKey:['patients',user?.id,'detail',requestedId],queryFn:async()=>{
        const {data,error}=await supabase.from('patients').select('*').eq('id',requestedId).single();if(error||!data)throw error??new Error('Paciente indisponível');return mapPatientRow(data);
      }});
      if(selectedPatientIdRef.current!==requestedId)return;
      setSelectedPatient(full);
      await loadBriefing(full);
    }catch{
      if(selectedPatientIdRef.current===requestedId)toast({title:'Paciente indisponível',description:'Não foi possível carregar o prontuário. Selecione o paciente novamente para tentar.',variant:'destructive'});
    }finally{if(selectedPatientIdRef.current===requestedId)setPatientLoading(false);}
  };

  const loadBriefing = async (patient: Patient) => {
    if (selectedPatientIdRef.current !== patient.id) return;
    const requestedId = patient.id;
    const requestedRevision = patient.revision ?? 0;
    selectedRevisionRef.current = requestedRevision;
    const request = ++briefingRequestRef.current;
    const isCurrentRequest = () => selectedPatientIdRef.current === requestedId && selectedRevisionRef.current === requestedRevision && briefingRequestRef.current === request;
    setBriefingError(false);

    const cacheKey = `${requestedId}/${patient.revision ?? 0}/${clinicDate()}`;
    const cached = preBriefingCache.current.get(cacheKey);
    if (cached) {
      setPreBriefing(cached);
      setBriefingLoading(false);
      return;
    }

    setPreBriefing(null);
    setBriefingLoading(true);
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
      }
    } catch {
      if (isCurrentRequest()) {
        setBriefingError(true);
        toast({ title: 'Resumo pré-consulta indisponível', description: 'Tente novamente pelo resumo.' });
      }
    } finally {
      if (isCurrentRequest()) setBriefingLoading(false);
    }
  };

  const previousBriefingSource = useRef<{id:string;revision:number} | null>(null);
  useEffect(() => {
    if (!selectedPatient) { previousBriefingSource.current = null; return; }
    const source = {id:selectedPatient.id,revision:selectedPatient.revision ?? 0};
    const previous = previousBriefingSource.current;
    previousBriefingSource.current = source;
    if (previous?.id === source.id && previous.revision !== source.revision) void loadBriefing(selectedPatient);
    // Refetch only when saved clinical data changes, not on request state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?.id, selectedPatient?.revision]);

  const handleSelectPatient = (patient: Patient, appointmentId?:string) => {
    if(captureBusy && patient.id===selectedPatientIdRef.current){setMobileView('chat');return;}
    if (!confirmPatientChange(patient.id)) return;
    setSelectedAppointmentId(appointmentId ?? null);
    void activatePatient(patient);
  };
  const linkedPatientId = new URLSearchParams(location.search).get('patient');
  useEffect(() => {
    if (!linkedPatientId || linkedPatientId === selectedPatientIdRef.current) return;
    const linked = patients.find(patient => patient.id === linkedPatientId);
    if (confirmPatientChange(linkedPatientId)) void activatePatient(linked ?? {id:linkedPatientId} as Patient, undefined, true);
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
    newPatientData: { name: string; age: number | null; profession: string; phone?: string; dateOfBirth?: string } | undefined,
    complaint: string
  ) => {
    if (captureBusy || (patientId === selectedPatientIdRef.current && hasWork)) {
      toast({ title:'Conclua o trabalho atual',description:'Salve ou encerre o trabalho deste paciente antes de iniciar outra consulta.',variant:'destructive' });
      throw new Error('Consulta atual ainda não concluída.');
    }
    if (!user || !confirmPatientChange(newPatientData ? null : patientId)) throw new Error('Consulta não iniciada.');
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
        }])
        .select()
        .single();
      if (error) { toast({ title: 'Erro ao criar paciente', variant: 'destructive' }); throw error; }
      patient = mapPatientRow(data);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } else {
      const found = patients.find(p => p.id === patientId);
      if (!found) {
        toast({ title: 'Paciente não encontrado', description: 'Selecione o paciente novamente.', variant: 'destructive' });
        throw new Error('Paciente não encontrado.');
      }
      patient = found;
      const { error } = await supabase.from('patients').update({ status: 'atendimento' }).eq('id', patient.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    }

    void activatePatient({ ...patient, status: 'atendimento' }, complaint);
    toast({ title: 'Consulta iniciada', description: `Consulta com ${patient.name} iniciada.` });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center animate-pulse"
            style={{ background: 'hsl(var(--primary))' }}>
            <span className="text-white text-sm font-bold">C</span>
          </div>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'home' as const, icon: Home, label: 'Início', disabled: false },
    { id: 'list' as const, icon: PanelLeft, label: 'Menu', disabled: false },
    { id: 'chat' as const, icon: Mic, label: 'Consulta', disabled: !selectedPatient },
    { id: 'info' as const, icon: User, label: 'Perfil', disabled: !selectedPatient },
  ];

  return (
    <div className={cn('flex flex-col h-[100dvh] bg-background',captureBusy && 'pt-14')}>
      {patientsError && <div role="alert" className="p-3 text-sm text-destructive">Pacientes indisponíveis. <button className="underline" onClick={() => retryPatients()}>Tentar novamente</button></div>}
      {/* Three-panel row — takes all space above the bottom nav */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar */}
        <div className={cn(
          'h-full flex flex-col',
          'xl:w-[20%] xl:min-w-[260px] xl:max-w-[300px] xl:flex',
          mobileView === 'list' ? 'flex-1' : 'hidden xl:flex',
        )}>
          <PatientSidebar
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={handleSelectPatient}
            onNewConsultation={() => setShowNewConsultationModal(true)}
            onHome={() => setMobileView('home')}
            onNavigate={path => navigate(path)}
            userId={user?.id ?? ''}
          />
        </div>

        {/* Center panel — dashboard or active consultation */}
        <div className={cn(
          'h-full min-w-0 flex flex-col',
          'xl:flex-1 xl:border-x xl:border-border/50',
          (mobileView === 'home' || mobileView === 'chat') ? 'flex-1' : 'hidden xl:flex',
        )}>
          {/* ChatPanel stays MOUNTED on mobile tab switches (CSS-hidden) so an
              active recording keeps running instead of being silently killed. */}
          {selectedPatient && (
            <div className={cn(
              'h-full min-h-0 flex-col',
              mobileView === 'chat' || (!isMobile && mobileView !== 'home') ? 'flex' : 'hidden',
            )}>
              <ChatPanel
                appointmentId={selectedAppointmentId}
                patient={selectedPatient}
                messages={chatMessages}
                onMessagesChange={setChatMessages}
                chiefComplaint={chiefComplaint}
                preBriefing={preBriefing}
                briefingError={briefingError}
                onCaptureStateChange={setCaptureBusy}
                onRetryBriefing={() => { if (selectedPatient) void activatePatient(selectedPatient); }}
                briefingLoading={briefingLoading}
                userId={user?.id ?? ''}
                onConsultationSaved={() => { preBriefingCache.current.clear(); briefingRequestRef.current++; }}
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
              userId={user?.id ?? ''}
            />
          )}
        </div>

        {/* Patient snapshot */}
        <div className={cn(
          'h-full flex flex-col relative',
          'xl:w-[25%] xl:min-w-[270px] xl:max-w-[360px] xl:flex',
          mobileView === 'info' ? 'flex-1' : 'hidden xl:flex',
        )}>
          <PatientSnapshot
            patient={selectedPatient}
            onWorkStateChange={setSnapshotBusy}
            onAskAI={() => {
              // On mobile, jump to the chat tab; on desktop, chat is already visible.
              if (selectedPatient) setMobileView('chat');
            }}
          />
          {user && (
            <div className="absolute top-3 right-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSignOut}
                className="h-7 w-7 text-muted-foreground hover:text-muted-foreground hover:bg-muted/50"
                title="Sair"
                aria-label="Sair"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

      </div>

      {/* Mobile bottom navigation */}
      <nav className="xl:hidden shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-stretch h-16 px-1">
          {navItems.map(({ id, icon: Icon, label, disabled }) => (
            <button
              key={id}
              onClick={() => !disabled && setMobileView(id)}
              disabled={disabled}
              aria-current={mobileView === id ? 'page' : undefined}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 rounded-xl mx-0.5 transition-all min-h-[44px]',
                mobileView === id
                  ? 'text-medical-blue bg-medical-blue-light/60'
                  : disabled
                  ? 'text-muted-foreground cursor-not-allowed'
                  : 'text-muted-foreground hover:text-muted-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
          <button
            onClick={handleSignOut}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl mx-0.5 transition-all min-h-[44px] text-muted-foreground hover:text-muted-foreground hover:bg-muted/30"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-xs font-medium">Sair</span>
          </button>
        </div>
      </nav>

      <NewConsultationModal
        open={showNewConsultationModal}
        onOpenChange={setShowNewConsultationModal}
        patients={patients}
        onStartConsultation={handleStartConsultation}
      />
    </div>
  );
};

export default Index;
