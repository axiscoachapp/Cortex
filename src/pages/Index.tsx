import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { Button } from '@/components/ui/button';
import { LogOut, LogIn } from 'lucide-react';
import { mockPatients, mockChatMessages } from '@/data/mockData';
import { Patient } from '@/types/patient';

const Index = () => {
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    mockPatients.find(p => p.id === '1') || null
  );

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
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
          patients={mockPatients}
          selectedPatient={selectedPatient}
          onSelectPatient={setSelectedPatient}
        />
      </div>

      {/* Center Panel - Chat/Brain (55%) */}
      <div className="flex-1 h-full bg-card">
        <ChatPanel
          patient={selectedPatient}
          messages={selectedPatient?.id === '1' ? mockChatMessages : []}
        />
      </div>

      {/* Right Sidebar - Patient Snapshot (25%) */}
      <div className="w-[25%] min-w-[280px] max-w-[380px] h-full bg-muted/30">
        <PatientSnapshot patient={selectedPatient} />
      </div>
    </div>
  );
};

export default Index;
