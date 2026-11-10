import { Link, NavLink, Outlet, matchRoutes, useLocation } from 'react-router-dom';
import { BarChart3, CalendarDays, ChevronLeft, ClipboardCheck, ContactRound, Inbox, LogOut, Settings2, UsersRound, Wallet } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';

const routine = [
  { to: '/recepcao', label: 'Atendimentos', icon: Inbox },
  { to: '/recepcao/agenda', label: 'Agenda da equipe', icon: CalendarDays },
  { to: '/recepcao/contatos', label: 'Contatos', icon: ContactRound },
  { to: '/recepcao/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck },
];
const management = [
  { to: '/recepcao/financeiro', label: 'Financeiro', icon: Wallet },
  { to: '/recepcao/painel', label: 'Indicadores', icon: BarChart3 },
];
export default function ReceptionLayout() {
  const access = useClinicAccess(), { pathname } = useLocation();
  const { signOut } = useAuth();
  const groups = [{ label: 'Rotina da recepção', items: routine }, { label: 'Gestão', items: [...management, ...(access?.admin ? [{ to: '/recepcao/equipe', label: 'Equipe e permissões', icon: UsersRound }] : [])] }];
  const all = groups.flatMap(group => group.items);
  const current = matchRoutes(all.map(item => ({ path: item.to, id: item.label })), pathname)?.at(-1)?.route.id ?? 'Recepção';
  const exit = () => { if (confirmSessionExit()) void signOut(); };
  return <div className="min-h-full bg-background xl:grid xl:grid-cols-[15rem_minmax(0,1fr)]">
    <aside className="hidden border-r bg-sidebar xl:sticky xl:top-0 xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-y-auto">
      <div className="space-y-5 px-4 pb-4 pt-6"><Link to="/recepcao" aria-label="Haddad Nicola — Recepção"><BrandLockup compact /></Link><WorkspaceMenu className="w-full" /></div>
      <nav aria-label="Recepção" className="flex-1 space-y-6 px-3 py-4">
        {groups.map(group => <div key={group.label} className="space-y-1"><p className="px-3 pb-2 text-[0.625rem] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>{group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}><Icon className="h-4 w-4 shrink-0" />{label}</NavLink>)}</div>)}
      </nav>
      <div className="space-y-1 border-t p-3">
        {access?.kind === 'clinical' && <Link to="/" aria-label="Ambiente médico" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-xs text-muted-foreground hover:bg-card"><ChevronLeft className="h-4 w-4" />Voltar ao consultório</Link>}
        <NavLink to="/configuracoes" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-xs text-muted-foreground hover:bg-card"><Settings2 className="h-4 w-4" />Configurações</NavLink>
        <Button variant="ghost" className="min-h-11 w-full justify-start gap-3 px-3 text-xs text-muted-foreground" onClick={exit}><LogOut className="h-4 w-4" />Sair</Button>
      </div>
    </aside>
    <div className="min-w-0">
      <header className="border-b bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 xl:hidden"><Link to="/recepcao" aria-label="Haddad Nicola — Recepção" className="hidden sm:block"><BrandLockup compact className="[&_img]:w-24 [&_p]:hidden" /></Link><div className="flex items-center gap-2"><WorkspaceMenu /><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Sair" onClick={exit}><LogOut className="h-4 w-4" /></Button></div></div>
        <div className="hidden min-h-10 items-center justify-between gap-3 xl:flex"><p className="text-xs text-muted-foreground">Recepção <span className="mx-2 text-border">/</span><span className="font-medium text-foreground">{current}</span></p><p className="text-xs text-muted-foreground">{access?.clinic?.name}</p></div>
      </header>
      <main className="mx-auto max-w-[100rem] p-4 md:p-6 xl:p-8"><Outlet /></main>
    </div>
  </div>;
}
