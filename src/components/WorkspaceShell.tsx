import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, ContactRound, FileStack, Home, Inbox, LogOut, Settings2, ShieldCheck, Sparkles, UsersRound, Wallet, type LucideIcon } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from '@/features/reception/accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { isReceptionPath, workspaceAt, workspacesFor } from '@/lib/workspaces';
import { cn } from '@/lib/utils';

type NavigationItem = { to: string; label: string; icon: LucideIcon };
type NavigationGroup = { label: string; items: NavigationItem[] };
type WorkspaceShellProps = {
  children: ReactNode;
  section: string;
  contentClassName?: string;
  shellClassName?: string;
};

const clinicalRoutine: NavigationItem[] = [
  { to: '/', label: 'Início', icon: Home },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/gerenciar-pacientes', label: 'Pacientes', icon: UsersRound },
];
const clinicalResources: NavigationItem[] = [
  { to: '/assistente', label: 'Assistente', icon: Sparkles },
  { to: '/modelos', label: 'Modelos', icon: FileStack },
  { to: '/conhecimento', label: 'Conhecimento', icon: BookOpen },
];
const receptionRoutine: NavigationItem[] = [
  { to: '/recepcao', label: 'Atendimentos', icon: Inbox },
  { to: '/recepcao/agenda', label: 'Agenda da equipe', icon: CalendarDays },
  { to: '/recepcao/contatos', label: 'Contatos', icon: ContactRound },
  { to: '/recepcao/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck },
];

/** Navigation and presentation only; mounts no clinical readers or authorization. */
export function WorkspaceShell({ children, section, contentClassName, shellClassName }: WorkspaceShellProps) {
  const access = useClinicAccess();
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const reception = access?.kind === 'reception' || isReceptionPath(pathname);
  const operational = !!access?.active && !!access.clinic;
  const workspaces = workspacesFor(access);
  const workspace = workspaces.find(item => item.id === workspaceAt(pathname)) ?? workspaces[0];
  const home = reception ? '/recepcao' : '/';
  const groups: NavigationGroup[] = reception && operational ? [
    { label: 'Rotina da recepção', items: receptionRoutine },
    { label: 'Gestão', items: [
      { to: '/recepcao/financeiro', label: 'Financeiro', icon: Wallet },
      { to: '/recepcao/painel', label: 'Indicadores', icon: BarChart3 },
      ...(access.admin ? [{ to: '/recepcao/equipe', label: 'Equipe e permissões', icon: UsersRound }] : []),
    ] },
  ] : access?.kind === 'clinical' ? [
    { label: 'Consultório', items: clinicalRoutine },
    { label: 'Ferramentas', items: clinicalResources },
    ...(operational ? [{ label: 'Clínica', items: [
      { to: '/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck },
      { to: '/financeiro', label: 'Financeiro', icon: Wallet },
      ...(access.admin ? [{ to: '/recepcao', label: 'Recepção', icon: UsersRound }] : []),
    ] }] : []),
  ] : [];
  const exit = () => { if (confirmSessionExit()) void signOut(); };
  // On a short screen the middle list scrolls under the pinned footer: keep the
  // current page's item in view instead of hidden behind "Configurações".
  const routine = useRef<HTMLElement>(null);
  useEffect(() => { routine.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' }); }, [pathname]);
  return (
    <div className={cn('min-h-screen bg-background shell:grid shell:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]', shellClassName)}>
      <aside aria-label="Navegação do ambiente" className="hidden border-r bg-sidebar shell:sticky shell:top-0 shell:flex shell:h-[100dvh] shell:flex-col shell:overflow-y-auto">
        <div className="shrink-0 space-y-3 px-3 pb-3 pt-4 xl:space-y-5 xl:px-4 xl:pb-4 xl:pt-6">
          <Link to={home} aria-label="Haddad Nicola — Início" className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><BrandLockup compact className="[&_p]:hidden xl:[&_p]:block" /></Link>
          <WorkspaceMenu className="w-full" />
        </div>
        <nav ref={routine} aria-label={reception ? 'Recepção' : 'Consultório'} className="workspace-nav-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {groups.map(group => <div key={group.label} className="space-y-1">
            <p className="px-3 pb-2 text-[0.625rem] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>
            {group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => cn('workspace-nav-item', isActive && 'workspace-nav-item-active')}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</NavLink>)}
          </div>)}
        </nav>
        <nav aria-label="Conta e preferências" className="shrink-0 space-y-1 border-t p-2 xl:p-3">
          {[{ to: '/configuracoes', label: 'Configurações', icon: Settings2 }, { to: '/seguranca', label: 'Segurança da conta', icon: ShieldCheck }].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => cn('workspace-nav-item', isActive && 'workspace-nav-item-active')}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</NavLink>)}
          <Button variant="ghost" className="workspace-nav-item h-auto w-full justify-start font-normal" onClick={exit}><LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />Sair</Button>
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="border-b bg-card">
          <div className="mx-auto flex min-h-16 max-w-[100rem] shell:min-h-12 shell:py-2 xl:min-h-16 xl:py-3 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:px-6 xl:px-8">
            <div className="hidden min-w-0 items-center gap-2 text-xs shell:flex">
              {workspace?.label !== section && <><span className="text-muted-foreground">{workspace?.label ?? 'Sua conta'}</span><span className="text-border" aria-hidden="true">/</span></>}<span className="font-medium [overflow-wrap:anywhere]">{section}</span>
            </div>
            <div className="flex min-w-0 items-center gap-3 shell:hidden"><WorkspaceMenu />{!workspace && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Sua conta</span>}</div>
            <p className="hidden text-xs text-muted-foreground md:block [overflow-wrap:anywhere]">{access?.clinic?.name ?? 'Cortex · Ambiente clínico'}</p>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 shell:hidden" aria-label="Sair" onClick={exit}><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className={cn('mx-auto w-full min-w-0 max-w-[100rem] space-y-6 p-4 md:p-6 xl:p-8', contentClassName)}>{children}</main>
      </div>
    </div>
  );
}
