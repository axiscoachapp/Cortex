import { Button } from '@/components/ui/button';
import { suggestDoctor } from './routing';
import type { Doctor, ReceptionCase } from './contracts';

export function DoctorSuggestion({
  doctors,
  receptionCase,
  onSelect,
  disabled = false,
}: {
  doctors: Doctor[];
  receptionCase: ReceptionCase;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const suggestion = suggestDoctor(doctors, receptionCase);
  // The case already has the doctor this box would suggest: nothing to add.
  if (receptionCase.doctorId && suggestion.doctorId === receptionCase.doctorId) return null;
  const candidates = doctors.filter(doctor => suggestion.candidateIds.includes(doctor.id));
  return (
    <aside className="rounded-lg border bg-primary/5 p-3 space-y-2">
      <h3 className="text-xs font-semibold">Sugestão de médico</h3>
      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
      {candidates.length > 1 && <p className="text-xs font-medium">Médicos que já atendem este contato (sem ordem de preferência):</p>}
      {candidates.length > 0 && <div className="flex flex-wrap gap-2">{candidates.map(doctor => (
        <Button
          key={doctor.id}
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal text-left"
          disabled={disabled}
          onClick={() => onSelect(doctor.id)}
        >
          Selecionar {doctor.name}
        </Button>
      ))}</div>}
    </aside>
  );
}
