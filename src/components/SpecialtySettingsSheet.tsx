import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useUserSettings } from '@/hooks/useUserSettings';
import { ProfessionalSettingsForm } from '@/features/settings/ProfessionalSettingsForm';

/** Quick settings from the home screen; the full page lives at /configuracoes. */
export function SpecialtySettingsSheet() {
  const { isSaving } = useUserSettings();
  const [dirty, setDirty] = useState(false);

  // Allow other components (e.g. the onboarding checklist) to open settings.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('open-cortex-settings', openHandler);
    return () => window.removeEventListener('open-cortex-settings', openHandler);
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (isSaving || (!next && dirty && !window.confirm('Descartar os dados do prescritor não salvos?'))) return;
        if (!next) setDirty(false);
        setOpen(next);
      }}
    >
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
          <SheetDescription className="sr-only">
            Especialidade, modelos, identidade do prescritor e preferências do copiloto.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <ProfessionalSettingsForm onDirtyChange={setDirty} />
          <Link
            to="/configuracoes"
            onClick={(event) => {
              if (dirty && !window.confirm('Descartar os dados do prescritor não salvos?')) event.preventDefault();
            }}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            Todas as configurações
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              equipe, segurança, WhatsApp <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
