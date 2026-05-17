import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ConsultationReviewModalProps {
  open: boolean;
  patientName: string;
  transcription: string;
  soapDraft: string;
  onConfirm: (comments: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
}

export function ConsultationReviewModal({
  open,
  patientName,
  transcription,
  soapDraft,
  onConfirm,
  onCancel,
  isGenerating,
}: ConsultationReviewModalProps) {
  const [transcriptionExpanded, setTranscriptionExpanded] = useState(false);
  const [comments, setComments] = useState('');

  useEffect(() => {
    if (open) {
      setComments('');
      setTranscriptionExpanded(false);
    }
  }, [open]);

  const renderSoap = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part,
    );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isGenerating) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">
            Revisão da Consulta — {patientName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revise o resumo gerado pela IA e adicione observações antes de confirmar.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">

          {/* SOAP draft — read-only review */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-medical-blue-light flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-medical-blue" />
              </div>
              <span className="text-sm font-semibold text-medical-blue">Resumo gerado pela IA</span>
            </div>
            <div className={cn(
              'rounded-lg border border-border bg-muted/20 px-4 py-3',
              'text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap',
            )}>
              {renderSoap(soapDraft)}
            </div>
          </div>

          {/* Transcription — collapsible */}
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

          {/* Doctor comments */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">
              Observações e correções{' '}
              <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Adicione correções, pendências ou informações não capturadas na gravação.
              A evolução final será gerada incorporando estas observações.
            </p>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Ex: Paciente relatou também dor lombar. Solicitar hemograma completo. Próximo retorno em 30 dias..."
              className={cn(
                'w-full min-h-[100px] text-sm leading-relaxed',
                'bg-muted/30 border border-border rounded-lg p-3',
                'text-foreground/90 resize-y',
                'focus:outline-none focus:ring-2 focus:ring-medical-blue/30',
                'placeholder:text-muted-foreground/50',
              )}
              disabled={isGenerating}
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50 shrink-0">
          <Button variant="outline" onClick={onCancel} disabled={isGenerating}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(comments)} disabled={isGenerating} className="gap-2 min-w-[160px]">
            {isGenerating
              ? 'Gerando evolução...'
              : comments.trim()
                ? 'Gerar com observações'
                : 'Confirmar e salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
