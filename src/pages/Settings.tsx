import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, ChevronRight, Info, KeyRound, MessageCircle, Plug, Settings2, Share2, Shield, ShieldCheck, Users, UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useClinicAccess } from '@/features/reception/accessContext';
import { ProfessionalSettingsForm } from '@/features/settings/ProfessionalSettingsForm';
import { WhatsAppSettings } from '@/features/settings/WhatsAppSettings';
import { ConnectionsSettings } from '@/features/settings/ConnectionsSettings';
import TeamSettings from '@/features/reception/TeamSettings';
import DelegationPermissions from '@/features/reception/DelegationPermissions';

type SectionId = 'perfil' | 'whatsapp' | 'conexoes' | 'equipe' | 'permissoes' | 'usuarios' | 'seguranca' | 'sobre';
/** `ownHeading`: the embedded component (Codex K4) brings its own h2. */
interface Section { id: SectionId; label: string; icon: typeof Settings2; description: string; ownHeading?: boolean }

function LinkCard({ to, icon: Icon, title, description }: { to: string; icon: typeof Settings2; title: string; description: string }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-xl border bg-white p-4 hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </Link>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const access = useClinicAccess();
  const clinical = access?.kind !== 'reception';
  const admin = !!access?.admin;
  const reception = access?.kind === 'reception';

  const sections = useMemo<Section[]>(() => [
    ...(clinical ? [{ id: 'perfil' as const, label: 'Perfil profissional', icon: BadgeCheck, description: 'Especialidade, modelo da evolução, dados do prescritor e copiloto.' }] : []),
    ...(admin || reception || clinical ? [{ id: 'whatsapp' as const, label: 'WhatsApp e automações', icon: MessageCircle, description: 'Número da recepção, modelos aprovados e mensagens automáticas da agenda.' }] : []),
    ...(clinical ? [{ id: 'conexoes' as const, label: 'Conexões', icon: Plug, description: 'Google Agenda e assinatura digital.' }] : []),
    ...(admin ? [{ id: 'equipe' as const, label: 'Equipe da recepção', icon: Users, description: 'Contas da recepção e agendas de cada pessoa.', ownHeading: true }] : []),
    ...(clinical ? [{ id: 'permissoes' as const, label: 'Permissões da recepção', icon: KeyRound, description: 'O que a recepção pode fazer na sua agenda.', ownHeading: true }] : []),
    ...(clinical ? [{ id: 'usuarios' as const, label: admin ? 'Médicos e compartilhamento' : 'Compartilhamento', icon: UserCog, description: admin ? 'Contas de médicos e compartilhamento de prontuários.' : 'Compartilhamento de prontuários entre médicos.' }] : []),
    { id: 'seguranca', label: 'Segurança e privacidade', icon: Shield, description: 'Senha, segundo fator, exportação e exclusão de dados.' },
    { id: 'sobre', label: 'Sobre', icon: Info, description: 'Versão e avisos.' },
  ], [admin, clinical, reception]);

  const requested = params.get('secao') as SectionId | null;
  const current = sections.find((s) => s.id === requested) ?? sections[0];
  // Keep other parameters (Permissions reads ?clinica=) when switching sections.
  const select = (id: SectionId) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('secao', id);
      return next;
    }, { replace: true });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate(reception ? '/recepcao' : '/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Settings2 className="h-5 w-5 text-medical-blue" aria-hidden />
          <h1 className="text-base font-semibold text-foreground">Configurações</h1>
          {access?.clinic?.name && <span className="hidden sm:inline truncate text-sm text-muted-foreground">· {access.clinic.name}</span>}
        </div>
      </header>

      <div className="flex-1 container mx-auto px-4 py-6 max-w-5xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Seções das configurações" className="-mx-4 mb-5 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-2 lg:flex-col lg:gap-1 lg:sticky lg:top-20">
            {sections.map(({ id, label, icon: Icon }) => (
              <li key={id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => select(id)}
                  aria-current={current.id === id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm lg:rounded-lg lg:border-transparent lg:px-3',
                    current.id === id ? 'border-primary/30 bg-primary/10 font-medium text-primary' : 'bg-white text-muted-foreground hover:text-foreground lg:bg-transparent lg:hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 space-y-5" aria-label={current.label}>
          {!current.ownHeading && (
            <div>
              <h2 className="text-lg font-semibold text-foreground">{current.label}</h2>
              <p className="text-sm text-muted-foreground">{current.description}</p>
            </div>
          )}

          {current.id === 'perfil' && (
            <div className="rounded-xl border bg-white p-5 max-w-2xl"><ProfessionalSettingsForm /></div>
          )}

          {current.id === 'whatsapp' && <WhatsAppSettings />}

          {current.id === 'conexoes' && <ConnectionsSettings clinical={clinical} />}

          {current.id === 'equipe' && admin && <TeamSettings embedded />}

          {current.id === 'permissoes' && <DelegationPermissions embedded />}

          {current.id === 'usuarios' && (
            <div className="grid gap-3 md:grid-cols-2">
              {admin && <LinkCard to="/compartilhamento" icon={UserCog} title="Contas de médicos" description="Criar a conta de um médico com senha temporária e ver quem faz parte da clínica." />}
              <LinkCard to="/compartilhamento" icon={Share2} title="Compartilhamento entre médicos" description="Compartilhar prontuários com outro médico, de forma explícita e revogável." />
            </div>
          )}

          {current.id === 'seguranca' && (
            <div className="grid gap-3 md:grid-cols-2">
              <LinkCard to="/seguranca" icon={ShieldCheck} title="Segurança da conta" description="Trocar a senha e configurar o segundo fator (aplicativo autenticador)." />
              {clinical && <LinkCard to="/privacidade" icon={Shield} title="Privacidade e dados" description="Exportar seus dados e pedir a exclusão da conta, com recibo (LGPD)." />}
            </div>
          )}

          {current.id === 'sobre' && (
            <div className="rounded-xl border bg-white p-5 space-y-3 max-w-2xl">
              <div className="flex items-center gap-3">
                <img src="/brand/cortex-symbol.svg" alt="" width={40} height={40} className="h-10 w-10" />
                <div>
                  <p className="font-semibold text-foreground">Cortex</p>
                  <p className="text-sm text-muted-foreground">Prontuário, consulta, documentos, agenda e recepção para clínicas.</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {access?.clinic?.name ? `Ambiente de ${access.clinic.name}. ` : ''}Os rascunhos gerados por IA sempre passam pela revisão do médico.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link to="/sobre" className="text-primary underline-offset-4 hover:underline">Sobre o ambiente</Link>
                <Link to="/aviso-de-privacidade" className="text-primary underline-offset-4 hover:underline">Aviso de privacidade</Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
