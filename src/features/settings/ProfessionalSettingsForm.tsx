import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileStack } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/pagination';
import { LoadErrorNotice } from '@/features/shared/StatusNotice';

/** Personal preference only. Managed professional data lives in ClinicSetupSummary. */
export function ProfessionalSettingsForm() {
  const { user } = useAuth();
  const settings = useUserSettings();
  const templates = useQuery({
    queryKey: ['document-templates-min', user?.id],
    queryFn: () => fetchAllRows<{ id: string; name: string }>((from, to) =>
      supabase.from('document_templates').select('id, name').order('name').order('id').range(from, to)),
    enabled: !!user?.id,
    staleTime: 60_000,
    retry: false,
  });
  if (settings.isLoading) return <p role="status" className="text-sm text-muted-foreground">Carregando suas preferências…</p>;
  if (settings.isError) return <LoadErrorNotice message="Não foi possível consultar suas preferências. Verifique a conexão e tente de novo." onRetry={() => void settings.retrySettings()} />;
  return <section className="space-y-5 rounded-2xl border bg-card p-5 md:p-6" aria-label="Modelo da evolução">
    <div className="space-y-2"><label htmlFor="settings-template" className="flex items-center gap-2 text-sm font-semibold"><FileStack className="h-4 w-4 text-primary" />Modelo da evolução</label><p className="text-sm leading-relaxed text-muted-foreground">A equipe Cortex prepara um modelo padrão. Você pode escolher um dos seus modelos para organizar as próximas evoluções.</p></div>
    <Select value={settings.activeTemplateId ?? 'default'} onValueChange={value => settings.setActiveTemplateId(value === 'default' ? null : value)} disabled={!user || settings.isSaving || templates.isPending || templates.isError}>
      <SelectTrigger id="settings-template" className="h-auto min-h-12 w-full whitespace-normal text-left"><SelectValue placeholder="Escolha um modelo" /></SelectTrigger>
      <SelectContent><SelectItem value="default">Modelo padrão da clínica</SelectItem>{templates.data?.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
    </Select>
    {settings.isSaving && <p role="status" className="text-xs text-muted-foreground">Salvando preferência…</p>}
    {templates.isError && <LoadErrorNotice message="Não foi possível carregar os modelos. Verifique a conexão e tente de novo." retrying={templates.isFetching} onRetry={() => void templates.refetch()} />}
    <Link to="/modelos" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary">Gerenciar meus modelos<ChevronRight className="h-4 w-4" /></Link>
    <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">Especialidade e dados de prescritor são mantidos pela equipe Cortex. <Link to="/configuracoes?secao=implantacao" className="text-primary underline">Consultar meus dados</Link></p>
  </section>;
}
