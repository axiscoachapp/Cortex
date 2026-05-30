import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, FileText, AlertCircle, CheckCircle, AlertTriangle, Stethoscope, Pill } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SoapNoteView } from '@/components/SoapNoteView';

interface ConsultationReviewModalProps {
  open: boolean;
  patientName: string;
  transcription: string;
  soapDraft: string;
  clarifications: string[];
  transcriptionQuality: 'good' | 'partial' | 'poor';
  differentialDiagnoses: string[];
  drugInteractionAlerts: string[];
  onConfirm: (comments: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
}


const qualityConfig = {
  good: {
    icon: CheckCircle,
    label: 'Transcrição clara',
    className: 'text-green-700 bg-green-50 border-green-200/60',
  },
  partial: {
    icon: AlertTriangle,
    label: 'Transcrição parcial',
    className: 'text-amber-700 bg-amber-50 border-amber-200/60',
  },
  poor: {
    icon: AlertCircle,
    label: 'Transcrição ruim',
    className: 'text-red-700 bg-red-50 border-red-200/60',
  },
};

export function ConsultationReviewModal({
  open,
  patientName,
  transcription,
  soapDraft,
  clarifications,
  transcriptionQuality,
  differentialDiagnoses,
  drugInteractionAlerts,
  onConfirm,
  onCancel,
  isGenerating,
}: ConsultationReviewModalProps) {
  const [transcriptionExpanded, setTranscriptionExpanded] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [extraComments, setExtraComments] = useState('');

  useEffect(() => {
    if (open) {
      setAnswers(clarifications.map(() => ''));
      setExtraComments('');
      setTranscriptionExpanded(transcriptionQuality === 'poor');
    }
  }, [open, clarifications, transcriptionQuality]);

  const buildFinalComments = (): string => {
    const parts: string[] = [];
    clarifications.forEach((q, i) => {
      const ans = answers[i]?.trim();
      if (ans) parts.push(`${q}\nR: ${ans}`);
    });
    if (extraComments.trim()) parts.push(extraComments.trim());
    return parts.join('\n\n');
  };

  const quality = qualityConfig[transcriptionQuality] ?? qualityConfig.good;
  const QualityIcon = quality.icon;

  const hasClarifications = clarifications.length > 0;
  const anyAnswered = answers.some(a => a.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isGenerating) onCancel(); }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 md:px-6 py-3 md:py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base font-semibold">
              Revisão da Consulta — {patientName}
            </DialogTitle>
            <span className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0',
              quality.className,
            )}>
              <QualityIcon className="w-3 h-3" />
              {quality.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revise o rascunho gerado pela IA e responda as perguntas de esclarecimento antes de confirmar.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-4 md:py-5 space-y-4 md:space-y-5">

          {/* SOAP draft */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-medical-blue-light flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-medical-blue" />
              </div>
              <span className="text-sm font-semibold text-medical-blue">Rascunho gerado pela IA</span>
            </div>
            <div className="rounded-lg border border-border bg-muted/10 px-4 py-3">
              <SoapNoteView text={soapDraft} />
            </div>
          </div>

          {/* Drug interaction alerts — highest priority, show first */}
          {drugInteractionAlerts.length > 0 && (
            <div className="rounded-lg border border-red-200/70 bg-red-50/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Pill className="w-4 h-4 text-red-600 shrink-0" />
                <span className="text-sm font-semibold text-red-700">
                  Alertas de Interação Medicamentosa
                </span>
                <span className="ml-auto text-[10px] text-red-500/70 font-medium">Sugestão da IA — verificar</span>
              </div>
              <ul className="space-y-1.5">
                {drugInteractionAlerts.map((alert, i) => (
                  <li key={i} className="text-xs text-red-800/90 flex items-start gap-1.5">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                    {alert}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Differential diagnoses */}
          {differentialDiagnoses.length > 0 && (
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-700">
                  Hipóteses Diagnósticas
                </span>
                <span className="ml-auto text-[10px] text-amber-500/70 font-medium">Sugestão da IA — contexto clínico</span>
              </div>
              <ul className="space-y-1.5">
                {differentialDiagnoses.map((dx, i) => (
                  <li key={i} className="text-xs text-amber-900/80 flex items-start gap-1.5">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    {dx}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Transcription — collapsible, auto-open if quality is poor */}
          {transcription && (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setTranscriptionExpanded(!transcriptionExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              >
                <span className="text-sm font-medium text-foreground/80">Ver transcrição completa</span>
                {transcriptionExpanded
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {transcriptionExpanded && (
                <div className="px-4 py-3 text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap max-h-56 overflow-y-auto scrollbar-thin border-t border-border/40">
                  {transcription}
                </div>
              )}
            </div>
          )}

          {/* Clarifying questions */}
          {hasClarifications && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground/80">
                  Perguntas de esclarecimento
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — a IA identificou lacunas na transcrição
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Responda as perguntas abaixo para garantir que o SOAP final seja preciso. Deixe em branco se não aplicável.
                </p>
              </div>
              {clarifications.map((question, i) => (
                <div key={i} className="rounded-lg border border-border/70 bg-amber-50/40 p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground/80 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0 text-amber-600 font-bold">{i + 1}.</span>
                    {question}
                  </p>
                  <input
                    type="text"
                    value={answers[i] ?? ''}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                    placeholder="Sua resposta..."
                    disabled={isGenerating}
                    className={cn(
                      'w-full h-10 px-3 rounded-lg text-sm bg-white border border-border/60',
                      'focus:outline-none focus:ring-2 focus:ring-medical-blue/30',
                      'placeholder:text-muted-foreground/50 text-foreground/90',
                    )}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Extra comments */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">
              {hasClarifications ? 'Observações adicionais' : 'Observações e correções'}{' '}
              <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
            </label>
            {!hasClarifications && (
              <p className="text-xs text-muted-foreground">
                Adicione correções, pendências ou informações não capturadas na gravação.
              </p>
            )}
            <textarea
              value={extraComments}
              onChange={(e) => setExtraComments(e.target.value)}
              placeholder="Ex: Paciente relatou também dor lombar. Solicitar hemograma completo. Próximo retorno em 30 dias..."
              className={cn(
                'w-full min-h-[90px] text-sm leading-relaxed',
                'bg-muted/30 border border-border rounded-lg p-3',
                'text-foreground/90 resize-y',
                'focus:outline-none focus:ring-2 focus:ring-medical-blue/30',
                'placeholder:text-muted-foreground/50',
              )}
              disabled={isGenerating}
            />
          </div>
        </div>

        <DialogFooter className="px-4 md:px-6 py-3 md:py-4 border-t border-border/50 shrink-0 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isGenerating} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(buildFinalComments())}
            disabled={isGenerating}
            className="gap-2 w-full sm:w-auto sm:min-w-[160px]"
          >
            {isGenerating
              ? 'Gerando evolução...'
              : (anyAnswered || extraComments.trim())
                ? 'Gerar com observações'
                : 'Confirmar e salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
