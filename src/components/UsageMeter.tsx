import { Gauge } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

interface UsageMeterProps {
  /** Compact form for tight spots (chat input dock). */
  variant?: 'pill' | 'inline';
  className?: string;
}

const levelStyles = {
  safe:     { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/30' },
  warn:     { bar: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-400',     ring: 'border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30' },
  critical: { bar: 'bg-orange-600',  text: 'text-orange-700 dark:text-orange-400',   ring: 'border-orange-500/40 bg-orange-50/60 dark:bg-orange-950/30' },
  over:     { bar: 'bg-destructive', text: 'text-destructive',                       ring: 'border-destructive/40 bg-destructive/10' },
} as const;

const levelLabel = {
  safe:     'Uso normal',
  warn:     'Uso elevado',
  critical: 'Próximo do limite',
  over:     'Limite atingido',
} as const;

export function UsageMeter({ variant = 'pill', className }: UsageMeterProps) {
  const { user } = useAuth();
  const { data, isLoading } = useUsage(user?.id);

  if (!user?.id || isLoading || !data) return null;

  const { used, limit, percent, remaining, resetsInHours, level } = data;
  const style = levelStyles[level];
  const widthPct = Math.min(100, percent);
  const usdSpent = (used * 0.001).toFixed(2);
  const usdCap   = (limit * 0.001).toFixed(2);

  const tooltipBody = (
    <div className="space-y-1.5 text-xs">
      <p className="font-semibold">{levelLabel[level]}</p>
      <p className="text-muted-foreground">
        {Math.round(used)} de {limit} créditos hoje ({percent}%)
      </p>
      <div className="pt-1 mt-1 border-t border-border/60 space-y-0.5 text-[11px] text-muted-foreground">
        <p>1 crédito ≈ US$ 0,001 de custo Gemini</p>
        <p>Equivalente: US$ {usdSpent} de US$ {usdCap}</p>
        <p>Reseta em ~{resetsInHours}h (00:00 UTC)</p>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
                style.ring, style.text, className,
              )}
            >
              <Gauge className="w-3 h-3" />
              <span className="tabular-nums">{Math.round(used)}/{limit}</span>
              <span className="hidden sm:inline opacity-70">·</span>
              <span className="hidden sm:inline opacity-70">{percent}%</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltipBody}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // pill variant — used in drawer header
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full border min-w-[180px] transition-colors hover:opacity-90',
              style.ring, className,
            )}
          >
            <Gauge className={cn('w-3.5 h-3.5 shrink-0', style.text)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className={cn('text-[10px] font-semibold uppercase tracking-wider', style.text)}>
                  Limite diário
                </span>
                <span className={cn('text-[10px] tabular-nums font-medium', style.text)}>
                  {Math.round(used)}/{limit}
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-full transition-all', style.bar)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
            <span className={cn('text-[10px] font-semibold tabular-nums shrink-0', style.text)}>
              {percent}%
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">{tooltipBody}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Compact label used inside chat banners when the user has hit 100%. */
export function UsageOverBanner() {
  const { user } = useAuth();
  const { data } = useUsage(user?.id);
  if (!data || data.level !== 'over') return null;
  return (
    <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-center gap-2">
      <Gauge className="w-3.5 h-3.5 shrink-0" />
      <span>
        Limite diário atingido ({Math.round(data.used)}/{data.limit} créditos).
        Reseta em ~{data.resetsInHours}h.
      </span>
    </div>
  );
}
