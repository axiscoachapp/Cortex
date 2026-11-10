import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Stethoscope, UsersRound, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useClinicAccess } from '@/features/reception/accessContext';
import { workspaceAt, workspacesFor } from '@/lib/workspaces';
import { cn } from '@/lib/utils';

const icons = { clinical: Stethoscope, reception: UsersRound, finance: Wallet };
export function WorkspaceMenu({ className, onNavigate }: { className?: string; onNavigate?: (path: string) => void }) {
  const access = useClinicAccess(), { pathname } = useLocation(), navigate = useNavigate();
  const items = workspacesFor(access), selected = workspaceAt(pathname);
  const current = items.find(item => item.id === selected) ?? items[0];
  if (!current) return null;
  const Icon = icons[current.id];
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" aria-label="Alternar área de trabalho" className={cn('min-h-12 h-auto justify-between gap-3 bg-card px-3 py-2 text-left', className)}>
        <span className="flex min-w-0 items-center gap-2.5"><Icon className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-[0.625rem] font-normal text-muted-foreground">Área de trabalho</span><span className="block text-sm font-semibold">{current.label}</span></span></span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
      <DropdownMenuLabel className="px-2 py-2 text-xs text-muted-foreground">{access?.admin ? 'Visão de administrador' : 'Suas áreas de trabalho'}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {items.map(item => {
        const AreaIcon = icons[item.id];
        return <DropdownMenuItem key={item.id} onSelect={() => (onNavigate ?? navigate)(item.to)} className="min-h-14 items-start gap-3 rounded-lg px-3 py-3">
          <AreaIcon className="mt-1 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.description}</span></span>
          {item.id === selected && <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-label="Área atual" />}
        </DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}
