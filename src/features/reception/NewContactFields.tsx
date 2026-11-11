import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { receptionApi } from './api';
import { normalizePhone, phoneHint, phoneProblem } from './contactPhone';
import type { ContactOption } from './NewCaseDialog';

/** Name and phone of a new caller, with the phone format and an existing-number check. */
export function NewContactFields({ actor, clinic, name, phone, onName, onPhone, onUseExisting, nameLabel = 'Nome de quem entrou em contato' }: {
  actor: string; clinic: string; name: string; phone: string;
  onName: (value: string) => void; onPhone: (value: string) => void;
  onUseExisting?: (contact: ContactOption) => void; nameLabel?: string;
}) {
  const id = useId();
  const problem = phoneProblem(phone);
  const normalized = normalizePhone(phone);
  const existing = useQuery({
    queryKey: ['reception', actor, 'contacts', clinic, 'phone', normalized],
    queryFn: ({ signal }) => receptionApi.contacts(clinic, normalized!, null, signal),
    enabled: !!normalized,
    retry: false, staleTime: 30_000,
    select: page => page.items.filter(item => normalizePhone(item.phone) === normalized),
  });
  const matches = normalized && existing.isSuccess ? existing.data : [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <Label htmlFor={id + 'name'}>{nameLabel}</Label>
        <Input id={id + 'name'} required minLength={2} maxLength={200} value={name} autoComplete="off"
          onChange={e => onName(e.target.value)} className="h-11" />
      </div>
      <div className="min-w-0">
        <Label htmlFor={id + 'phone'}>Telefone com DDD</Label>
        <Input id={id + 'phone'} type="tel" inputMode="tel" maxLength={40} value={phone} autoComplete="off"
          aria-invalid={!!problem} aria-describedby={id + 'phone-help'} onChange={e => onPhone(e.target.value)} className="h-11" />
        <p id={id + 'phone-help'} className={`mt-1 text-xs ${problem ? 'text-destructive' : 'text-muted-foreground'}`}>{problem ?? phoneHint}</p>
      </div>
      {matches.length > 0 && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 text-sm sm:col-span-2 dark:bg-amber-950/20">
          <p>Este telefone já está cadastrado para {matches.map(m => m.name).join(', ')}.</p>
          {onUseExisting && matches.slice(0, 3).map(match => (
            <Button key={match.id} type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => onUseExisting(match)}>
              Usar {match.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
