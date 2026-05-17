import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, FileText, MessageCircle, Check } from 'lucide-react';
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
  soapNote: string;
  whatsappMessage: string;
  onConfirm: (editedSoap: string, comments: string) => void;
  onClose: () => void;
  isSaving: boolean;
}

export function ConsultationReviewModal({
  open,
  patientName,
  transcription,
  soapNote,
  whatsappMessage,
  onConfirm,
  onClose,
  isSaving,
}: ConsultationReviewModalProps) {
  const [transcriptionExpanded, setTranscriptionExpanded] = useState(false);
  const [editedSoap, setEditedSoap] = useState(soapNote);
  const [comments, setComments] = useState('');

  // Reset form whenever modal opens with new data
  useEffect(() => {
    if (open) {
      setEditedSoap(soapNote);
      setComments('');
      setTranscriptionExpanded(false);
    }
  }, [open, soapNote]);

  const handleConfirm = () => {
    onConfirm(editedSoap, comments);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isSaving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">
            Revisão da Consulta — {patientName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revise e corrija a evolução gerada pela IA antes de salvar.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">

          {/* Transcription (collapsible) */}
          {transcription && (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setTranscriptionExpanded(!transcriptionExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              >
                <span className="text-sm font-medium text-foreground/80">Transcrição da consulta</span>
                {transcriptionExpanded
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {transcriptionExpanded && (
                <div className="px-4 py-3 text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap max-h-48 overflow-y-auto scrollbar-thin">
                  {transcription}
                </div>
              )}
            </div>
          )}

          {/* SOAP note — editable */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-medical-blue-light flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-medical-blue" />
              </div>
              <span className="text-sm font-semibold text-medical-blue">Evolução Clínica (SOAP)</span>
            </div>
            <textarea
              value={editedSoap}
              onChange={(e) => setEditedSoap(e.target.value)}
              className={cn(
                'w-full min-h-[280px] text-sm leading-relaxed',
                'bg-muted/30 border border-border rounded-lg p-3',
                'text-foreground/90 resize-y',
                'focus:outline-none focus:ring-2 focus:ring-medical-blue/30',
              )}
            />
          </div>

          {/* Doctor comments */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">
              Observações do médico{' '}
              <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Adicione comentários, pendências ou observações que não estejam na transcrição..."
              className={cn(
                'w-full min-h-[80px] text-sm leading-relaxed',
                'bg-muted/30 border border-border rounded-lg p-3',
                'text-foreground/90 resize-y',
                'focus:outline-none focus:ring-2 focus:ring-medical-blue/30',
                'placeholder:text-muted-foreground/60',
              )}
            />
          </div>

          {/* WhatsApp preview (read-only) */}
          {whatsappMessage && (
            <div className="rounded-lg border border-whatsapp-green/30 bg-whatsapp-green/5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whatsapp-green/20">
                <div className="w-7 h-7 rounded-lg bg-whatsapp-green/20 flex items-center justify-center">
                  <MessageCircle className="w-3.5 h-3.5 text-whatsapp-green" />
                </div>
                <span className="text-sm font-semibold text-foreground/80">Mensagem WhatsApp (prévia)</span>
              </div>
              <div className="px-4 py-3 text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap">
                {whatsappMessage}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Fechar sem salvar
          </Button>
          <Button onClick={handleConfirm} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <>Salvando...</>
            ) : (
              <><Check className="w-4 h-4" />Confirmar e Salvar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
