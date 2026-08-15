import { useEffect, useState } from 'react';
import { Settings2, Sparkles, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useUserSettings, SPECIALTY_LABELS, Specialty } from '@/hooks/useUserSettings';

export function SpecialtySettingsSheet() {
  const {
    specialty, setSpecialty,
    liveCopilotEnabled, setLiveCopilotEnabled,
    prescriber, updateSettings,
    isSaving,
  } = useUserSettings();

  // Local draft for the prescriber fields — saved on blur so each keystroke
  // doesn't fire an upsert.
  const [draft, setDraft] = useState(prescriber);
  useEffect(() => { setDraft(prescriber); }, [prescriber.doctorName, prescriber.crmNumber, prescriber.crmUf, prescriber.professionalAddress]);

  const saveDraft = () => {
    updateSettings({
      doctor_name:          draft.doctorName.trim(),
      crm_number:           draft.crmNumber.trim(),
      crm_uf:               draft.crmUf.trim().toUpperCase().slice(0, 2),
      professional_address: draft.professionalAddress.trim(),
    });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground/60 hover:text-muted-foreground"
          title="Configurações"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80">
        <SheetHeader>
          <SheetTitle>Configurações</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
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
              <SelectTrigger className="w-full">
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
              value={draft.doctorName}
              onChange={e => setDraft(d => ({ ...d, doctorName: e.target.value }))}
              onBlur={saveDraft}
              placeholder="Nome completo do médico"
            />
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <Input
                value={draft.crmNumber}
                onChange={e => setDraft(d => ({ ...d, crmNumber: e.target.value }))}
                onBlur={saveDraft}
                placeholder="CRM (número)"
              />
              <Input
                value={draft.crmUf}
                onChange={e => setDraft(d => ({ ...d, crmUf: e.target.value.toUpperCase().slice(0, 2) }))}
                onBlur={saveDraft}
                placeholder="UF"
                maxLength={2}
              />
            </div>
            <Input
              value={draft.professionalAddress}
              onChange={e => setDraft(d => ({ ...d, professionalAddress: e.target.value }))}
              onBlur={saveDraft}
              placeholder="Endereço profissional"
            />
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
