import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel, PreBriefing } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { NewConsultationModal } from '@/components/NewConsultationModal';
import { WelcomeDashboard } from '@/components/WelcomeDashboard';
import { Button } from '@/components/ui/button';
import { LogOut, Home, Users, Mic, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Patient, ChatMessage } from '@/types/patient';
import { useToast } from '@/hooks/use-toast';
import { useSeedPatients } from '@/hooks/useSeedPatients';
import { mapPatientRow } from '@/lib/patientMapper';

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [showNewConsultationModal, setShowNewConsultationModal] = useState(false);
  const [preBriefing, setPreBriefing] = useState<PreBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [mobileView, setMobileView] = useState<'home' | 'list' | 'chat' | 'info'>('home');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useSeedPatients(user?.id);

  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ['patients', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data ?? []).map(mapPatientRow);
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleSelectPatient = async (patient: Patient) => {
    setSelectedPatient(patient);
    setChatMessages([]);
    setChiefComplaint('');

    setMobileView('chat');

    const cached = preBriefingCache.current.get(patient.id);
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
          patientId: patient.id,
          userId: user?.id,
          patientContext: {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
          },
        },
      });
      // Refresh usage meter regardless of whether briefing was cached or generated.
      queryClient.invalidateQueries({ queryKey: ['usage-daily', user?.id] });
      if (!error && data) {
        preBriefingCache.current.set(patient.id, data);
        setPreBriefing(data);
      }
    } catch {
      // non-critical
    } finally {
      setBriefingLoading(false);
    }
  };

  const preBriefingCache = useRef<Map<string, PreBriefing>>(new Map());

  const handleStartConsultation = async (
    patientId: string | null,
    newPatientData: { name: string; age: number; profession: string; phone?: string } | undefined,
    complaint: string
  ) => {
    let patient: Patient;

    if (newPatientData) {
      const { data, error } = await supabase
        .from('patients')
        .insert([{
          name: newPatientData.name,
          age: newPatientData.age,
          profession: newPatientData.profession,
          last_visit: new Date().toISOString().split('T')[0],
          status: 'atendimento',
          user_id: user!.id,
          diagnoses: [],
          medications: [],
          allergies: [],
          phone: newPatientData.phone ?? null,
        }])
        .select()
        .single();
      if (error) { toast({ title: 'Erro ao criar paciente', variant: 'destructive' }); return; }
      patient = mapPatientRow(data);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } else {
      patient = patients.find(p => p.id === patientId) || patients[0];
      await supabase.from('patients').update({ status: 'atendimento' }).eq('id', patient.id);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    }

    setSelectedPatient({ ...patient, status: 'atendimento' });
    setChiefComplaint(complaint);
    setChatMessages([]);
    setMobileView('chat');
    toast({ title: 'Consulta iniciada', description: `Consulta com ${patient.name} iniciada.` });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center animate-pulse"
            style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 40%))' }}>
            <span className="text-white text-sm font-bold">C</span>
          </div>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'home' as const, icon: Home, label: 'Início', disabled: false },
    { id: 'list' as const, icon: Users, label: 'Pacientes', disabled: false },
    { id: 'chat' as const, icon: Mic, label: 'Consulta', disabled: !selectedPatient },
    { id: 'info' as const, icon: User, label: 'Perfil', disabled: !selectedPatient },
  ];

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Three-panel row — takes all space above the bottom nav */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar */}
        <div className={cn(
          'h-full flex flex-col',
          'md:w-[20%] md:min-w-[260px] md:max-w-[300px] md:flex',
          mobileView === 'list' ? 'flex-1' : 'hidden md:flex',
        )}>
          <PatientSidebar
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={handleSelectPatient}
            onNewConsultation={() => setShowNewConsultationModal(true)}
          />
        </div>

        {/* Center panel — dashboard or active consultation */}
        <div className={cn(
          'h-full min-w-0 flex flex-col',
          'md:flex-1 md:border-x md:border-border/50',
          (mobileView === 'home' || mobileView === 'chat') ? 'flex-1' : 'hidden md:flex',
        )}>
          {selectedPatient && (!isMobile || mobileView === 'chat') ? (
            <ChatPanel
              patient={selectedPatient}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              chiefComplaint={chiefComplaint}
              preBriefing={preBriefing}
              briefingLoading={briefingLoading}
              userId={user?.id ?? ''}
            />
          ) : (
            <WelcomeDashboard
              patients={patients}
              onSelectPatient={handleSelectPatient}
              onNewConsultation={() => setShowNewConsultationModal(true)}
              userId={user?.id ?? ''}
            />
          )}
        </div>

        {/* Patient snapshot */}
        <div className={cn(
          'h-full flex flex-col relative',
          'md:w-[25%] md:min-w-[270px] md:max-w-[360px] md:flex',
          mobileView === 'info' ? 'flex-1' : 'hidden md:flex',
        )}>
          <PatientSnapshot
            patient={selectedPatient}
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
                className="h-7 w-7 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
                title="Sair"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-stretch h-16 px-1">
          {navItems.map(({ id, icon: Icon, label, disabled }) => (
            <button
              key={id}
              onClick={() => !disabled && setMobileView(id)}
              disabled={disabled}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 rounded-xl mx-0.5 transition-all min-h-[44px]',
                mobileView === id
                  ? 'text-medical-blue bg-medical-blue-light/60'
                  : disabled
                  ? 'text-muted-foreground/30 cursor-not-allowed'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
          <button
            onClick={handleSignOut}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl mx-0.5 transition-all min-h-[44px] text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/30"
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
