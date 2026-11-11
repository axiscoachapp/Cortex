import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * The explicit "I checked" box, kept only where an action is hard to undo or changes another
 * person's data (a contact's phone, who may book for a patient). Elsewhere the primary button's
 * wording is the confirmation. Shared checkbox in a 44 px row.
 */
export function ConfirmCheck({ id, checked, onChange, disabled, children }: {
  id: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={value => onChange(value === true)} />
      <label htmlFor={id} className="text-sm leading-snug">{children}</label>
    </div>
  );
}
