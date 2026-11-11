import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, BookOpen, CalendarDays, Check, ClipboardCheck, ContactRound, FileStack, Home, Inbox, LogOut, Menu,
  Settings2, ShieldCheck, Sparkles, Stethoscope, UsersRound, Wallet, type LucideIcon,
} from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { SignOutButton, SignOutDialog } from '@/components/SignOutDialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from '@/features/reception/accessContext';
import { isReceptionPath, workspaceAt, workspacesFor, type WorkspaceId } from '@/lib/workspaces';
import { cn } from '@/lib/utils';

export type NavigationItem = { to: string; label: string; icon: LucideIcon };
type NavigationGroup = { label: string; items: NavigationItem[] };

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
const account: NavigationItem[] = [
  { to: '/configuracoes', label: 'Configurações', icon: Settings2 },
  { to: '/seguranca', label: 'Segurança da conta', icon: ShieldCheck },
];
const areaIcons: Record<WorkspaceId, LucideIcon> = { clinical: Stethoscope, reception: UsersRound, finance: Wallet };

/**
 * One navigation model for the sidebar and the phone bar. Visibility follows the
 * verified clinic access only; every destination keeps its own server-backed gate.
 * Unknown access (account pages outside the clinic gate) offers only the way home.
 */
export function useAppNavigation() {
  const access = useClinicAccess();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const operational = !!access?.active && !!access.clinic;
  // A clinic admin inside /recepcao sees the reception navigation; anyone else keeps their own.
  const reception = access ? access.kind === 'reception' || (operational && isReceptionPath(pathname)) : user?.app_metadata?.account_type === 'reception';
  const home = reception ? '/recepcao' : '/';
  const groups: NavigationGroup[] = !access ? [] : reception && operational ? [
    { label: 'Rotina da recepção', items: receptionRoutine },
    { label: 'Gestão', items: [
      { to: '/recepcao/financeiro', label: 'Financeiro', icon: Wallet },
      { to: '/recepcao/painel', label: 'Indicadores', icon: BarChart3 },
      ...(access.admin ? [{ to: '/recepcao/equipe', label: 'Equipe da recepção', icon: UsersRound }] : []),
    ] },
  ] : access.kind === 'clinical' ? [
    { label: 'Consultório', items: clinicalRoutine },
    { label: 'Ferramentas', items: clinicalResources },
    ...(operational ? [{ label: 'Clínica', items: [
      { to: '/pre-consultas', label: 'Pré-consultas', icon: ClipboardCheck },
      { to: '/financeiro', label: 'Financeiro', icon: Wallet },
      ...(access.admin ? [{ to: '/recepcao', label: 'Recepção', icon: UsersRound }] : []),
    ] }] : []),
  ] : [];
  const workspaces = workspacesFor(access);
  const workspace = workspaces.find(item => item.id === workspaceAt(pathname)) ?? workspaces[0];
  // The phone bar keeps the three daily destinations; the rest goes to "Mais".
  const all = groups.flatMap(group => group.items);
  const primaryPaths = reception ? ['/recepcao', '/recepcao/agenda', '/recepcao/contatos'] : ['/', '/agenda', '/gerenciar-pacientes'];
  const primary = all.filter(item => primaryPaths.includes(item.to)).map(item => item.to === '/recepcao/agenda' ? { ...item, label: 'Agenda' } : item);
  const more = all.filter(item => !primaryPaths.includes(item.to));
  return { access, reception, home, groups, workspaces, workspace, primary, more, pathname };
}

const itemClass = ({ isActive }: { isActive: boolean }) => cn('workspace-nav-item', isActive && 'workspace-nav-item-active');

type HomeControl = {
  /** On the home page, "Início" returns to the dashboard without leaving the route (the consultation stays mounted). */
  onHome?: () => void;
  homeActive?: boolean;
};

function HomeItem({ item, onHome, homeActive, className }: HomeControl & { item: NavigationItem; className?: string }) {
  const Icon = item.icon;
  if (onHome) return <button type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined} className={cn('workspace-nav-item w-full text-left', homeActive && 'workspace-nav-item-active', className)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label}</button>;
  return <NavLink to={item.to} end className={state => cn(itemClass(state), className)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label}</NavLink>;
}

