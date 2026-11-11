import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The one native select style of the reception screens: 44 px tall, full width, same text size. */
export const selectClass = 'block min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The one segmented control of the reception screens: a labelled group of buttons where the
 * current choice is filled. Each option is a button with `aria-pressed`.
 */
export function SegmentedControl<T extends string>({
  label, value, options, onChange, disabled = false, showLabel = false, className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Show the label as visible text before the buttons (otherwise it names the group only). */
  showLabel?: boolean;
  className?: string;
}) {
  const group = (
    <div role="group" aria-label={label}
      className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted/60 p-1', !showLabel && className)}>
      {options.map(option => {
        const current = option.value === value;
        return <button key={option.value} type="button" aria-pressed={current} disabled={disabled || option.disabled}
          onClick={() => { if (!current) onChange(option.value); }}
          className={cn('min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
            current ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-background')}>
          {option.label}
        </button>;
      })}
    </div>
  );
  if (!showLabel) return group;
  return <div className={cn('min-w-0 space-y-2', className)}>
    <p aria-hidden="true" className="text-sm font-medium">{label}</p>
    {group}
  </div>;
}

/** Says what is missing next to a disabled primary button. */
export function DisabledHint({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="text-xs text-muted-foreground">{children}</p>;
}
