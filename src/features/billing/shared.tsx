// Small pieces shared by the finance tabs.
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, type ChargeStatus } from './billingApi';

/** Loading, error with retry, or the content. */
export function QueryState({ query, children, empty }: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
  empty?: ReactNode;
}) {
  if (query.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {(query.error as Error)?.message ?? 'Não foi possível carregar.'}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>Tentar novamente</button>
      </p>
    );
  }
  return <>{empty ?? children}</>;
}

const STATUS_STYLE: Record<ChargeStatus, string> = {
  open: 'bg-[#F2B23E]/20 text-[#0E2A33] hover:bg-[#F2B23E]/20',
  batched: 'bg-muted text-foreground hover:bg-muted',
  sent: 'bg-sky-100 text-sky-900 hover:bg-sky-100',
  paid: 'bg-primary/15 text-primary hover:bg-primary/15',
  partial: 'bg-amber-100 text-amber-900 hover:bg-amber-100',
  denied: 'bg-destructive/10 text-destructive hover:bg-destructive/10',
  cancelled: 'bg-transparent text-muted-foreground border hover:bg-transparent',
};
export const StatusBadge = ({ status }: { status: ChargeStatus }) => <Badge className={cn('whitespace-nowrap', STATUS_STYLE[status])}>{STATUS_LABELS[status]}</Badge>;

/** Label + control + optional hint, with the ids wired for screen readers. */
export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Summary card used in Caixa and Relatórios. */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 rounded-xl border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 whitespace-nowrap text-[15px] font-semibold leading-tight tabular-nums sm:text-lg', tone === 'good' && 'text-primary', tone === 'bad' && 'text-destructive')}>{value}</p>
    </div>
  );
}

export const DIALOG_CLASS = 'w-[calc(100vw-1.5rem)] max-h-[90vh] grid-cols-1 overflow-y-auto overflow-x-hidden [&>*]:min-w-0';
