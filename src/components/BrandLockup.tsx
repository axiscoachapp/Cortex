import { cn } from '@/lib/utils';
export function BrandLockup({className,compact=false}:{className?:string;compact?:boolean}) {
  return <div className={cn('min-w-0',className)}>
    <img src="/brand/haddad-nicola.png" width="627" height="152" alt="Haddad Nicola — Consultório Médico" className={cn('h-auto object-contain',compact?'w-44':'w-64')} />
    <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cortex · Ambiente clínico</p>
  </div>;
}
