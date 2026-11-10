import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Settings2, Share2, Shield, ShieldCheck, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { cn } from '@/lib/utils';
import { useClinicAccess } from '@/features/reception/accessContext';
import { ProfessionalSettingsForm } from '@/features/settings/ProfessionalSettingsForm';
import { ClinicSetupSummary } from '@/features/settings/ClinicSetupSummary';
import { WhatsAppSettings } from '@/features/settings/WhatsAppSettings';
import { ConnectionsSettings } from '@/features/settings/ConnectionsSettings';
import { settingsSections, type SettingsSection, type SectionId } from '@/features/settings/sections';
import { IntakeFormEditor } from '@/features/intake/IntakeFormEditor';
import TeamSettings from '@/features/reception/TeamSettings';
import DelegationPermissions from '@/features/reception/DelegationPermissions';

function LinkCard({ to, icon: Icon, title, description }: { to: string; icon: typeof Settings2; title: string; description: string }) {
  return <Link to={to} className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="mt-1 h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 flex-1 space-y-2"><span className="block font-medium">{title}</span><span className="block text-sm leading-relaxed text-muted-foreground">{description}</span></span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></Link>;
}
function Overview({ sections, onSelect }: { sections: SettingsSection[]; onSelect: (id: SectionId) => void }) {
  const groups = [...new Set(sections.filter(item => item.id !== 'inicio').map(item => item.group))];
  return <div className="space-y-7">
    <div className="hidden rounded-2xl border bg-primary/5 p-5 md:block md:p-6"><p className="font-semibold">Implantação assistida pela equipe Cortex</p><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Especialidade, dados do prescritor e conexões técnicas são preparados na implantação. Aqui você encontra as preferências do atendimento, a rotina da equipe e a segurança da sua conta.</p></div>
    <p className="rounded-xl border bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground md:hidden">A configuração técnica da clínica é cuidada pela equipe de implantação.</p>
    {groups.map(group => <section key={group} className="space-y-3"><h3 className="text-sm font-semibold">{group}</h3><div className="grid gap-3 md:grid-cols-2">{sections.filter(item => item.group === group).map(({ id, label, description, icon: Icon }) => <button key={id} type="button" onClick={() => onSelect(id)} className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="mt-1 h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 flex-1 space-y-2"><span className="block text-sm font-semibold">{label}</span><span className="block text-sm leading-relaxed text-muted-foreground">{description}</span></span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></button>)}</div></section>)}
  </div>;
}
export default function SettingsPage() {
  const navigate = useNavigate(), [params, setParams] = useSearchParams(), access = useClinicAccess();
  const clinical = access?.kind === 'clinical', reception = access?.kind === 'reception', admin = !!access?.active && !!access.clinic && access.admin;
  const sections = settingsSections(access);
  const groups = [...new Set(sections.map(section => section.group))];
  const current = sections.find(section => section.id === params.get('secao')) ?? sections[0];
  const select = (id: SectionId) => setParams(previous => { const next = new URLSearchParams(previous); next.set('secao', id); return next; }, { replace: true });
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm"><div className="mx-auto flex max-w-[100rem] items-center justify-between gap-4 px-4 py-4 md:px-8"><div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Voltar" onClick={() => navigate(reception ? '/recepcao' : '/')}><ArrowLeft className="h-5 w-5" /></Button><div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">Configurações</h1><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{access?.clinic?.name ?? 'Seu ambiente Cortex'}</p></div></div><div className="hidden md:block"><WorkspaceMenu /></div></div></header>
    <div className="mx-auto max-w-[100rem] gap-8 px-4 py-6 md:px-8 xl:grid xl:grid-cols-[16rem_minmax(0,1fr)] xl:py-8">
      <nav aria-label="Seções das configurações" className="mb-6 xl:mb-0">
        <div className="space-y-2 xl:hidden"><label htmlFor="settings-section" className="text-xs font-medium text-muted-foreground">Acessar seção</label><select id="settings-section" value={current.id} onChange={event => select(event.target.value as SectionId)} className="min-h-12 w-full min-w-0 rounded-xl border bg-card px-3 py-3 text-sm">{groups.map(group => <optgroup key={group} label={group}>{sections.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></div>
        <div className="hidden max-h-[calc(100dvh-8rem)] space-y-6 overflow-y-auto pr-2 xl:sticky xl:top-28 xl:block">{groups.map(group => <div key={group} className="space-y-1"><p className="px-3 pb-2 text-[0.625rem] font-medium uppercase tracking-widest text-muted-foreground">{group}</p>{sections.filter(item => item.group === group).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => select(id)} aria-current={current.id === id ? 'page' : undefined} className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs', current.id === id ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-card')}><Icon className="h-4 w-4 shrink-0" />{label}</button>)}</div>)}</div>
      </nav>
      <main className="min-w-0 space-y-6" aria-label={current.label}>
        {!current.ownHeading && <div className={cn("space-y-2 border-b pb-5", current.id === "inicio" && "sr-only md:not-sr-only md:space-y-2 md:border-b md:pb-5")}><h2 className="text-2xl font-semibold tracking-tight">{current.label}</h2><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{current.description}</p></div>}
        {current.id === 'inicio' && <Overview sections={sections} onSelect={select} />}
        {current.id === 'perfil' && clinical && <ProfessionalSettingsForm />}
        {current.id === 'implantacao' && <ClinicSetupSummary />}
        {current.id === 'whatsapp' && <WhatsAppSettings key={`${access?.actorId}:${access?.clinic?.id}:${admin}`} />}
        {current.id === 'pre-consulta' && admin && <IntakeFormEditor key={`${access?.actorId}:${access?.clinic?.id}`} />}
        {current.id === 'conexoes' && clinical && <ConnectionsSettings clinical />}
        {current.id === 'equipe' && admin && <TeamSettings embedded />}
        {current.id === 'permissoes' && clinical && <DelegationPermissions embedded />}
        {current.id === 'usuarios' && clinical && <div className="grid gap-3 md:grid-cols-2">{admin && <LinkCard to="/compartilhamento" icon={UserCog} title="Contas de médicos" description="Acompanhe os médicos da clínica e os acessos autorizados pela administração." />}<LinkCard to="/compartilhamento" icon={Share2} title="Compartilhamento entre médicos" description="Compartilhe prontuários de forma explícita e revogável. Fazer parte da clínica não libera acesso automático." /></div>}
        {current.id === 'seguranca' && <div className="grid gap-3 md:grid-cols-2"><LinkCard to="/seguranca" icon={ShieldCheck} title="Segurança da conta" description="Sua senha e seu segundo fator são pessoais. A implantação não precisa conhecer essas credenciais." />{clinical && <LinkCard to="/privacidade" icon={Shield} title="Privacidade e dados" description="Consulte as opções de exportação e de solicitação de exclusão dos seus dados." />}</div>}
        {current.id === 'sobre' && <section className="space-y-4 rounded-2xl border bg-card p-5 md:p-6"><p className="text-lg font-semibold">Cortex</p><p className="text-sm leading-relaxed text-muted-foreground">Prontuário, consulta, documentos, agenda e recepção para clínicas. Todo rascunho gerado por IA precisa da revisão do médico.</p><div className="flex flex-wrap gap-4 text-sm"><Link to="/sobre" className="inline-flex min-h-11 items-center text-primary underline">Sobre o ambiente</Link><Link to="/aviso-de-privacidade" className="inline-flex min-h-11 items-center text-primary underline">Aviso de privacidade</Link></div></section>}
      </main>
    </div>
  </div>;
}
