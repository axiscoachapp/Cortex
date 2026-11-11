import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WhatsAppConversation } from './whatsappApi';
import { readWhatsAppTemplates, type WhatsAppTemplate } from './whatsappTemplates';
import { MAX_TEXT, previewTemplate, sendWhatsAppMessage, validTemplateParam, WhatsAppSendError, type WhatsAppSendInput } from './whatsappSend';

/** What the person typed for one conversation. Kept outside the composer so refreshes and remounts keep it. */
export type ComposerDraft = { text: string; template: string; params: string[] };
export type ComposerDrafts = { get: (conversationId: string) => ComposerDraft; set: (conversationId: string, draft: ComposerDraft) => void };
export const emptyDraft: ComposerDraft = { text: '', template: '', params: [] };
/** useRequestId from the inbox: stable across detail remounts so a retry after an unknown outcome stays idempotent. */
export type RequestIds = ((body: unknown) => string) & { reset: () => void };

type Feedback = { tone: 'done' | 'warning' | 'error'; message: string } | null;
export type ComposerProps = {
  actor: string; clinic: string; conversation: WhatsAppConversation;
  /** The snapshot comes from a successful read (not a failed background refresh). */
  actionable: boolean; blocked: boolean;
  drafts: ComposerDrafts; requestId: RequestIds;
  onSendingChange: (sending: boolean) => void;
  /** Re-read the messages without blanking them, so the new message (or its absence) shows. */
  onAfterSend: () => void;
};

const windowOpen = (conversation: WhatsAppConversation) => {
  const until = conversation.windowOpenUntil ? Date.parse(conversation.windowOpenUntil) : NaN;
  return Number.isFinite(until) && until > Date.now();
};
const templateKey = (row: Pick<WhatsAppTemplate, 'name' | 'language'>) => JSON.stringify([row.name, row.language]);

export function WhatsAppComposer(props: ComposerProps) {
  const { actor, conversation } = props;
  if (conversation.status !== 'open') return null;
  if (conversation.optedOut) return <p className="rounded-md bg-muted p-3 text-sm">Este contato pediu para não receber mensagens. Não é possível enviar mensagens nesta conversa.</p>;
  if (conversation.assignedTo !== actor) return null;
  return <OwnComposer {...props} />;
}

