import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Home, Users, CalendarDays, ClipboardList, ClipboardCheck, Menu, Sparkles, FileStack, BookOpen, Settings2, Shield, Wallet } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { isReceptionPath } from '@/lib/workspaces';
import { useClinicAccess } from '@/features/reception/accessContext';
import { useAuth } from '@/contexts/AuthContext';

const main = [{ to: '/', label: 'Início', icon: Home }, { to: '/agenda', label: 'Agenda', icon: CalendarDays }, { to: '/gerenciar-pacientes', label: 'Pacientes', icon: Users }];
const resources = [{ to: '/assistente', label: 'Assistente', icon: Sparkles }, { to: '/modelos', label: 'Modelos', icon: FileStack }, { to: '/conhecimento', label: 'Conhecimento', icon: BookOpen }];
export function MobileSubpageNavigation() {
  const { pathname } = useLocation(), access = useClinicAccess(), { user } = useAuth();
  if (pathname === '/') return null;
  const reception = isReceptionPath(pathname) || access?.kind === 'reception' || user?.app_metadata?.account_type === 'reception';
  const items = reception ? [{ to: '/recepcao', label: 'Atendimentos', icon: ClipboardList }, { to: '/recepcao/agenda', label: 'Agenda', icon: CalendarDays }, { to: '/recepcao/contatos', label: 'Contatos', icon: Users }] : main;
  const more = reception ? [
    { to: '/recepcao/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck },
    { to: '/recepcao/financeiro', label: 'Financeiro', icon: Wallet },
    { to: '/recepcao/painel', label: 'Indicadores', icon: BarChart3 },
    ...(access?.admin ? [{ to: '/recepcao/equipe', label: 'Equipe da recepção', icon: Users }] : []),
  ] : [...(access?.active && access.clinic ? [{ to: '/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck }, { to: '/financeiro', label: 'Financeiro', icon: Wallet }, ...(access.admin ? [{ to: '/recepcao', label: 'Recepção', icon: Users }] : [])] : []), ...resources];
  return <nav aria-label="Navegação principal" className="shell:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur-sm" style={{ height: 'calc(4rem + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <div className="flex h-16 items-stretch gap-1 px-1">
      {items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/' || to === '/recepcao'} className={({ isActive }) => cn('min-w-0 flex-1 flex flex-col items-center justify-center gap-1 rounded-lg text-[0.625rem] min-h-11', isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}><Icon className="h-4 w-4" />{label}</NavLink>)}
      <DropdownMenu><DropdownMenuTrigger className="min-w-0 flex-1 flex flex-col items-center justify-center gap-1 rounded-lg text-[0.625rem] text-muted-foreground min-h-11" aria-label="Mais páginas"><Menu className="h-4 w-4" />Mais</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="max-h-[75dvh] w-64 overflow-y-auto p-2"><DropdownMenuLabel className="text-xs text-muted-foreground">{reception ? 'Recepção e gestão' : 'Mais do consultório'}</DropdownMenuLabel>{more.map(({ to, label, icon: Icon }) => <DropdownMenuItem key={to} asChild className="min-h-11"><NavLink to={to}><Icon className="mr-2 h-4 w-4" />{label}</NavLink></DropdownMenuItem>)}<DropdownMenuSeparator />
          {[{ to: '/configuracoes', label: 'Configurações', icon: Settings2 }, { to: '/seguranca', label: 'Segurança da conta', icon: Shield }].map(({ to, label, icon: Icon }) => <DropdownMenuItem key={to} asChild className="min-h-11"><NavLink to={to}><Icon className="mr-2 h-4 w-4" />{label}</NavLink></DropdownMenuItem>)}
          {reception && access?.kind === 'clinical' && <DropdownMenuItem asChild className="min-h-11"><NavLink to="/"><Home className="mr-2 h-4 w-4" />Voltar ao consultório</NavLink></DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </nav>;
}
