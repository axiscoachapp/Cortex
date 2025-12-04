import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { NewConsultationModal } from '@/components/NewConsultationModal';
import { Button } from '@/components/ui/button';
import { LogOut, LogIn } from 'lucide-react';
import { mockPatients, mockChatMessages } from '@/data/mockData';
import { Patient, ChatMessage } from '@/types/patient';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();
  const { toast } = useToast();
  const [patients, setPatients] = useState<Patient[]>(mockPatients);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    mockPatients.find(p => p.id === '1') || null
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(mockChatMessages);
  const [showNewConsultationModal, setShowNewConsultationModal] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleNewConsultation = () => {
    setShowNewConsultationModal(true);
  };

  const handleStartConsultation = (
    patientId: string | null,
    newPatientData: { name: string; age: number; profession: string } | undefined,
    chiefComplaint: string
  ) => {
    let patient: Patient;

    if (newPatientData) {
      // Create new patient
      const newPatient: Patient = {
        id: `new-${Date.now()}`,
        name: newPatientData.name,
        age: newPatientData.age,
        profession: newPatientData.profession,
        lastVisit: new Date().toISOString(),
        status: 'atendimento',
        diagnoses: [],
        medications: [],
        allergies: [],
      };
      setPatients(prev => [newPatient, ...prev]);
      patient = newPatient;
    } else {
      // Find existing patient
      patient = patients.find(p => p.id === patientId) || patients[0];
      // Update status to "atendimento"
      setPatients(prev => prev.map(p => 
        p.id === patientId ? { ...p, status: 'atendimento' as const } : p
      ));
    }

    // Set selected patient and clear chat for new consultation
    setSelectedPatient({ ...patient, status: 'atendimento' });
    setChatMessages([]);

    toast({
      title: 'Consulta iniciada',
      description: `Consulta com ${patient.name} iniciada. Queixa: ${chiefComplaint}`,
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
      {/* Left Sidebar - Patient List (20%) */}
      <div className="w-[20%] min-w-[260px] max-w-[320px] h-full bg-muted/30">
        <PatientSidebar
          patients={patients}
          selectedPatient={selectedPatient}
          onSelectPatient={setSelectedPatient}
          onNewConsultation={handleNewConsultation}
        />
      </div>

      {/* Center Panel - Chat/Brain (55%) */}
      <div className="flex-1 h-full bg-card">
        <ChatPanel
          patient={selectedPatient}
          messages={chatMessages}
        />
      </div>

      {/* Right Sidebar - Patient Snapshot (25%) */}
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
