import { BadgeCheck, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SupportRequest } from '@/components/SupportRequest';
import { useClinicAccess } from '@/features/reception/accessContext';
import { SPECIALTY_LABELS, useUserSettings } from '@/hooks/useUserSettings';
import { LoadErrorNotice, LoadingNotice } from '@/features/shared/StatusNotice';

/** Read-only by design: the Cortex team keeps this data; the screen offers the way to ask for a change. */
function ProfessionalProfile({ clinicName }: { clinicName?: string | null }) {
  const settings = useUserSettings();
  if (settings.isLoading) return <LoadingNotice label="Carregando seu cadastro profissional…" />;
  if (settings.isError) return <LoadErrorNotice message="Não foi possível consultar seu cadastro profissional. Verifique a conexão e tente de novo." onRetry={() => void settings.retrySettings()} />;
  const { prescriber } = settings;
  // [label, value, missing, short name for the "Falta:" chip]. RQE and phone are optional and never "missing";
  // CPF is listed when absent so the chip never says "Completo" above a "Não cadastrado".
  const fields: Array<[string, string, boolean, string?]> = [
    ['Especialidade', SPECIALTY_LABELS[settings.specialty] ?? 'Não informada', !SPECIALTY_LABELS[settings.specialty]],
    ['Nome profissional', prescriber.doctorName || 'Não cadastrado', !prescriber.doctorName],
    ['CRM e UF', [prescriber.crmNumber, prescriber.crmUf].filter(Boolean).join(' · ') || 'Não cadastrado', !prescriber.crmNumber || !prescriber.crmUf],
    ['RQE', prescriber.rqe || 'Não informado', false],
    ['Endereço profissional', prescriber.professionalAddress || 'Não cadastrado', !prescriber.professionalAddress],
    ['Telefone profissional', prescriber.professionalPhone || 'Não informado', false],
    ['CPF (para documentos que o exigem)', prescriber.prescriberCpf ? 'Cadastrado' : 'Não cadastrado', !prescriber.prescriberCpf, 'CPF'],
  ];
  const missing = fields.filter(([, , absent]) => absent).map(([label, , , short]) => short ?? label);
  return <section className="space-y-5 rounded-2xl border bg-card p-5 md:p-6" aria-labelledby="setup-profile-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 id="setup-profile-title" className="flex items-center gap-2 font-semibold"><BadgeCheck className="h-5 w-5 text-primary" />Seu cadastro profissional</h2>
      {missing.length ? <Badge variant="outline" className="border-[#F2B23E] bg-[#F2B23E]/10">Falta: {missing.join(', ')}</Badge> : <Badge variant="outline">Completo</Badge>}
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">Estes dados aparecem nas suas receitas, atestados e pedidos de exame.</p>
    <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
    <SupportRequest subject="Correção do cadastro profissional" clinicName={clinicName} className="border-t pt-4">
      Algo errado ou faltando? A equipe Cortex corrige para você. Peça antes de emitir o documento.
    </SupportRequest>
  </section>;
}

export function ClinicSetupSummary() {
  const access = useClinicAccess();
  const clinicName = access?.clinic?.name ?? null;
  return <div className="space-y-5">
    {access?.kind === 'clinical' && <ProfessionalProfile clinicName={clinicName} />}
    <section className="space-y-3 rounded-2xl border bg-card p-5 md:p-6" aria-labelledby="setup-clinic-title">
      <h2 id="setup-clinic-title" className="flex items-center gap-2 font-semibold"><Building2 className="h-5 w-5 text-primary" />Clínica</h2>
      <p className="text-sm font-medium">{clinicName ?? 'Sua conta ainda não está ligada a uma clínica.'}</p>
      <SupportRequest subject="Configuração da clínica (convênios, preços, WhatsApp)" clinicName={clinicName}>
        Convênios, tabela de preços e a conexão do WhatsApp são configurados pela equipe Cortex.
      </SupportRequest>
    </section>
  </div>;
}
