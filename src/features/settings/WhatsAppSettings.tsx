import { useState } from 'react';
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
  AUTOMATION_PRESETS, describeWhen, whatsappCall,
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
    onSuccess: (r) => { setMessage({ kind: 'ok', text: `${r.templates} modelo(s) sincronizado(s).` }); refresh(); },
    onError: () => setMessage({ kind: 'error', text: 'Não foi possível sincronizar os modelos. Peça à equipe de implantação para revisar a conexão do WhatsApp.' }),
  });

  const [editor, setEditor] = useState<{ open: boolean; initial: Automation | null; preset: Partial<AutomationRule> | null }>({ open: false, initial: null, preset: null });
  const [editorError, setEditorError] = useState('');
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

  return (
    <div className="space-y-6">
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'}>
          {message.text}
        </p>
      )}

      {/* Connection */}
      <div className="rounded-xl border bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e7f6ee] text-[#128c4a]"><MessageCircle className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="font-medium text-foreground">WhatsApp da recepção</p>
              <p className="text-sm text-muted-foreground">
                {s.connected ? `${s.displayPhone ?? ''} · ${s.verifiedName ?? ''}` : 'Nenhum número conectado.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.connected ? <Badge className="bg-success/15 text-success hover:bg-success/15">Conectado</Badge> : <Badge variant="outline">Não conectado</Badge>}
            {s.connected && s.quality && <Badge variant="outline">{QUALITY[s.quality] ?? s.quality}</Badge>}
          </div>
        </div>

        {!s.serverReady && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            O WhatsApp ainda depende da configuração técnica pela equipe de implantação. Os recursos ficam disponíveis após essa etapa.
          </p>
        )}
        {s.canManage && s.lastError && <p className="text-sm text-destructive">A conexão precisa de revisão pela equipe de implantação. Informe a essa equipe que o WhatsApp apresentou uma falha.</p>}

        {s.connected && s.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> {sync.isPending ? 'Sincronizando…' : 'Sincronizar modelos'}
            </Button>

          </div>
        )}

        <p className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
          {s.connected ? 'Conexão técnica mantida pela equipe de implantação. Para trocar o número ou revisar a conexão, fale com essa equipe.' : 'A equipe de implantação conecta e valida o número da clínica. Você não precisa informar IDs, tokens ou senhas nesta tela.'}
        </p>
      </div>

      {/* Templates */}
      {s.connected && (
        <div className="rounded-xl border bg-white p-5 space-y-3">
          <div>
            <p className="font-medium text-foreground">Modelos de mensagem</p>
            <p className="text-sm text-muted-foreground">Fora da janela de 24 h depois da última mensagem do paciente, só modelos aprovados pela Meta podem ser enviados.</p>
          </div>
          {templates.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : templateList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum modelo sincronizado. A equipe de implantação prepara os modelos e acompanha a aprovação pelo WhatsApp. Quando forem aprovados, a lista poderá ser atualizada pela administração.</p>
          ) : (
            <ul className="divide-y">
              {templateList.map((t) => (
                <li key={`${t.name}|${t.language}`} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.language} · {t.category.toLowerCase()}</span>
                    <Badge variant={t.status === 'APPROVED' ? 'secondary' : 'outline'} className="ml-auto">{TEMPLATE_STATUS[t.status] ?? t.status.toLowerCase()}</Badge>
                  </div>
                  {t.body && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{t.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Menu bot */}
      {s.connected && s.canManage && <FlowEditor />}

      {/* Automations */}
      {s.connected && s.canManage && (
        <div className="rounded-xl border bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">Automações da agenda</p>
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
                  className="rounded-lg border border-dashed px-3 py-3 text-left hover:bg-muted/50">
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
                      {describeWhen(r.trigger, r.offsetMinutes)} · modelo <span className="font-mono">{r.templateName}</span>
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
      )}

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
