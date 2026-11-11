import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClinicAccess } from '@/features/reception/accessContext';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  decideStep, LIMITS, validateFlow, type BusinessHours, type FlowNode, type FlowSettings, type SessionState,
} from '../../../supabase/functions/_shared/whatsappFlow';
import { whatsappCall } from './whatsappApi';

type FlowResponse = FlowSettings & { revision: number; updatedAt: string | null; starter: boolean };

const QUEUES: Array<[string, string]> = [
  ['geral', 'Recepção (geral)'], ['agendamento', 'Agendamento'], ['resultados', 'Resultados de exames'], ['financeiro', 'Financeiro'],
];
const DAYS: Array<[keyof BusinessHours, string]> = [['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta'], ['6', 'Sábado'], ['0', 'Domingo']];
const queueLabel = (q: string) => QUEUES.find(([v]) => v === q)?.[1] ?? q;

function destinationLabel(goto: string, nodes: Record<string, FlowNode>): string {
  if (goto === 'close') return 'Encerrar a conversa';
  if (goto.startsWith('queue:')) return `Recepção: ${queueLabel(goto.slice(6))}`;
  return `Etapa: ${nodes[goto]?.title || goto}`;
}

interface ChatLine { from: 'patient' | 'bot' | 'system'; text: string; options?: Array<{ label: string; id: string }> }

