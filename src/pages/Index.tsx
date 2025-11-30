import { useState } from 'react';
import { PatientSidebar } from '@/components/PatientSidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PatientSnapshot } from '@/components/PatientSnapshot';
import { mockPatients, mockChatMessages } from '@/data/mockData';
import { Patient } from '@/types/patient';

const Index = () => {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    mockPatients.find(p => p.id === '1') || null
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
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
