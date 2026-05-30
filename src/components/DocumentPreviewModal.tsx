import { useState } from 'react';
import { Printer, Copy, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  type: 'patient_summary' | 'referral';
  content: string;
  isLoading: boolean;
  patientName: string;
}

function renderDocumentLine(line: string, index: number) {
  // Bold section header: **Title**
  if (line.startsWith('**') && line.endsWith('**')) {
    return (
      <h3 key={index} className="text-sm font-bold text-foreground mt-4 first:mt-0">
        {line.slice(2, -2)}
      </h3>
    );
  }
  // Bullet point starting with •
  if (line.startsWith('•') || line.startsWith('- ')) {
    const text = line.startsWith('•') ? line.slice(1).trim() : line.slice(2).trim();
    return (
      <li key={index} className="text-sm text-foreground/85 leading-relaxed ml-3 list-none flex gap-2">
        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-foreground/30 shrink-0" />
        <span>{text}</span>
      </li>
    );
  }
  // Empty line — spacer
  if (!line.trim()) return <div key={index} className="h-1" />;
  // Inline bold fragments
  const parts = line.split(/(\*\*[^*]+\*\*)/);
  return (
    <p key={index} className="text-sm text-foreground/85 leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : part,
      )}
    </p>
  );
}

export function DocumentPreviewModal({
  open,
  onClose,
  type,
  content,
  isLoading,
  patientName,
}: DocumentPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  const title = type === 'patient_summary' ? 'Resumo para o Paciente' : 'Encaminhamento Médico';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${title} — ${patientName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.6; color: #111; padding: 2cm; }
    h1 { font-size: 14pt; font-weight: bold; margin-bottom: 8pt; }
    h3 { font-size: 11pt; font-weight: bold; margin-top: 14pt; margin-bottom: 4pt; }
    p, li { font-size: 11pt; margin-bottom: 4pt; }
    li { margin-left: 16pt; list-style-type: disc; }
    .meta { color: #555; font-size: 10pt; margin-bottom: 18pt; border-bottom: 1px solid #ccc; padding-bottom: 8pt; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">Paciente: ${patientName} · ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <div>${content
    .split('\n')
    .map(line => {
      if (line.startsWith('**') && line.endsWith('**')) return `<h3>${line.slice(2, -2)}</h3>`;
      if (line.startsWith('• ') || line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
      if (!line.trim()) return '<br/>';
      return `<p>${line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    })
    .join('\n')
  }</div>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground shrink-0">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{patientName}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 min-h-[200px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-medical-blue" />
              <p className="text-sm text-muted-foreground">Gerando documento...</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {content.split('\n').map((line, i) => renderDocumentLine(line, i))}
            </div>
          )}
        </div>

        {!isLoading && content && (
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-2"
            >
              {copied ? <><Check className="w-3.5 h-3.5 text-green-600" />Copiado!</> : <><Copy className="w-3.5 h-3.5" />Copiar</>}
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir / PDF
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
