import { Stethoscope, MonitorSpeaker, Mic, Info, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ConsultationMode, supportsSystemAudio } from '@/hooks/useRecording';

interface RecordingModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: ConsultationMode) => void;
}

export function RecordingModeDialog({ open, onOpenChange, onSelect }: RecordingModeDialogProps) {
  const systemAudioAvailable = supportsSystemAudio();

  const choose = (mode: ConsultationMode) => {
    // Close first so the dialog isn't blocking the browser's share picker,
    // which must open while the click's user activation is still valid.
    onOpenChange(false);
    onSelect(mode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50">
          <DialogTitle className="text-base font-semibold">Tipo de consulta</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Escolha como o áudio desta consulta será capturado.
          </p>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Presencial */}
          <button
            type="button"
            onClick={() => choose('presencial')}
            className={cn(
              'w-full text-left rounded-xl border border-border/70 bg-white p-4',
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
                <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-medium text-muted-foreground/70">
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
            disabled={!systemAudioAvailable}
            className={cn(
              'w-full text-left rounded-xl border border-border/70 bg-white p-4 transition-all group',
              systemAudioAvailable
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
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70">
                    <Mic className="w-3 h-3" />
                    Microfone
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">+</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70">
                    <MonitorSpeaker className="w-3 h-3" />
                    Áudio do computador
                  </span>
                </div>
              </div>
            </div>
          </button>

          {systemAudioAvailable ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Na teleconsulta o navegador pedirá para escolher a aba da chamada — selecione a aba
                e <strong>marque "Compartilhar áudio da guia"</strong>. Sem essa opção a voz do
                paciente não é gravada.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200/60 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-800 leading-relaxed">
                Este navegador não permite capturar o áudio do computador. Para teleconsultas, use o
                Google Chrome ou o Microsoft Edge.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
