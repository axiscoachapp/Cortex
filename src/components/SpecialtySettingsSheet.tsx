import { useEffect, useState } from 'react';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Settings2, Sparkles, BadgeCheck, FileStack, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useUserSettings, SPECIALTY_LABELS, Specialty } from '@/hooks/useUserSettings';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/pagination';

export function SpecialtySettingsSheet() {
  const { user } = useAuth();
  const {
    specialty, setSpecialty,
    liveCopilotEnabled, setLiveCopilotEnabled,
    prescriber, updateSettingsAsync,
    activeTemplateId, setActiveTemplateId,
    isSaving, isLoading,
  } = useUserSettings();

  const { data: templates = [], isError: templateError, refetch: retryTemplates } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['document-templates-min', user?.id],
    queryFn: async () => {
      return fetchAllRows<{ id: string; name: string }>((from, to) => supabase
        .from('document_templates')
        .select('id, name')
        .order('name').order('id').range(from, to));
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Keep an explicit draft so background refreshes cannot overwrite typing.
  const [draft, setDraft] = useState(prescriber);
  const [identityDirty, setIdentityDirty] = useState(false);
  useUnsavedChanges(identityDirty);
  const [saveStatus, setSaveStatus] = useState('');
  const [identityError, setIdentityError] = useState('');
  useEffect(() => {
    if (!identityDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [identityDirty]);
  useEffect(() => { if (!identityDirty) setDraft({ doctorName: prescriber.doctorName, crmNumber: prescriber.crmNumber, crmUf: prescriber.crmUf, professionalAddress: prescriber.professionalAddress }); }, [prescriber.doctorName, prescriber.crmNumber, prescriber.crmUf, prescriber.professionalAddress, identityDirty]);
  const editDraft = (patch: Partial<typeof draft>) => { setIdentityDirty(true); setSaveStatus(''); setIdentityError(''); setDraft(value => ({ ...value, ...patch })); };

  const saveDraft = async () => {
    if (isSaving || !identityDirty) return;
    setIdentityError(''); setSaveStatus('');
    try {
    await updateSettingsAsync({
      doctor_name:          draft.doctorName.trim(),
      crm_number:           draft.crmNumber.trim(),
      crm_uf:               draft.crmUf.trim().toUpperCase().slice(0, 2),
      professional_address: draft.professionalAddress.trim(),
    });
    setIdentityDirty(false); setSaveStatus('Dados do prescritor salvos.');
    } catch { setIdentityError('Não foi possível salvar. Seus dados foram mantidos; tente novamente.'); }
  };

  // Allow other components (e.g. the onboarding checklist) to open settings.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('open-cortex-settings', openHandler);
    return () => window.removeEventListener('open-cortex-settings', openHandler);
  }, []);

  return (
    <Sheet open={open} onOpenChange={next => { if (isSaving || (!next && identityDirty && !window.confirm('Descartar os dados do prescritor não salvos?'))) return; if (!next) setIdentityDirty(false); setOpen(next); }}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-muted-foreground"
          title="Configurações"
          aria-label="Configurações"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configurações</SheetTitle>
          <SheetDescription className="sr-only">Especialidade, modelos, identidade do prescritor e preferências do copiloto.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="settings-specialty" className="text-sm font-medium text-foreground">
              Especialidade
            </label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Define a estrutura das evoluções SOAP geradas pela IA. Escolha a especialidade
              que você pratica e todos os prontuários serão adaptados automaticamente.
            </p>
            <Select
              value={specialty}
              onValueChange={(v) => setSpecialty(v as Specialty)}
              disabled={isSaving}
            >
              <SelectTrigger id="settings-specialty" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(SPECIALTY_LABELS) as [Specialty, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSaving && (
              <p className="text-xs text-muted-foreground">Salvando...</p>
            )}
          </div>

          {/* Document template — replaces the default SOAP structure */}
          <div className="space-y-2 pt-5 border-t border-border/50">
            <label htmlFor="settings-template" className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <FileStack className="w-3.5 h-3.5 text-medical-blue" />
              Modelo da evolução
            </label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Escolha um modelo para estruturar as evoluções geradas pela IA, ou mantenha o SOAP padrão.
            </p>
            <Select
              value={activeTemplateId ?? 'default'}
              onValueChange={(v) => setActiveTemplateId(v === 'default' ? null : v)}
              disabled={isSaving}
            >
              <SelectTrigger id="settings-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">SOAP padrão (por especialidade)</SelectItem>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templateError && <div role="alert" className="text-xs text-destructive">Não foi possível carregar os modelos. <button type="button" className="underline" onClick={() => retryTemplates()}>Tentar novamente</button></div>}
            <Link
              to="/modelos"
              onClick={event => { if (identityDirty && !window.confirm('Descartar os dados do prescritor não salvos?')) event.preventDefault(); }}
              className="inline-flex items-center gap-1 text-xs text-medical-blue hover:text-medical-blue-dark font-medium mt-1"
            >
              Gerenciar modelos <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Prescriber identity — mandatory content on digital prescriptions */}
          <div className="space-y-3 pt-5 border-t border-border/50">
            <div className="space-y-0.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <BadgeCheck className="w-3.5 h-3.5 text-medical-blue" />
                Dados do prescritor
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Obrigatórios na receita digital (CFM 2.299/2021): nome, CRM e endereço profissional.
              </p>
            </div>
            <Input
              aria-label="Nome completo do médico"
              disabled={isSaving || isLoading}
              value={draft.doctorName}
              onChange={e => editDraft({ doctorName: e.target.value })}
              placeholder="Nome completo do médico"
            />
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <Input
                aria-label="Número do CRM"
                disabled={isSaving || isLoading}
                value={draft.crmNumber}
                onChange={e => editDraft({ crmNumber: e.target.value })}
                placeholder="CRM (número)"
              />
              <Input
                aria-label="UF do CRM"
                disabled={isSaving || isLoading}
                value={draft.crmUf}
                onChange={e => editDraft({ crmUf: e.target.value.toUpperCase().slice(0, 2) })}
                placeholder="UF"
                maxLength={2}
              />
            </div>
            <Input
              aria-label="Endereço profissional"
              disabled={isSaving || isLoading}
              value={draft.professionalAddress}
              onChange={e => editDraft({ professionalAddress: e.target.value })}
              placeholder="Endereço profissional"
            />
            <Button size="sm" onClick={saveDraft} disabled={isSaving || isLoading || !identityDirty}>{isSaving ? 'Salvando…' : 'Salvar dados do prescritor'}</Button>
            {saveStatus && <p role="status" className="text-xs text-success">{saveStatus}</p>}
            {identityError && <p role="alert" className="text-xs text-destructive">{identityError}</p>}
          </div>

          {/* Live copilot toggle */}
          <div className="space-y-2 pt-5 border-t border-border/50">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <label
                  htmlFor="live-copilot-toggle"
                  className="text-sm font-medium text-foreground flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                  Copiloto ao vivo
                </label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Durante a gravação, mostra um resumo da consulta e sugestões de perguntas,
                  atualizados a cada ~30&nbsp;segundos. Consome créditos adicionais por consulta.
                </p>
              </div>
              <Switch
                id="live-copilot-toggle"
                checked={liveCopilotEnabled}
                onCheckedChange={setLiveCopilotEnabled}
                disabled={isSaving}
                className="mt-0.5 shrink-0"
              />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
