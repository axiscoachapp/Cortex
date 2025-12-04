import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Brain, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Patient } from '@/types/patient';
import { cn } from '@/lib/utils';

interface PatientSidebarProps {
  patients: Patient[];
  selectedPatient: Patient | null;
  onSelectPatient: (patient: Patient) => void;
  onNewConsultation?: () => void;
}

const statusLabels: Record<Patient['status'], string> = {
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  novo: 'Novo',
  atendimento: 'Em atendimento',
};

export function PatientSidebar({ patients, selectedPatient, onSelectPatient, onNewConsultation }: PatientSidebarProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPatients = patients.filter((patient) =>
    patient.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  };

  return (
    <aside className="w-full h-full bg-transparent flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-medical-blue flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Cortex</span>
          </div>
        </div>
        <Button variant="medical" className="w-full" size="default" onClick={onNewConsultation}>
          <Plus className="w-4 h-4" />
          Nova Consulta
        </Button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar paciente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-card border-border/50"
          />
        </div>
      </div>

      {/* Patient List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        <div className="space-y-1">
          {filteredPatients.map((patient) => (
            <button
              key={patient.id}
              onClick={() => onSelectPatient(patient)}
              className={cn(
                'w-full p-3 rounded-lg text-left transition-all duration-200',
                'hover:bg-accent/50',
                selectedPatient?.id === patient.id
                  ? 'bg-patient-active border border-patient-active-border shadow-sm'
                  : 'bg-transparent'
              )}
            >
              <div className="flex items-start gap-3">
                {patient.photoUrl ? (
                  <img
                    src={patient.photoUrl}
                    alt={patient.name}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-medical-blue-light flex items-center justify-center shrink-0">
                    <span className="text-medical-blue font-semibold text-xs">
                      {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'font-medium text-sm truncate',
                    selectedPatient?.id === patient.id ? 'text-medical-blue' : 'text-foreground'
                  )}>
                    {patient.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Última visita: {formatDate(patient.lastVisit)}
                  </p>
                  <Badge variant={patient.status} className="mt-1 text-[10px]">
                    {statusLabels[patient.status]}
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Management Link */}
      <div className="p-4 border-t border-border/50">
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={() => navigate('/gerenciar-pacientes')}
        >
          <Settings className="w-4 h-4 mr-2" />
          Gerenciar Pacientes
        </Button>
      </div>
    </aside>
  );
}
