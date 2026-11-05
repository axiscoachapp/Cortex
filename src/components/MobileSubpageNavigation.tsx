import { NavLink, useLocation } from 'react-router-dom';
import { Home, Users, CalendarDays, ClipboardList, Menu, Sparkles, FileStack, BookOpen, Share2, Shield } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useClinicAccess } from '@/features/reception/accessContext';
import { useAuth } from '@/contexts/AuthContext';

const main=[{to:'/',label:'Início',icon:Home},{to:'/gerenciar-pacientes',label:'Pacientes',icon:Users},{to:'/agenda',label:'Agenda',icon:CalendarDays},{to:'/trabalho',label:'Pendências',icon:ClipboardList}];
const more=[{to:'/assistente',label:'Assistente',icon:Sparkles},{to:'/modelos',label:'Modelos',icon:FileStack},{to:'/conhecimento',label:'Conhecimento',icon:BookOpen},{to:'/compartilhamento',label:'Compartilhamento',icon:Share2},{to:'/permissoes-recepcao',label:'Permissões da recepção',icon:Users},{to:'/seguranca',label:'Segurança da conta',icon:Shield},{to:'/privacidade',label:'Privacidade e dados',icon:Shield}];
export function MobileSubpageNavigation() {
  const {pathname}=useLocation();
  const access=useClinicAccess();const {user}=useAuth();
  if(pathname==='/')return null;
  const reception=pathname.startsWith('/recepcao')||access?.kind==='reception'||user?.app_metadata?.account_type==='reception';
  const items=reception?[
    {to:'/recepcao',label:'Fila',icon:ClipboardList},
    {to:'/recepcao/agenda',label:'Agenda',icon:CalendarDays},
    {to:'/recepcao/contatos',label:'Contatos',icon:Users},
    ...(access?.admin?[{to:'/recepcao/equipe',label:'Equipe',icon:Users}]:[]),
    {to:'/seguranca',label:'Conta',icon:Shield},
  ]:main;
  return <nav aria-label="Navegação principal" className="xl:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur-sm" style={{height:'calc(4rem + env(safe-area-inset-bottom))',paddingBottom:'env(safe-area-inset-bottom)'}}>
    <div className="flex h-16 items-stretch px-1">
      {items.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'||to==='/recepcao'} className={({isActive})=>cn('flex-1 flex flex-col items-center justify-center gap-1 rounded-lg text-[0.6875rem] min-h-11',isActive?'bg-primary/10 text-primary':'text-muted-foreground')}><Icon className="h-4 w-4"/>{label}</NavLink>)}
      {!reception&&<DropdownMenu><DropdownMenuTrigger className="flex-1 flex flex-col items-center justify-center gap-1 rounded-lg text-[0.6875rem] text-muted-foreground min-h-11" aria-label="Mais páginas"><Menu className="h-4 w-4"/>Mais</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">{more.map(({to,label,icon:Icon})=><DropdownMenuItem key={to} asChild><NavLink to={to}><Icon className="h-4 w-4 mr-2"/>{label}</NavLink></DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>}
    </div>
  </nav>;
}