/** Settings → WhatsApp → Robô de atendimento: flow editor with a local simulator (nothing is sent). */
export function FlowEditor() {
  const access = useClinicAccess();
  const queryClient = useQueryClient();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const doctors = (access?.doctors ?? []).map((d) => d.name);
  const flow = useQuery({
    queryKey: ['whatsapp-flow', ...scope],
    queryFn: () => whatsappCall<FlowResponse>('flow', { clinicName: access?.clinic?.name ?? '', doctors }),
    staleTime: 0, retry: false, refetchOnMount: 'always',
  });
  const [draft, setDraft] = useState<FlowSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!flow.data || dirty) return;
    const { revision: rev, updatedAt: _u, starter: _s, ...settings } = flow.data;
    setDraft(settings);
    setRevision(rev);
  }, [flow.data, dirty]);

  const edit = (fn: (f: FlowSettings) => FlowSettings) => {
    setDraft((f) => (f ? fn(structuredClone(f)) : f));
    setDirty(true);
    setMessage(null);
  };
  useUnsavedChanges(dirty, 'O robô de atendimento tem mudanças não salvas. Sair e descartar essas mudanças?');
  const errors = useMemo(() => (draft ? validateFlow(draft) : []), [draft]);
  // A refused save (someone else saved first) keeps the old revision: discarding reads the flow again.
  const discard = () => { setDirty(false); setMessage(null); void flow.refetch(); };
  const save = useMutation({
    mutationFn: () => whatsappCall<{ revision: number }>('saveFlow', { revision, flow: draft }),
    onSuccess: (r) => {
      setRevision(r.revision);
      setDirty(false);
      setMessage({ kind: 'ok', text: draft?.enabled ? 'Robô salvo e ativo.' : 'Robô salvo. Ele está desligado.' });
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-flow', ...scope] });
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });

  // Error first: a failed first read must show the retry, not "Carregando" forever.
  if (flow.isError && !dirty)
    return (
      <p role="alert" className="text-sm text-destructive">
        {(flow.error as Error).message}{' '}
        <button type="button" className="underline" onClick={() => flow.refetch()}>Tentar novamente</button>
      </p>
    );
  // Cached data from an earlier visit is not shown until this mount's read answers.
  if (!draft || (!dirty && !flow.isFetchedAfterMount)) return <p className="text-sm text-muted-foreground">Carregando o robô…</p>;

  const nodes = draft.definition.nodes;
  const ids = Object.keys(nodes);
  const destinations: Array<[string, string]> = [
    ...ids.map((id) => [id, `Etapa: ${nodes[id].title || id}`] as [string, string]),
    ...QUEUES.map(([q, label]) => [`queue:${q}`, `Recepção: ${label}`] as [string, string]),
    ['close', 'Encerrar a conversa'],
  ];
  const addNode = () => edit((f) => {
    let n = Object.keys(f.definition.nodes).length + 1;
    while (f.definition.nodes[`etapa_${n}`]) n++;
    f.definition.nodes[`etapa_${n}`] = { title: `Etapa ${n}`, text: '', options: [{ label: 'Falar com a recepção', goto: 'queue:geral' }] };
    return f;
  });

  return (
    <div className="rounded-xl border bg-white p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">Robô de atendimento</p>
            <p className="text-sm text-muted-foreground">
              Responde quem escreve para a clínica com um menu e encaminha para a fila certa. Ele não marca consulta e não pergunta
              sobre saúde. Para quando alguém da recepção assume a conversa.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.enabled} onCheckedChange={(v) => edit((f) => ({ ...f, enabled: v }))} aria-label="Robô ativo" />
          {draft.enabled ? 'Ativo' : 'Desligado'}
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4 min-w-0">
          {ids.map((id) => {
            const node = nodes[id];
            const isStart = draft.definition.start === id;
            return (
              <fieldset key={id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Nome da etapa" value={node.title} maxLength={LIMITS.title} className="h-9 max-w-xs font-medium"
                    onChange={(e) => edit((f) => { f.definition.nodes[id].title = e.target.value; return f; })} />
                  {isStart ? <Badge variant="secondary">Início</Badge> : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => edit((f) => { f.definition.start = id; return f; })}>Definir como início</Button>
                  )}
                  {!isStart && (
                    <Button type="button" size="icon" variant="ghost" className="ml-auto" aria-label={`Excluir a etapa ${node.title || id}`}
                      onClick={() => edit((f) => { delete f.definition.nodes[id]; return f; })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Textarea aria-label={`Mensagem da etapa ${node.title || id}`} value={node.text} rows={3}
                  maxLength={node.options.length ? LIMITS.menuText : LIMITS.text} placeholder="Mensagem enviada ao paciente"
                  onChange={(e) => edit((f) => { f.definition.nodes[id].text = e.target.value; return f; })} />
                {node.options.map((o, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center">
                    <Input aria-label={`Opção ${i + 1} da etapa ${node.title || id}`} value={o.label} maxLength={LIMITS.label} placeholder={`Opção ${i + 1}`}
                      onChange={(e) => edit((f) => { f.definition.nodes[id].options[i].label = e.target.value; return f; })} />
                    <Select value={o.goto} onValueChange={(v) => edit((f) => { f.definition.nodes[id].options[i].goto = v; return f; })}>
                      <SelectTrigger aria-label={`Destino da opção ${i + 1}`}><SelectValue placeholder="Para onde vai" /></SelectTrigger>
                      <SelectContent>
                        {destinations.filter(([v]) => v !== id).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remover a opção ${i + 1}`}
                      onClick={() => edit((f) => { f.definition.nodes[id].options.splice(i, 1); return f; })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  {node.options.length < LIMITS.options && (
                    <Button type="button" size="sm" variant="outline"
                      onClick={() => edit((f) => { f.definition.nodes[id].options.push({ label: '', goto: 'queue:geral' }); delete f.definition.nodes[id].then; return f; })}>
                      <Plus className="h-4 w-4 mr-1" /> Opção
                    </Button>
                  )}
                  {!node.options.length && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Depois desta mensagem:</span>
                      <Select value={node.then ?? ''} onValueChange={(v) => edit((f) => { f.definition.nodes[id].then = v; return f; })}>
                        <SelectTrigger className="w-56" aria-label="O que acontece depois"><SelectValue placeholder="Escolha" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="close">Encerrar a conversa</SelectItem>
                          {QUEUES.map(([q, label]) => <SelectItem key={q} value={`queue:${q}`}>Recepção: {label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {node.options.length > 3 && <p className="text-xs text-muted-foreground">Com mais de 3 opções, o paciente vê uma lista (“Ver opções”).</p>}
              </fieldset>
            );
          })}
          <Button type="button" variant="outline" onClick={addNode} disabled={ids.length >= LIMITS.nodes}><Plus className="h-4 w-4 mr-1.5" /> Nova etapa</Button>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="flow-handoff">Mensagem ao encaminhar para a recepção</Label>
              <Textarea id="flow-handoff" rows={2} maxLength={LIMITS.aux} value={draft.handoffText}
                onChange={(e) => edit((f) => ({ ...f, handoffText: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flow-after-hours">Mensagem fora do horário</Label>
              <Textarea id="flow-after-hours" rows={2} maxLength={LIMITS.aux} value={draft.afterHoursText}
                onChange={(e) => edit((f) => ({ ...f, afterHoursText: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Enviada antes do menu quando a clínica está fechada.</p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Horário de atendimento</legend>
            {DAYS.map(([day, label]) => {
              const range = draft.hours[day];
              return (
                <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-28 items-center gap-2">
                    <Checkbox aria-label={`Atende na ${label.toLowerCase()}`} checked={!!range} onCheckedChange={(v) => edit((f) => {
                      if (v === true) f.hours[day] = ['08:00', '18:00']; else delete f.hours[day];
                      return f;
                    })} />
                    {label}
                  </label>
                  {range && (
                    <>
                      <Input type="time" aria-label={`Abre ${label}`} className="h-9 w-28" value={range[0]}
                        onChange={(e) => edit((f) => { f.hours[day] = [e.target.value, f.hours[day]![1]]; return f; })} />
                      <span>às</span>
                      <Input type="time" aria-label={`Fecha ${label}`} className="h-9 w-28" value={range[1]}
                        onChange={(e) => edit((f) => { f.hours[day] = [f.hours[day]![0], e.target.value]; return f; })} />
                    </>
                  )}
                </div>
              );
            })}
          </fieldset>

          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="flow-default-queue">Fila quando o robô não entende</Label>
            <Select value={draft.defaultQueue} onValueChange={(v) => edit((f) => ({ ...f, defaultQueue: v }))}>
              <SelectTrigger id="flow-default-queue"><SelectValue /></SelectTrigger>
              <SelectContent>{QUEUES.map(([q, label]) => <SelectItem key={q} value={q}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {errors.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
              {errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'}>{message.text}</p>}
          {/* Sticky: the editor is long, and saving must not need a scroll back. */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-white/95 px-3 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
            <Button onClick={() => save.mutate()} disabled={save.isPending || errors.length > 0 || !dirty}>{save.isPending ? 'Salvando…' : 'Salvar robô'}</Button>
            {dirty && <Button variant="ghost" onClick={discard} disabled={save.isPending}>Descartar mudanças</Button>}
            <span role="status" className="text-sm text-muted-foreground">{dirty ? 'Mudanças não salvas' : ''}</span>
          </div>
        </div>

        <FlowSimulator flow={draft} valid={errors.length === 0} />
      </div>
    </div>
  );
}

/** Runs the same decision code as the server, locally. Nothing is sent to anyone. */
function FlowSimulator({ flow, valid }: { flow: FlowSettings; valid: boolean }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [session, setSession] = useState<SessionState | null>(null);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState('');
  const [afterHours, setAfterHours] = useState(false);
  const reset = () => { setLines([]); setSession(null); setEnded(false); setText(''); };
  useEffect(reset, [flow]);

  const send = (body: string, replyId: string | null = null) => {
    if (!body.trim() || !valid) return;
    const step = decideStep(flow, ended ? null : session, { kind: replyId ? 'interactive' : 'text', body, replyId }, !afterHours);
    const next: ChatLine[] = [{ from: 'patient', text: body }];
    for (const m of step.messages) {
      const interactive = m.graph.interactive as { action?: { buttons?: Array<{ reply: { id: string; title: string } }>; sections?: Array<{ rows: Array<{ id: string; title: string }> }> } } | undefined;
      const options = interactive?.action?.buttons?.map((b) => ({ id: b.reply.id, label: b.reply.title }))
        ?? interactive?.action?.sections?.[0]?.rows.map((r) => ({ id: r.id, label: r.title }));
      const textPart = m.body.split('\n\n').filter((p) => !/^1\. /.test(p)).join('\n\n');
      next.push({ from: 'bot', text: options ? textPart : m.body, options });
    }
    if (step.queue) next.push({ from: 'system', text: `Conversa vai para a fila “${queueLabel(step.queue)}”, sem responsável.` });
    if (step.close) next.push({ from: 'system', text: 'Conversa encerrada. Uma nova mensagem recomeça o menu.' });
    setLines((l) => [...l, ...next]);
    setSession(step.status === 'active' ? { node: step.node, attempts: step.attempts, path: step.path } : null);
    setEnded(step.status !== 'active');
    setText('');
  };

  return (
    <aside className="rounded-lg border bg-muted/30 p-3 space-y-3 self-start xl:sticky xl:top-20" aria-label="Simulador do robô">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Simulador</p>
        <Button type="button" size="sm" variant="ghost" onClick={reset}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reiniciar</Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox aria-label="Simular fora do horário" checked={afterHours} onCheckedChange={(v) => setAfterHours(v === true)} /> Simular fora do horário
      </label>
      <div className="min-h-48 max-h-96 overflow-y-auto space-y-2 rounded-md bg-[#efeae2] p-2" aria-live="polite">
        {!lines.length && <p className="p-2 text-xs text-muted-foreground">Escreva como se fosse o paciente. Nada é enviado.</p>}
        {lines.map((l, i) => l.from === 'system' ? (
          <p key={i} className="text-center text-[11px] text-muted-foreground">{l.text}</p>
        ) : (
          <div key={i} className={l.from === 'patient' ? 'ml-auto max-w-[85%] rounded-lg bg-[#d9fdd3] px-2.5 py-1.5 text-sm' : 'max-w-[85%] rounded-lg bg-white px-2.5 py-1.5 text-sm'}>
            <p className="whitespace-pre-wrap">{l.text}</p>
            {l.options && (
              <div className="mt-1.5 flex flex-col gap-1">
                {l.options.map((o) => (
                  <button key={o.id} type="button" className="rounded border border-[#128c4a]/30 px-2 py-1 text-xs text-[#128c4a] hover:bg-[#128c4a]/5"
                    onClick={() => send(o.label, o.id)}>{o.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <Input aria-label="Mensagem do paciente (simulação)" value={text} onChange={(e) => setText(e.target.value)} placeholder={valid ? 'Oi' : 'Corrija o robô para simular'} disabled={!valid} />
        <Button type="submit" size="icon" aria-label="Enviar na simulação" disabled={!valid || !text.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </aside>
  );
}
