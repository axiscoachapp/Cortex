import { useEffect, useState } from 'react';
import { Stethoscope, MonitorSpeaker, Mic, Info, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { ConsultationMode, supportsSystemAudio } from '@/hooks/useRecording';

interface RecordingModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called only after the doctor confirms the patient's consent to recording. */
  onSelect: (mode: ConsultationMode, consent: { consentedAt: string }) => void;
}

export function RecordingModeDialog({ open, onOpenChange, onSelect }: RecordingModeDialogProps) {
  const systemAudioAvailable = supportsSystemAudio();
  // Recording a consultation requires the patient's informed consent
  // (LGPD art. 11; CFM 2.314/2022 for teleconsultations). It is asked every time.
  const [consented, setConsented] = useState(false);
  useEffect(() => {
    if (open) setConsented(false);
  }, [open]);

  const choose = (mode: ConsultationMode) => {
    // Close first so the dialog isn't blocking the browser's share picker,
    // which must open while the click's user activation is still valid.
    if (!consented) return;
    onOpenChange(false);
    onSelect(mode, { consentedAt: new Date().toISOString() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* On a phone the dialog must fit the viewport: header stays, body scrolls. */}
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden p-0 gap-0 sm:max-w-md">
        <DialogHeader className="shrink-0 px-5 py-4 pr-12 border-b border-border/50 text-left">
          <DialogTitle className="text-base font-semibold">Gravar consulta</DialogTitle>
          <DialogDescription className="text-xs mt-0.5">
            Escolha como o áudio desta consulta será capturado.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex min-h-11 items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
            <Checkbox
              id="recording-consent"
              aria-labelledby="recording-consent-label"
              className="mt-0.5"
              checked={consented}
              onCheckedChange={(value) => setConsented(value === true)}
            />
            <label id="recording-consent-label" htmlFor="recording-consent" className="cursor-pointer">
              Informei o paciente e ele <strong>consentiu com a gravação</strong> desta consulta. O consentimento fica
              registrado na consulta.
            </label>
          </div>
          {!consented && (
            <p id="recording-consent-reason" className="text-xs text-muted-foreground">
              Marque o consentimento para escolher o tipo.
            </p>
          )}
          {/* Presencial */}
          <button
            type="button"
            onClick={() => choose('presencial')}
            disabled={!consented}
            aria-describedby={consented ? undefined : 'recording-consent-reason'}
            className={cn(
              'w-full text-left rounded-xl border border-border/70 bg-white p-4 disabled:opacity-50 disabled:cursor-not-allowed',
              'hover:border-medical-blue/50 hover:bg-medical-blue-light/30 hover:shadow-md',
              'focus:outline-none focus:ring-2 focus:ring-medical-blue/30 transition-all group',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5 text-medical-blue" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Presencial</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Paciente no consultório. Grava pelo microfone do dispositivo.
                </p>
                <span className="inline-flex items-center gap-1 mt-2 text-[0.625rem] font-medium text-muted-foreground">
                  <Mic className="w-3 h-3" />
                  Microfone
                </span>
              </div>
            </div>
          </button>

          {/* Online */}
          <button
            type="button"
            onClick={() => choose('online')}
            disabled={!systemAudioAvailable || !consented}
            aria-describedby={consented ? undefined : 'recording-consent-reason'}
            className={cn(
              'w-full text-left rounded-xl border border-border/70 bg-white p-4 transition-all group',
              systemAudioAvailable && consented
                ? 'hover:border-medical-blue/50 hover:bg-medical-blue-light/30 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-medical-blue/30'
                : 'opacity-60 cursor-not-allowed',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <MonitorSpeaker className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Teleconsulta (online)</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Paciente por videochamada. Grava seu microfone <strong>e</strong> o áudio do
                  computador, para capturar as duas vozes.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
                    <Mic className="w-3 h-3" />
                    Microfone
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">+</span>
                  <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
                    <MonitorSpeaker className="w-3 h-3" />
                    Áudio do computador
                  </span>
                </div>
                {systemAudioAvailable ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] text-amber-800 leading-relaxed">
                    <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      O navegador pedirá a aba da chamada: selecione-a e <strong>marque "Compartilhar áudio da guia"</strong>.
                      Sem isso a voz do paciente não é gravada.
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] text-red-800 leading-relaxed">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                    <span>Este navegador não captura o áudio do computador. Para teleconsultas, use o Google Chrome ou o Microsoft Edge.</span>
                  </p>
                )}
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
