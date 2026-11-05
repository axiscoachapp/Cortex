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
  const candidates = doctors.filter(doctor => suggestion.candidateIds.includes(doctor.id));
  return (
    <aside className="rounded-lg border bg-primary/5 p-3 space-y-2">
      <h3 className="text-xs font-semibold">Orientação para encaminhamento</h3>
      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
      <p className="text-xs text-muted-foreground">Selecionar somente preenche o campo abaixo. Confira o profissional e use Encaminhar para confirmar.</p>
      {candidates.length > 1 && <p className="text-xs font-medium">Opções com vínculo, sem ordem de preferência:</p>}
      <div className="flex flex-wrap gap-2">{candidates.map(doctor => (
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
      ))}</div>
    </aside>
  );
}
