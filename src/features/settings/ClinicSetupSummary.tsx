import { BadgeCheck, Building2, PauseCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useClinicAccess } from '@/features/reception/accessContext';
import { SPECIALTY_LABELS, useUserSettings } from '@/hooks/useUserSettings';

function ProfessionalProfile() {
  const settings = useUserSettings();
  if (settings.isLoading) return <p role="status" className="p-5 text-sm text-muted-foreground">Carregando seu cadastro profissional…</p>;
  if (settings.isError) return <div role="alert" className="space-y-3 rounded-xl border p-5"><p>Não foi possível consultar seu cadastro profissional.</p><Button variant="outline" onClick={() => void settings.retrySettings()}>Tentar novamente</Button></div>;
  const { prescriber } = settings;
  const fields = [
    ['Especialidade configurada', SPECIALTY_LABELS[settings.specialty] ?? 'Não informada'],
    ['Nome profissional', prescriber.doctorName || 'Pendente'],
    ['CRM e UF', [prescriber.crmNumber, prescriber.crmUf].filter(Boolean).join(' · ') || 'Pendente'],
    ['RQE', prescriber.rqe || 'Não informado'],
    ['Endereço profissional', prescriber.professionalAddress || 'Pendente'],
    ['Telefone profissional', prescriber.professionalPhone || 'Não informado'],
    ['CPF para documentos que o exigem', prescriber.prescriberCpf ? 'Cadastrado' : 'Não cadastrado'],
  ];
  return <section className="space-y-5 rounded-2xl border bg-card p-5 md:p-6" aria-labelledby="setup-profile-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="setup-profile-title" className="flex items-center gap-2 font-semibold"><BadgeCheck className="h-5 w-5 text-primary" />Seu cadastro profissional</h2><Badge variant="outline">{settings.prescriberComplete ? 'Campos essenciais cadastrados' : 'Cadastro incompleto'}</Badge></div>
    <p className="text-sm leading-relaxed text-muted-foreground">Esses dados são usados nos seus documentos. A equipe de implantação faz o cadastro e os ajustes junto com você.</p>
    <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
    <p className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">Se houver informação incorreta ou pendente, solicite a correção à equipe de implantação antes de emitir o documento. Nenhum dado é alterado nesta tela.</p>
  </section>;
}
export function ClinicSetupSummary() {
  const access = useClinicAccess();
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border bg-card p-5 md:p-6"><h2 className="flex items-center gap-2 font-semibold"><Building2 className="h-5 w-5 text-primary" />Implantação assistida</h2><p className="text-sm font-medium">{access?.clinic?.name ?? 'Clínica ainda não vinculada'}</p><p className="text-sm leading-relaxed text-muted-foreground">A equipe de implantação prepara o ambiente, os cadastros profissionais e as conexões técnicas. A clínica confere os dados e aprova os acessos. Para uma alteração nesses dados, fale com a equipe responsável pela implantação.</p></section>
    {access?.kind === 'clinical' && <ProfessionalProfile />}
    <section className="space-y-3 rounded-2xl border bg-card p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><PauseCircle className="h-5 w-5 text-muted-foreground" />Copiloto ao vivo</h2><Badge variant="secondary">Desativado</Badge></div><p className="text-sm leading-relaxed text-muted-foreground">A análise em tempo real está desativada neste ambiente. O registro manual, a gravação e a elaboração da evolução final continuam disponíveis aos médicos.</p></section>
  </div>;
}
