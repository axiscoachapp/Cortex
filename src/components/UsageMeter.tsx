import { Gauge } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

interface UsageMeterProps {
  /** 'inline': the chat composer. 'pill' is no longer shown: AI usage is not
   *  patient data, so it stays out of the patient's profile. */
  variant?: 'pill' | 'inline';
  className?: string;
}

/** Below this the doctor does not need to think about AI usage at all. */
export const USAGE_VISIBLE_FROM_PERCENT = 80;

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
  const { data, isLoading, isError } = useUsage(user?.id);

  if (variant === 'pill' || !user?.id || isLoading || isError || !data) return null;

  const { used, limit, percent, resetsInHours, level } = data;
  if (percent < USAGE_VISIBLE_FROM_PERCENT) return null;
  const style = levelStyles[level];

  const tooltipBody = (
    <div className="space-y-1 text-xs">
      <p className="font-semibold">{levelLabel[level]}</p>
      <p className="text-muted-foreground">
        {Math.round(used)} de {limit} créditos de IA usados hoje. Renova em cerca de {resetsInHours} h.
      </p>
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.6875rem] font-medium border transition-colors',
              style.ring, style.text, className,
            )}
          >
            <Gauge className="w-3 h-3" />
            <span>Uso de IA hoje: <span className="tabular-nums">{percent}%</span></span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipBody}</TooltipContent>
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