function OwnComposer({ actor, clinic, conversation, actionable, blocked, drafts, requestId, onSendingChange, onAfterSend }: ComposerProps) {
  const [draft, setDraftState] = useState<ComposerDraft>(() => drafts.get(conversation.id));
  const [sending, setSending] = useState(false), [feedback, setFeedback] = useState<Feedback>(null);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true);
  const textId = useId(), templateId = useId(), feedbackRef = useRef<HTMLParagraphElement>(null);
  const open = windowOpen(conversation);
  const sendingChange = useRef(onSendingChange);
  sendingChange.current = onSendingChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving while a send runs: stop observing it and release the inbox lock. Nothing is resent.
      if (controller.current) { controller.current.abort(); controller.current = null; sendingChange.current(false); }
    };
  }, []);
  useEffect(() => { if (feedback && feedback.tone !== 'done') feedbackRef.current?.focus(); }, [feedback]);
  const update = (next: ComposerDraft) => { setDraftState(next); drafts.set(conversation.id, next); };

  const templates = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'templates', 'composer'],
    queryFn: ({ signal }) => readWhatsAppTemplates(signal),
    enabled: !open, retry: false, gcTime: 0, staleTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const approved = templates.data?.templates.filter(row => row.status === 'APPROVED') ?? [];
  const chosen = approved.find(row => templateKey(row) === draft.template);
  const params = chosen ? Array.from({ length: chosen.paramCount }, (_, index) => draft.params[index] ?? '') : [];

  const text = draft.text.trim();
  const canSendText = open && text.length > 0 && draft.text.length <= MAX_TEXT;
  const canSendTemplate = !open && !!chosen && params.every(validTemplateParam);
  const ready = actionable && !blocked && !sending;

  const send = async () => {
    if (!ready || controller.current) return;
    // Re-check the window at click time: the snapshot may be minutes old.
    const body = open && windowOpen(conversation) && canSendText
      ? { conversationId: conversation.id, text }
      : !open && canSendTemplate && chosen ? { conversationId: conversation.id, template: { name: chosen.name, language: chosen.language, params: params.map(value => value.trim()) } }
      : null;
    if (!body) {
      if (open && !windowOpen(conversation)) { setFeedback({ tone: 'error', message: 'A janela de 24 horas acabou de fechar. Atualizando a conversa…' }); onAfterSend(); }
      return;
    }
    // Same content, same request id: a manual retry after an unknown outcome cannot send twice.
    const input = { ...body, requestId: requestId(body) } as WhatsAppSendInput;
    const entry = new AbortController();
    controller.current = entry;
    setSending(true); setFeedback(null); onSendingChange(true);
    let outcome: Feedback;
    try {
      const receipt = await sendWhatsAppMessage(input, entry.signal);
      requestId.reset();
      if (receipt.outcome === 'sent') {
        update(open ? { ...draft, text: '' } : { ...draft, template: '', params: [] });
        outcome = { tone: 'done', message: receipt.duplicate ? 'Esta mensagem já tinha sido enviada.' : 'Mensagem enviada.' };
      } else {
        // The message is in the history as "não confirmada"; retyping it is a deliberate new send.
        update(open ? { ...draft, text: '' } : { ...draft, template: '', params: [] });
        outcome = { tone: 'warning', message: 'O WhatsApp não confirmou o envio. Confira na conversa e, se preciso, com o paciente antes de mandar de novo.' };
      }
    } catch (error) {
      const failure = error instanceof WhatsAppSendError ? error : new WhatsAppSendError('unavailable');
      // A definite refusal frees the request id; an unknown outcome keeps it so a retry cannot duplicate.
      if (!failure.ambiguous) requestId.reset();
      outcome = { tone: failure.ambiguous ? 'warning' : 'error', message: failure.message };
    }
    if (controller.current !== entry) return;
    controller.current = null;
    onSendingChange(false);
    if (!mounted.current || entry.signal.aborted) return;
    setSending(false); setFeedback(outcome);
    onAfterSend();
  };

  return <form aria-label="Responder conversa" className="min-w-0 space-y-3 border-t pt-4" onSubmit={event => { event.preventDefault(); void send(); }}>
    {open ? <div className="min-w-0 space-y-2">
      <Label htmlFor={textId}>Mensagem</Label>
      <textarea id={textId} rows={3} maxLength={MAX_TEXT} value={draft.text} placeholder="Escreva sua resposta"
        className="block min-h-[5.5rem] w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-sm"
        onChange={event => update({ ...draft, text: event.target.value })}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Enter envia · Shift+Enter quebra a linha</p>
        <Button type="submit" className="min-h-11" disabled={!ready || !canSendText}>{sending ? 'Enviando…' : 'Enviar'}</Button>
      </div>
    </div> : <div className="min-w-0 space-y-3">
      <p className="text-sm">Passaram mais de 24 horas desde a última mensagem do paciente. Para responder, envie um modelo aprovado.</p>
      {templates.isPending && templates.fetchStatus !== 'idle' ? <p className="text-sm">Carregando modelos…</p>
        : templates.isError ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Não foi possível carregar os modelos.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void templates.refetch()}>Tentar de novo</Button></div>
        : templates.isSuccess && !approved.length ? <p className="text-sm">A clínica ainda não tem modelos aprovados. Avise o administrador da clínica.</p>
        : templates.isSuccess ? <>
          <div className="min-w-0 space-y-2">
            <Label htmlFor={templateId}>Modelo</Label>
            <select id={templateId} value={chosen ? draft.template : ''} disabled={sending}
              className="block h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
              onChange={event => update({ ...draft, template: event.target.value, params: [] })}>
              <option value="">Escolha um modelo</option>
              {approved.map(row => <option key={templateKey(row)} value={templateKey(row)}>{row.name} ({row.language})</option>)}
            </select>
          </div>
          {chosen && <>
            {params.map((value, index) => <div key={index} className="min-w-0 space-y-1">
              <Label htmlFor={`${templateId}-p${index}`}>Campo {index + 1}</Label>
              <Input id={`${templateId}-p${index}`} className="h-11" maxLength={1024} value={value} disabled={sending}
                aria-invalid={value.length > 0 && !validTemplateParam(value)}
                onChange={event => { const next = params.slice(); next[index] = event.target.value; update({ ...draft, params: next }); }} />
            </div>)}
            {params.some(value => value.length > 0 && !validTemplateParam(value)) && <p className="text-xs text-destructive">Os campos não aceitam quebras de linha nem muitos espaços seguidos.</p>}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Prévia</p>
              <p data-testid="template-preview" className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{previewTemplate(chosen.body, params) || 'Este modelo não tem texto no corpo.'}</p>
            </div>
          </>}
          <div className="flex justify-end"><Button type="submit" className="min-h-11" disabled={!ready || !canSendTemplate}>{sending ? 'Enviando…' : 'Enviar modelo'}</Button></div>
        </> : null}
    </div>}
    {!actionable && <p className="text-xs text-muted-foreground">Não foi possível atualizar a conversa. Atualize antes de enviar.</p>}
    {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.tone === 'done' ? undefined : 'alert'} aria-live="polite"
      className={`rounded-md p-3 text-sm outline-none ${feedback.tone === 'error' ? 'border border-destructive/30 bg-destructive/5' : feedback.tone === 'warning' ? 'border border-amber-500/40 bg-amber-500/10' : 'bg-muted'}`}>{feedback.message}</p>}
  </form>;
}
