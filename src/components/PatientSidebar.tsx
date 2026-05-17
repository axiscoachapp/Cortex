import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Brain, Settings, CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  atendimento: 'Atendimento',
};

function relativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem.`;
  if (days < 365) return `há ${Math.floor(days / 30)} meses`;
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export function PatientSidebar({ patients, selectedPatient, onSelectPatient, onNewConsultation }: PatientSidebarProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPatients = patients.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-full h-full flex flex-col bg-[hsl(215_40%_98%)] border-r border-border/60">

      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%) 0%, hsl(220 70% 40%) 100%)' }}>
            <Brain className="w-4.5 h-4.5 text-white" style={{ width: '18px', height: '18px' }} />
          </div>
          <span className="font-bold text-foreground tracking-tight">Cortex</span>
          {patients.length > 0 && (
            <span className="ml-auto text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {patients.length}
            </span>
          )}
        </div>

        <Button
          variant="default"
          className="w-full h-9 gap-2 text-sm font-medium shadow-sm"
          style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%) 0%, hsl(220 70% 40%) 100%)' }}
          onClick={onNewConsultation}
        >
          <Plus className="w-4 h-4" />
          Nova Consulta
        </Button>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Buscar paciente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full h-9 pl-8.5 pr-8 rounded-lg text-sm',
              'bg-white border border-border/70',
              'text-foreground placeholder:text-muted-foreground/60',
              'focus:outline-none focus:ring-2 focus:ring-medical-blue/25 focus:border-medical-blue/50',
              'transition-all',
            )}
            style={{ paddingLeft: '2.125rem' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Section label */}
      {filteredPatients.length > 0 && (
        <div className="px-4 pb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
            {searchQuery ? `${filteredPatients.length} resultado${filteredPatients.length !== 1 ? 's' : ''}` : 'Pacientes'}
          </span>
        </div>
      )}

      {/* Patient List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {filteredPatients.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground/60 text-xs">
            {searchQuery ? 'Nenhum resultado' : 'Nenhum paciente'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredPatients.map((patient) => {
              const isSelected = selectedPatient?.id === patient.id;
              const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <button
                  key={patient.id}
                  onClick={() => onSelectPatient(patient)}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-xl text-left transition-all duration-150',
                    'hover:bg-white/80 hover:shadow-sm',
                    isSelected
                      ? 'bg-white shadow-sm border border-medical-blue/20 ring-1 ring-medical-blue/10'
                      : 'bg-transparent',
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    {patient.photoUrl ? (
                      <img src={patient.photoUrl} alt={patient.name}
                        className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-border/50" />
                    ) : (
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                        isSelected
                          ? 'bg-medical-blue text-white'
                          : 'bg-white text-medical-blue border border-border/60',
                      )}>
                        {initials}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn(
                          'text-sm font-medium truncate leading-tight',
                          isSelected ? 'text-medical-blue' : 'text-foreground',
                        )}>
                          {patient.name}
                        </p>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {relativeDate(patient.lastVisit)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant={patient.status} className="text-[9px] px-1.5 py-0 h-4 leading-none">
                          {statusLabels[patient.status]}
                        </Badge>
                        {patient.profession && (
                          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[110px]">
                            {patient.profession}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="px-3 py-3 border-t border-border/50 bg-white/60">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => navigate('/agenda')}
            className={cn(
              'flex items-center justify-center gap-1.5 h-10 rounded-lg text-xs font-medium',
              'text-muted-foreground hover:text-foreground hover:bg-white',
              'transition-all border border-transparent hover:border-border/60',
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Agenda
          </button>
          <button
            onClick={() => navigate('/gerenciar-pacientes')}
            className={cn(
              'flex items-center justify-center gap-1.5 h-10 rounded-lg text-xs font-medium',
              'text-muted-foreground hover:text-foreground hover:bg-white',
              'transition-all border border-transparent hover:border-border/60',
            )}
          >
            <Settings className="w-3.5 h-3.5" />
            Pacientes
          </button>
        </div>
      </div>
    </aside>
  );
}
