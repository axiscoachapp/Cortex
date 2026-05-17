import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { NewConsultationModal } from '@/components/NewConsultationModal';
import { Button } from '@/components/ui/button';
import { LogOut, LogIn } from 'lucide-react';
import { Patient, ChatMessage } from '@/types/patient';
import { useToast } from '@/hooks/use-toast';
import { useSeedPatients } from '@/hooks/useSeedPatients';

function mapRow(row: any): Patient {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    profession: row.profession ?? '',
    photoUrl: row.photo_url ?? undefined,
    lastVisit: row.last_visit,
    status: row.status as Patient['status'],
    diagnoses: Array.isArray(row.diagnoses) ? row.diagnoses : [],
    medications: Array.isArray(row.medications) ? row.medications : [],
    allergies: row.allergies ?? [],
    socialAnamnesis: row.social_anamnesis ?? undefined,
    medicalHistory: row.medical_history ?? undefined,
  };
}

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [showNewConsultationModal, setShowNewConsultationModal] = useState(false);
  const [preBriefing, setPreBriefing] = useState<any>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

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
      return (data ?? []).map(mapRow);
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleSelectPatient = async (patient: Patient) => {
    setSelectedPatient(patient);
    setChatMessages([]);
    setChiefComplaint('');
    setPreBriefing(null);

    setBriefingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-prebriefing', {
        body: {
          patientId: patient.id,
          patientContext: {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
          },
        },
      });
      if (!error && data) {
        setPreBriefing(data);
      }
    } catch {
      // pre-briefing is non-critical, fail silently
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleNewConsultation = () => {
    setShowNewConsultationModal(true);
  };

  const handleStartConsultation = async (
    patientId: string | null,
    newPatientData: { name: string; age: number; profession: string } | undefined,
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
        }])
        .select()
        .single();

      if (error) {
        toast({ title: 'Erro ao criar paciente', variant: 'destructive' });
        return;
      }
      patient = mapRow(data);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    } else {
      patient = patients.find(p => p.id === patientId) || patients[0];
      await supabase
        .from('patients')
        .update({ status: 'atendimento' })
        .eq('id', patient.id);
      queryClient.invalidateQueries({ queryKey: ['patients', user?.id] });
    }

    setSelectedPatient({ ...patient, status: 'atendimento' });
    setChiefComplaint(complaint);
    setChatMessages([]);

    toast({
      title: 'Consulta iniciada',
      description: `Consulta com ${patient.name} iniciada.`,
    });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative">
      <div className="absolute top-4 right-4 z-50">
        {user ? (
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => navigate('/auth')}>
            <LogIn className="h-4 w-4 mr-2" />
            Entrar
          </Button>
        )}
      </div>

      <div className="w-[20%] min-w-[260px] max-w-[320px] h-full bg-muted/30">
        <PatientSidebar
          patients={patients}
          selectedPatient={selectedPatient}
          onSelectPatient={handleSelectPatient}
          onNewConsultation={handleNewConsultation}
        />
      </div>

      <div className="flex-1 h-full bg-card">
        <ChatPanel
          patient={selectedPatient}
          messages={chatMessages}
          onMessagesChange={setChatMessages}
          chiefComplaint={chiefComplaint}
          preBriefing={preBriefing}
          briefingLoading={briefingLoading}
          userId={user?.id ?? ''}
        />
      </div>

      <div className="w-[25%] min-w-[280px] max-w-[380px] h-full bg-muted/30">
        <PatientSnapshot patient={selectedPatient} />
      </div>

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
