import { Button } from '@/components/ui/button';
import { suggestDoctor } from './routing';
import type { Doctor, ReceptionCase } from './contracts';

export function DoctorSuggestion({
  doctors,
  receptionCase,
  onSelect,
}: {
  doctors: Doctor[];
  receptionCase: ReceptionCase;
  onSelect: (id: string) => void;
}) {
  const suggestion = suggestDoctor(doctors, receptionCase);
  const doctor = doctors.find((d) => d.id === suggestion.doctorId);
  return (
    <aside className="rounded-lg border bg-primary/5 p-3 space-y-2">
      <h3 className="text-xs font-semibold">Orientação para encaminhamento</h3>
      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
      {doctor && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-auto whitespace-normal text-left"
          onClick={() => onSelect(doctor.id)}
        >
          Selecionar {doctor.name}
        </Button>
      )}
    </aside>
  );
}
