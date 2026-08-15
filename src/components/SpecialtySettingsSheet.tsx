import { Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    isSaving,
  } = useUserSettings();

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
