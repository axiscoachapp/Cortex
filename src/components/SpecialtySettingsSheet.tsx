import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useUserSettings, SPECIALTY_LABELS, Specialty } from '@/hooks/useUserSettings';

export function SpecialtySettingsSheet() {
  const { specialty, setSpecialty, isSaving } = useUserSettings();

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
        </div>
      </SheetContent>
    </Sheet>
  );
}
