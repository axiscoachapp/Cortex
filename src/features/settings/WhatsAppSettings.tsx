import { useState } from 'react';
import { SupportRequest } from '@/components/SupportRequest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useClinicAccess } from '@/features/reception/accessContext';
import { managedWhatsAppReason } from '@/lib/managedSetupMessages';
import { AutomationEditor } from './AutomationEditor';
import { FlowEditor } from './FlowEditor';
import {
  AUTOMATION_PRESETS, describeWhen, templateDetails, templateLabel, whatsappCall,
  type Automation, type AutomationRule, type AutomationRun, type WhatsAppState, type WhatsAppTemplate,
} from './whatsappApi';

const QUALITY: Record<string, string> = { GREEN: 'Qualidade alta', YELLOW: 'Qualidade média', RED: 'Qualidade baixa' };
const TEMPLATE_STATUS: Record<string, string> = { APPROVED: 'Aprovado', PENDING: 'Em análise', REJECTED: 'Recusado', PAUSED: 'Pausado', DISABLED: 'Desativado' };
const RUN_STATUS: Record<AutomationRun['status'], string> = { pending: 'Enviando', sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada' };
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function WhatsAppSettings() {
  const access = useClinicAccess();
  const queryClient = useQueryClient();
  // Role is part of the scope: losing admin never shows cached admin data, even during a refetch.
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none', access?.admin ? 'admin' : 'member'];
  const state = useQuery({
    queryKey: ['whatsapp-state', ...scope], queryFn: () => whatsappCall<WhatsAppState>('state'), retry: false, staleTime: 0, refetchOnMount: 'always',
  });
  const s = state.data;
  const templates = useQuery({
    queryKey: ['whatsapp-templates', ...scope],
    queryFn: () => whatsappCall<{ templates: WhatsAppTemplate[] }>('templates'),
    enabled: !!s?.connected && s.canUseInbox,
  });
  const automations = useQuery({
    queryKey: ['whatsapp-automations', ...scope],
    queryFn: () => whatsappCall<{ automations: Automation[]; runs: AutomationRun[] }>('automations'),
    enabled: !!s?.connected && s.canManage,
  });
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('whatsapp-') });

  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const sync = useMutation({
    mutationFn: () => whatsappCall<{ templates: number }>('syncTemplates'),
    onSuccess: (r) => { setMessage({ kind: 'ok', text: `${r.templates} modelo(s) atualizado(s).` }); refresh(); },
    onError: () => setMessage({ kind: 'error', text: 'Não foi possível atualizar os modelos. Avise a equipe Cortex pelo pedido em Número e modelos.' }),
  });

  const [editor, setEditor] = useState<{ open: boolean; initial: Automation | null; preset: Partial<AutomationRule> | null }>({ open: false, initial: null, preset: null });
  const [editorError, setEditorError] = useState('');
  const [tab, setTab] = useState('lembretes');
  const save = useMutation({
    mutationFn: ({ rule, initial }: { rule: AutomationRule; initial: Automation | null }) =>
      whatsappCall('saveAutomation', { rule, ...(initial ? { id: initial.id, revision: initial.revision } : {}) }),
    onSuccess: () => { setEditor((e) => ({ ...e, open: false })); refresh(); },
    onError: (e: Error) => setEditorError(e.message),
  });
  const toggle = useMutation({
    mutationFn: (a: Automation) => whatsappCall('saveAutomation', {
      id: a.id, revision: a.revision,
      rule: { name: a.name, enabled: !a.enabled, trigger: a.trigger, offsetMinutes: a.offsetMinutes, templateName: a.templateName, templateLanguage: a.templateLanguage,
        params: a.params, linkUrl: a.linkUrl, doctorIds: a.doctorIds, appointmentTypes: a.appointmentTypes },
    }),
    onSettled: refresh,
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => whatsappCall('deleteAutomation', { id }),
    onSettled: refresh,
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });

  // Cached state from an earlier visit (possibly another role) never drives the controls: wait for
  // this mount's own read, or show its error.
  if (state.isLoading || (!state.isError && !state.isFetchedAfterMount))
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verificando o WhatsApp…</p>;
  if (state.isError || !s)
    return (
      <div role="alert" className="text-sm text-destructive">
        {(state.error as Error)?.message ?? 'Não foi possível verificar o WhatsApp.'}{' '}
        <button type="button" className="underline" onClick={() => state.refetch()}>Tentar novamente</button>
      </div>
    );

  const templateList = templates.data?.templates ?? [];
  const rules = automations.data?.automations ?? [];
  const runs = automations.data?.runs ?? [];
  const ruleName = new Map(rules.map((r) => [r.id, r.name]));
  const templateName = (name: string, language: string) => {
    const t = templateList.find((x) => x.name === name && x.language === language);
    return templateLabel(t?.name ?? name);
  };

  const notice = message && (
    <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'}>
      {message.text}
    </p>
  );

  // No number yet: say so plainly, and who can act.
  if (!s.connected) {
    return (
      <div className="space-y-4 rounded-xl border bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e7f6ee] text-[#128c4a]"><MessageCircle className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">WhatsApp da clínica</p>
            <Badge variant="outline">Não conectado</Badge>
          </div>
        </div>
        {s.canManage ? (
          <>
            <p className="text-sm leading-relaxed">O WhatsApp da clínica ainda não foi conectado. A conexão é feita pela equipe Cortex.</p>
            <p className="text-sm leading-relaxed text-muted-foreground">Depois de conectado, aqui você liga os lembretes automáticos das consultas e o robô de atendimento.</p>
            <SupportRequest subject="Conectar o WhatsApp da clínica" clinicName={access?.clinic?.name}>
              Peça a conexão à equipe Cortex. Você não precisa informar IDs, tokens ou senhas.
            </SupportRequest>
          </>
        ) : (
          <p className="text-sm leading-relaxed">O WhatsApp da clínica ainda não está conectado. Avise o administrador da clínica.</p>
        )}
      </div>
    );
  }

  const connection = (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e7f6ee] text-[#128c4a]"><MessageCircle className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="font-medium text-foreground">WhatsApp da recepção</p>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{`${s.displayPhone ?? ''} · ${s.verifiedName ?? ''}`}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-success/15 text-success hover:bg-success/15">Conectado</Badge>
            {s.quality && <Badge variant="outline">{QUALITY[s.quality] ?? s.quality}</Badge>}
          </div>
        </div>
        {!s.serverReady && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            O WhatsApp ainda depende de uma configuração técnica da equipe Cortex. Os recursos ficam disponíveis depois dela.
          </p>
        )}
        {s.canManage && s.lastError && <p className="text-sm text-destructive">O WhatsApp apresentou uma falha na conexão. Avise a equipe Cortex pelo pedido abaixo.</p>}
        {s.canManage && (
          <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> {sync.isPending ? 'Atualizando…' : 'Atualizar modelos'}
          </Button>
        )}
        {s.canManage && (
          <SupportRequest subject="Número ou modelos do WhatsApp" clinicName={access?.clinic?.name} className="border-t pt-4">
            O número e os modelos de mensagem são mantidos pela equipe Cortex. Para trocar o número ou pedir um modelo novo, envie um pedido.
          </SupportRequest>
        )}
      </div>

      <div className="rounded-xl border bg-white p-5 space-y-3">
        <div>
          <p className="font-medium text-foreground">Modelos de mensagem</p>
          <p className="text-sm text-muted-foreground">Fora da janela de 24 h depois da última mensagem do paciente, só modelos aprovados pela Meta podem ser enviados.</p>
        </div>
        {templates.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : templateList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum modelo ainda. A equipe Cortex prepara os modelos e acompanha a aprovação pelo WhatsApp.</p>
        ) : (
          <ul className="divide-y">
            {templateList.map((t) => (
              <li key={`${t.name}|${t.language}`} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium" title={t.name}>{templateLabel(t.name)}</span>
                  <span className="text-xs text-muted-foreground">{templateDetails(t)}</span>
                  <Badge variant={t.status === 'APPROVED' ? 'secondary' : 'outline'} className="ml-auto">{TEMPLATE_STATUS[t.status] ?? t.status.toLowerCase()}</Badge>
                </div>
                {t.body && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{t.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  if (!s.canManage) return <div className="space-y-6">{notice}{connection}</div>;

  const reminders = (
    <div className="rounded-xl border bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">Lembretes automáticos</p>
          <p className="text-sm text-muted-foreground">Mensagens que saem sozinhas antes ou depois das consultas, das 8h às 20h.</p>
        </div>
        <Button size="sm" onClick={() => { setEditorError(''); setEditor({ open: true, initial: null, preset: null }); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Nova automação
        </Button>
      </div>
      {rules.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {AUTOMATION_PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => { setEditorError(''); setEditor({ open: true, initial: null, preset: p.rule }); }}
              className="min-h-11 rounded-lg border border-dashed px-3 py-3 text-left hover:bg-muted/50">
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </button>
          ))}
        </div>
      )}
      {rules.length > 0 && (
        <ul className="divide-y">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {describeWhen(r.trigger, r.offsetMinutes)} · modelo “{templateName(r.templateName, r.templateLanguage)}”
                  {r.doctorIds?.length ? ` · ${r.doctorIds.length} médico(s)` : ' · todos os médicos'}
                </p>
              </div>
              <Switch checked={r.enabled} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(r)} aria-label={`${r.enabled ? 'Desativar' : 'Ativar'} ${r.name}`} />
              <Button size="icon" variant="ghost" aria-label={`Editar ${r.name}`} onClick={() => { setEditorError(''); setEditor({ open: true, initial: r, preset: null }); }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Excluir ${r.name}`} disabled={remove.isPending}
                onClick={() => window.confirm(`Excluir a automação “${r.name}”?`) && remove.mutate(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">Últimos envios</p>
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum envio ainda.</p> : (
          <ul className="space-y-1.5 text-sm">
            {runs.slice(0, 20).map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-muted-foreground">{dateTime(run.at)}</span>
                <span>{ruleName.get(run.automationId) ?? 'Automação'}</span>
                <span className="text-muted-foreground">· consulta {dateTime(run.appointmentStart)}</span>
                <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'} className="text-xs">{RUN_STATUS[run.status]}</Badge>
                {run.reply && <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Respondeu “{run.reply}”</span>}
                {run.reason && <span className="w-full text-xs text-muted-foreground">{managedWhatsAppReason(run.reason)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // Every tab stays mounted (hidden when inactive) so switching tabs never drops an unsaved bot edit.
  const panel = 'mt-4 focus-visible:outline-none data-[state=inactive]:hidden';
  return (
    <div className="space-y-4">
      {notice}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="lembretes" className="min-h-11">Lembretes automáticos</TabsTrigger>
          <TabsTrigger value="robo" className="min-h-11">Robô de atendimento</TabsTrigger>
          <TabsTrigger value="numero" className="min-h-11">Número e modelos</TabsTrigger>
        </TabsList>
        <TabsContent value="lembretes" forceMount className={panel}>{reminders}</TabsContent>
        <TabsContent value="robo" forceMount className={panel}><FlowEditor /></TabsContent>
        <TabsContent value="numero" forceMount className={panel}>{connection}</TabsContent>
      </Tabs>

      <AutomationEditor
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        templates={templateList}
        doctors={access?.doctors ?? []}
        initial={editor.initial}
        preset={editor.preset}
        saving={save.isPending}
        error={editorError}
        onSave={(rule) => { setEditorError(''); save.mutate({ rule, initial: editor.initial }); }}
      />
    </div>
  );
}
