// Small pieces shared by the finance tabs.
import { useEffect, useRef, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  partial: 'bg-violet-100 text-violet-900 hover:bg-violet-100',
  denied: 'bg-destructive/10 text-destructive hover:bg-destructive/10',
  cancelled: 'bg-transparent text-muted-foreground border hover:bg-transparent',
};
export const StatusBadge = ({ status }: { status: ChargeStatus }) => <Badge className={cn('whitespace-nowrap', STATUS_STYLE[status])}>{STATUS_LABELS[status]}</Badge>;

/** Label + control + optional hint, with the ids wired for screen readers. */
export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-2 [&>label]:block sm:[&>label]:min-h-[2.5em] sm:[&>label]:flex sm:[&>label]:items-end', className)}>
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
      <p className={cn('mt-0.5 whitespace-nowrap text-lg font-semibold leading-snug tabular-nums sm:text-2xl', tone === 'good' && 'text-primary', tone === 'bad' && 'text-destructive')}>{value}</p>
    </div>
  );
}

export const DIALOG_CLASS = 'w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto rounded-2xl p-5 md:p-6 [&>*]:min-w-0 [&>div:first-child]:text-left [&>div:first-child]:pr-8 [&_input]:min-h-11 [&_button[role=combobox]]:min-h-11 [&_form]:space-y-4 [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:right-1 [&>button:last-child]:top-1 [&>button:last-child]:grid [&>button:last-child]:place-items-center';

/** Grid of Stat cards: one per row on a narrow phone, so a value never breaks mid-number. */
export const STAT_GRID = 'grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-4';

/**
 * The error of a dialog, right above its footer, focused when it appears. When someone else changed
 * the record first (stale), it offers to reload it and send again with what the person typed.
 */
export function DialogError({ message, stale, onRetry, retrying }: { message: string; stale?: boolean; onRetry?: () => void; retrying?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  if (!message) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive outline-none">
      <p>{stale ? 'Outra pessoa alterou este registro enquanto você preenchia. O que você digitou foi mantido.' : message}</p>
      {stale && onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}Atualizar e tentar de novo
        </Button>
      )}
    </div>
  );
}
