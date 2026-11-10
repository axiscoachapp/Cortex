import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Patient } from '@/types/patient';

export function PatientShortcut({ patient, dateLabel, onSelect }: { patient: Patient; dateLabel: string; onSelect: (patient: Patient) => void }) {
  const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return <button type="button" onClick={() => onSelect(patient)} className="flex w-full min-w-0 items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
    {patient.photoUrl ? <img src={patient.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials}</span>}
    <span className="min-w-0 flex-1 space-y-1"><span className="block text-sm font-medium [overflow-wrap:anywhere]">{patient.name}</span><span className="block text-xs leading-relaxed text-muted-foreground">{dateLabel}</span><span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{patient.age === null ? 'Idade não informada' : `${patient.age} anos`}</span><Badge variant="secondary" className="text-[0.625rem]">{patient.status === 'retorno' ? 'Retorno' : patient.status === 'novo' ? 'Novo' : patient.status === 'seguimento' ? 'Seguimento' : 'Em atendimento'}</Badge></span></span>
    <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  </button>;
}
