import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Info, KeyRound, Settings2, Share2, Shield, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';
import { useClinicAccess } from '@/features/reception/accessContext';
import { ProfessionalSettingsForm } from '@/features/settings/ProfessionalSettingsForm';
import { ClinicSetupSummary } from '@/features/settings/ClinicSetupSummary';
import { WhatsAppSettings } from '@/features/settings/WhatsAppSettings';
import { ConnectionsSettings } from '@/features/settings/ConnectionsSettings';
import { settingsSections, type SettingsSection, type SectionId } from '@/features/settings/sections';
import { IntakeFormEditor } from '@/features/intake/IntakeFormEditor';
import TeamSettings from '@/features/reception/TeamSettings';
import DelegationPermissions from '@/features/reception/DelegationPermissions';

const rowClass = 'group flex min-w-0 items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:p-5';

function LinkCard({ to, icon: Icon, title, description }: { to: string; icon: typeof Settings2; title: string; description: string }) {
  return <Link to={to} className={`${rowClass} rounded-xl border bg-card`}>
    <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
    <span className="min-w-0 flex-1 space-y-1"><span className="block text-sm font-semibold">{title}</span><span className="block text-sm leading-relaxed text-muted-foreground">{description}</span></span>
    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </Link>;
}

function Overview({ sections, clinical, onSelect }: { sections: SettingsSection[]; clinical: boolean; onSelect: (id: SectionId) => void }) {
  const groups = [...new Set(sections.filter(item => item.id !== 'inicio').map(item => item.group))];
  return <div className="space-y-6">
    <div className="grid items-start gap-6 md:grid-cols-2">
      {groups.map(group => <section key={group} className="min-w-0 space-y-3">
        <h2 className="text-sm font-semibold">{group}</h2>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {sections.filter(item => item.group === group).map(({ id, label, description, icon: Icon }) => <button key={id} type="button" onClick={() => onSelect(id)} className={`${rowClass} w-full`}>
            <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 space-y-1"><span className="block text-sm font-semibold">{label}</span><span className="block text-xs leading-relaxed text-muted-foreground">{description}</span></span>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>)}
        </div>
      </section>)}
    </div>
    <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{clinical ? 'Especialidade, dados de prescritor e as conexões técnicas da clínica são mantidos pela equipe Cortex. Para conferir os seus dados, abra ' : 'Convênios, preços e a conexão do WhatsApp são mantidos pela equipe Cortex. Para conferir, abra '}<button type="button" onClick={() => onSelect('implantacao')} className="font-medium text-primary underline underline-offset-2">{clinical ? 'Seu cadastro profissional' : 'Dados da clínica'}</button>.</p>
    </div>
  </div>;
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const access = useClinicAccess();
  const clinical = access?.kind === 'clinical';
  const admin = !!access?.active && !!access.clinic && access.admin;
  const sections = settingsSections(access);
  const groups = [...new Set(sections.map(section => section.group))];
  const requested = params.get('secao');
  const found = sections.find(section => section.id === requested);
  // An unknown or unavailable section says so instead of silently showing the overview.
  const unavailable = !!requested && !found;
  const current = found ?? sections[0];
  const overview = current.id === 'inicio';
  const select = (id: SectionId) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('secao', id);
    return next;
  }, { replace: true });

  // On the overview the cards already list every section; the picker helps only inside one.
  const sectionNavigation = overview ? undefined : <nav aria-label="Seções das configurações" className="w-full min-w-0 space-y-2 sm:w-80">
        <label htmlFor="settings-section" className="text-xs font-medium text-muted-foreground">Ir para outra seção</label>
        <select id="settings-section" value={current.id} onChange={event => select(event.target.value as SectionId)} className="min-h-11 w-full min-w-0 rounded-lg border bg-card px-3 py-2 text-sm">
          {groups.map(group => <optgroup key={group} label={group}>{sections.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
        </select>
    </nav>;

  return <WorkspaceShell section="Configurações">
    <PageHeading title={overview || current.ownHeading ? 'Configurações' : current.label} description={overview ? 'Suas preferências, a rotina da equipe e o que a equipe Cortex mantém para você.' : current.ownHeading ? undefined : current.description} actions={sectionNavigation} />
    {!overview && <Button variant="ghost" className="min-h-11 gap-2 px-2 text-xs text-muted-foreground" onClick={() => select('inicio')}><ArrowLeft className="h-4 w-4" />Todas as configurações</Button>}
    {unavailable && <p role="status" className="rounded-xl border border-[#F2B23E]/60 bg-[#F2B23E]/10 p-4 text-sm">Essa seção não existe ou não está disponível para a sua conta. Escolha uma das seções abaixo.</p>}
    <div className="min-w-0 space-y-6" role="region" aria-label={current.label}>
      {overview && <Overview sections={sections} clinical={clinical} onSelect={select} />}
      {current.id === 'perfil' && clinical && <ProfessionalSettingsForm />}
      {current.id === 'implantacao' && <ClinicSetupSummary />}
      {current.id === 'whatsapp' && <WhatsAppSettings key={`${access?.actorId}:${access?.clinic?.id}:${admin}`} />}
      {current.id === 'pre-consulta' && admin && <IntakeFormEditor key={`${access?.actorId}:${access?.clinic?.id}`} />}
      {current.id === 'conexoes' && clinical && <ConnectionsSettings clinical />}
      {current.id === 'equipe' && admin && <TeamSettings embedded />}
      {current.id === 'permissoes' && clinical && <DelegationPermissions embedded />}
      {/* One page holds both the clinic's doctors and chart sharing: one card, not two rows to the same place. */}
      {current.id === 'usuarios' && clinical && <div className="grid gap-3 md:grid-cols-2"><LinkCard to="/compartilhamento" icon={Share2} title={admin ? 'Médicos da clínica e compartilhamento' : 'Compartilhamento entre médicos'} description={admin ? 'Acompanhe os médicos da clínica e compartilhe prontuários de forma explícita e revogável. Fazer parte da clínica não libera acesso automático.' : 'Compartilhe prontuários de forma explícita e revogável. Fazer parte da clínica não libera acesso automático.'} /></div>}
      {current.id === 'seguranca' && <div className="grid gap-3 md:grid-cols-2">
        <LinkCard to="/seguranca#alterar-senha" icon={KeyRound} title="Alterar senha" description="Troque a sua senha informando a atual." />
        <LinkCard to="/seguranca" icon={ShieldCheck} title="Segundo fator" description="O aplicativo autenticador que confirma o seu acesso. Ninguém da equipe Cortex precisa conhecer essas credenciais." />
        {clinical && <LinkCard to="/privacidade" icon={Shield} title="Privacidade e dados" description="Consulte as opções de exportação e de solicitação de exclusão dos seus dados." />}
      </div>}
      {current.id === 'sobre' && <section className="space-y-4 rounded-xl border bg-card p-5 md:p-6"><h2 className="text-lg font-semibold">Cortex</h2><p className="text-sm leading-relaxed text-muted-foreground">Prontuário, consulta, documentos, agenda e recepção para clínicas. Todo rascunho gerado por IA precisa da revisão do médico.</p><div className="flex flex-wrap gap-4 text-sm"><Link to="/sobre" className="inline-flex min-h-11 items-center text-primary underline">Sobre o ambiente</Link><Link to="/aviso-de-privacidade" className="inline-flex min-h-11 items-center text-primary underline">Aviso de privacidade</Link></div></section>}
    </div>
  </WorkspaceShell>;
}
