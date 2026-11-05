// Digital signature (D17) on the documents list: the doctor's signature
// session and the "Assinar digitalmente" action of each generated document.
// The server decides every state; this only shows it and keeps the operation
// id of a document until its operation ends (signatureClient).
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, PenLine, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { SESSION_KEY, signatureInvoke } from '@/hooks/useSignatureSession';
import {
  RETURN_KEY, pendingOperation, revokeSession, signKeepingOperation, signatureNotice, startSession,
  type SessionState,
} from '@/lib/signatureClient';

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

/** "Abrir sessão de assinatura" or "Assinatura digital ativa até HH:MM · Encerrar". */
export function SignatureSessionBar({ state }: { state: SessionState }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!state.available || !state.configured) return null;

  const open = async () => {
    setBusy(true);
    try {
      const step = await startSession(signatureInvoke);
      if ('message' in step) {
        toast({ title: 'Sessão de assinatura não aberta', description: step.message, variant: 'destructive' });
        return;
      }
      try { sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search); } catch { /* back to the start page */ }
      window.location.assign(step.authorizeUrl);
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    setBusy(true);
    try {
      const result = await revokeSession(signatureInvoke);
      if (result.ok) toast({ title: 'Sessão de assinatura encerrada' });
      else toast({ title: 'Não foi possível encerrar', description: result.message, variant: 'destructive' });
      await queryClient.invalidateQueries({ queryKey: [SESSION_KEY] });
    } finally {
      setBusy(false);
    }
  };

  if (state.active) {
    return (
      <div className="flex items-center gap-2 text-[0.6875rem] text-green-800">
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
        <span>Assinatura digital ativa{state.expiresAt ? ` até ${timeOf(state.expiresAt)}` : ''}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[0.6875rem]" onClick={end} disabled={busy}>Encerrar</Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="outline" className="h-7 text-[0.6875rem]" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
      Abrir sessão de assinatura
    </Button>
  );
}

/** "Assinar digitalmente", "Tentar de novo" (no answer) or "Verificar assinatura" (in progress). */
export function SignDocumentButton({ prescriptionId, pdfSha256, sessionActive, onSigned }: {
  prescriptionId: string;
  pdfSha256: string;
  sessionActive: boolean;
  onSigned: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [, setVersion] = useState(0); // re-render after the stored operation changes
  if (!user) return null;
  const pending = pendingOperation(user.id, prescriptionId);
  const label = pending?.awaiting === 'ambiguous' ? 'Tentar de novo' : pending?.awaiting === 'in_progress' ? 'Verificar assinatura' : 'Assinar digitalmente';

  const sign = async () => {
    if (!sessionActive && pending?.awaiting !== 'in_progress') {
      toast({ title: 'Abra a sessão de assinatura', description: 'Use "Abrir sessão de assinatura" acima e assine de novo.' });
      return;
    }
    const humanRetry = pending?.awaiting === 'ambiguous';
    if (humanRetry && !window.confirm('O provedor não respondeu à última tentativa. Assinar de novo este mesmo documento?')) return;
    setBusy(true);
    try {
      const outcome = await signKeepingOperation(signatureInvoke, user.id, { prescriptionId, pdfSha256 }, { humanRetry });
      const notice = signatureNotice(outcome);
      toast({ title: notice.title, description: notice.description, ...(notice.destructive ? { variant: 'destructive' as const } : {}) });
      if (outcome.kind === 'needs_session') await queryClient.invalidateQueries({ queryKey: [SESSION_KEY] });
      // The state of the document changed: refresh the list.
      if (outcome.kind === 'completed' || ('ended' in outcome && outcome.ended)) onSigned();
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };

  return (
    <Button
      size="icon" variant="ghost" className="h-7 w-7 text-medical-blue"
      title={label} aria-label={label} onClick={sign} disabled={busy}
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PenLine className="w-3 h-3" />}
    </Button>
  );
}