/** Desktop sidebar (from the `shell` frame up): same items, order, width and footer on every page. */
export function AppSidebar({ onHome, homeActive, children, className }: HomeControl & { children?: ReactNode; className?: string }) {
  const { access, reception, home, groups, pathname } = useAppNavigation();
  // On a short screen the list scrolls under the pinned footer: keep the
  // current page's item in view instead of hidden behind "Configurações".
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' }); }, [pathname, homeActive]);
  return <aside aria-label="Navegação do ambiente" className={cn('hidden h-[100dvh] w-[13rem] shrink-0 flex-col border-r bg-sidebar shell:sticky shell:top-0 shell:flex xl:w-[15rem]', className)}>
    <div className="shrink-0 space-y-3 px-3 pb-3 pt-4 xl:space-y-4 xl:px-4 xl:pb-4 xl:pt-5">
      <Link to={home} aria-label={`${access?.clinic?.name ?? 'Cortex'} — Início`} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BrandLockup compact className="[&_p]:hidden" />
        <span className="mt-1 hidden text-[0.625rem] text-muted-foreground xl:block">com Cortex</span>
      </Link>
      <WorkspaceMenu className="w-full" />
    </div>
    <div ref={list} className="workspace-nav-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <nav aria-label={reception ? 'Recepção' : 'Consultório'} className="space-y-3">
        {!groups.length && <Link to={home} className="workspace-nav-item"><ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />Voltar ao início</Link>}
        {groups.map(group => <div key={group.label} className="space-y-0.5">
          <p className="px-3 pb-1 text-[0.625rem] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>
          {group.items.map(item => item.to === '/'
            ? <HomeItem key={item.to} item={item} onHome={onHome} homeActive={homeActive} />
            : <NavLink key={item.to} to={item.to} end className={itemClass}><item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label}</NavLink>)}
        </div>)}
      </nav>
      {children}
    </div>
    <nav aria-label="Conta e preferências" className="shrink-0 space-y-0.5 border-t p-2 xl:p-3">
      {account.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={itemClass}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</NavLink>)}
      <SignOutButton />
    </nav>
  </aside>;
}

const barItem = (active: boolean) => cn('flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[0.625rem]', active ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground');

/**
 * Phone bar (below the `shell` frame) on every route: the three daily destinations
 * and "Mais". `inline` sits in the page's own column (home); `fixed` pins it to the
 * viewport for subpages.
 */
export function MobileBottomBar({ onHome, homeActive, placement = 'fixed' }: HomeControl & { placement?: 'fixed' | 'inline' }) {
  const { home, primary, more, workspaces, workspace, groups } = useAppNavigation();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);
  const [signOut, setSignOut] = useState(false);
  const items = primary.length ? primary : [{ to: home, label: 'Início', icon: Home }];
  const go = (to: string) => { setSheet(false); navigate(to); };
  return <>
    <nav aria-label="Navegação principal" className={cn('shell:hidden border-t bg-background/95 backdrop-blur-sm', placement === 'fixed' ? 'fixed inset-x-0 bottom-0 z-30' : 'shrink-0')}
      style={placement === 'fixed' ? { height: 'calc(4rem + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' } : { paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex h-16 items-stretch gap-1 px-1">
        {items.map(({ to, label, icon: Icon }) => onHome && to === '/'
          ? <button key={to} type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined} className={barItem(!!homeActive)}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>
          : <NavLink key={to} to={to} end={to === '/' || to === '/recepcao' || !groups.length} className={({ isActive }) => barItem(isActive && !(onHome && to === '/'))}><Icon className="h-4 w-4" aria-hidden="true" />{label}</NavLink>)}
        <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet} aria-label="Mais páginas" className={barItem(false)}><Menu className="h-4 w-4" aria-hidden="true" />Mais</button>
      </div>
    </nav>
    <Sheet open={sheet} onOpenChange={setSheet}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <SheetHeader className="px-2 pr-12 text-left"><SheetTitle className="text-base">Mais</SheetTitle><SheetDescription className="sr-only">Outras páginas, área de trabalho e sua conta.</SheetDescription></SheetHeader>
        {workspaces.length > 1 && <section aria-label="Área de trabalho" className="mt-3 space-y-0.5 border-b pb-3">
          <p className="px-3 pb-1 text-[0.625rem] font-medium uppercase tracking-widest text-muted-foreground">Área de trabalho</p>
          {workspaces.map(area => { const Icon = areaIcons[area.id]; const current = area.id === workspace?.id;
            return <button key={area.id} type="button" onClick={() => go(area.to)} aria-current={current ? 'true' : undefined} className={cn('workspace-nav-item w-full text-left text-sm', current && 'workspace-nav-item-active')}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">{area.label}</span>{current && <Check className="h-4 w-4" aria-label="Área atual" />}
            </button>; })}
        </section>}
        {more.length > 0 && <nav aria-label="Outras páginas" className="mt-3 space-y-0.5 border-b pb-3">
          {more.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end onClick={() => setSheet(false)} className={state => cn(itemClass(state), 'text-sm')}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</NavLink>)}
        </nav>}
        <nav aria-label="Conta e preferências" className="mt-3 space-y-0.5">
          {account.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setSheet(false)} className={state => cn(itemClass(state), 'text-sm')}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</NavLink>)}
          <button type="button" onClick={() => { setSheet(false); setSignOut(true); }} className="workspace-nav-item w-full text-left text-sm"><LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />Sair</button>
        </nav>
      </SheetContent>
    </Sheet>
    <SignOutDialog open={signOut} onOpenChange={setSignOut} />
  </>;
}
