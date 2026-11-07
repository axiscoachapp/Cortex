import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useClinicAccess } from '@/features/reception/accessContext';
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

  const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', pin: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const connect = useMutation({
    mutationFn: () => whatsappCall<{ displayPhone: string; templates: number }>('connect', {
      phoneNumberId: form.phoneNumberId.trim(), wabaId: form.wabaId.trim(), accessToken: form.accessToken.trim(), ...(form.pin.trim() ? { pin: form.pin.trim() } : {}),
    }),
    onSuccess: (r) => {
      setForm({ phoneNumberId: '', wabaId: '', accessToken: '', pin: '' });
      setMessage({ kind: 'ok', text: `Número ${r.displayPhone} conectado. ${r.templates} modelo(s) sincronizado(s).` });
      refresh();
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });
  const disconnect = useMutation({
    mutationFn: () => whatsappCall('disconnect'),
    onSuccess: () => { setMessage({ kind: 'ok', text: 'WhatsApp desconectado. O token foi apagado.' }); refresh(); },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });
  const sync = useMutation({
    mutationFn: () => whatsappCall<{ templates: number }>('syncTemplates'),
    onSuccess: (r) => { setMessage({ kind: 'ok', text: `${r.templates} modelo(s) sincronizado(s).` }); refresh(); },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
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
            O servidor desta clínica ainda não recebeu as chaves do WhatsApp. A equipe de implantação configura isso uma vez; depois, o
            administrador conecta o número aqui.
          </p>
        )}
        {s.canManage && s.lastError && <p className="text-sm text-destructive">Último erro: {s.lastError}</p>}

        {s.connected && s.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> {sync.isPending ? 'Sincronizando…' : 'Sincronizar modelos'}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={disconnect.isPending}
              onClick={() => window.confirm('Desconectar o WhatsApp? As automações param até reconectar.') && disconnect.mutate()}>
              <Unplug className="h-4 w-4 mr-1.5" /> Desconectar
            </Button>
          </div>
        )}

        {!s.connected && s.canManage && s.serverReady && (
          <form className="space-y-3 border-t pt-4" onSubmit={(e) => { e.preventDefault(); setMessage(null); connect.mutate(); }}>
            <details className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Como obter esses dados na Meta</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>No Meta Business da clínica, verifique a empresa (CNPJ) e crie um app do tipo “Empresa” com o produto WhatsApp.</li>
                <li>Adicione o número dedicado da recepção. Ao registrá-lo, escolha armazenamento local no Brasil.</li>
                <li>Em “Usuários do sistema”, gere um token permanente com as permissões whatsapp_business_messaging e whatsapp_business_management.</li>
                <li>Copie o “ID do número de telefone” e o “ID da conta do WhatsApp Business” na tela de configuração da API.</li>
                {s.webhookUrl && <li>Em Webhooks, use o endereço abaixo e assine o campo “messages”.</li>}
              </ol>
              {s.webhookUrl && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs">{s.webhookUrl}</code>
                  <Button type="button" size="icon" variant="ghost" aria-label="Copiar endereço do webhook" onClick={() => navigator.clipboard?.writeText(s.webhookUrl!)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </details>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone-id">ID do número de telefone</Label>
                <Input id="wa-phone-id" inputMode="numeric" autoComplete="off" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-waba-id">ID da conta do WhatsApp Business</Label>
                <Input id="wa-waba-id" inputMode="numeric" autoComplete="off" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-token">Token de acesso (usuário do sistema)</Label>
              <Input id="wa-token" type="password" autoComplete="off" spellCheck={false} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
              <p className="text-xs text-muted-foreground">Fica guardado cifrado no servidor e não aparece de novo em lugar nenhum.</p>
            </div>
            <div className="space-y-1.5 sm:max-w-[14rem]">
              <Label htmlFor="wa-pin">PIN de duas etapas (opcional)</Label>
              <Input id="wa-pin" inputMode="numeric" maxLength={6} autoComplete="off" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
              <p className="text-xs text-muted-foreground">Só para registrar um número novo.</p>
            </div>
            <Button type="submit" disabled={connect.isPending || !form.phoneNumberId || !form.wabaId || !form.accessToken}>
              {connect.isPending ? 'Conectando…' : 'Conectar número'}
            </Button>
          </form>
        )}
        {!s.connected && !s.canManage && <p className="text-sm text-muted-foreground">O administrador da clínica conecta o número.</p>}
      </div>

      {/* Templates */}
      {s.connected && (
        <div className="rounded-xl border bg-white p-5 space-y-3">
          <div>
            <p className="font-medium text-foreground">Modelos de mensagem</p>
            <p className="text-sm text-muted-foreground">Fora da janela de 24 h depois da última mensagem do paciente, só modelos aprovados pela Meta podem ser enviados.</p>
          </div>
          {templates.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : templateList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum modelo sincronizado. Crie os modelos no WhatsApp Manager e clique em “Sincronizar modelos”.</p>
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
                    {run.reason && <span className="w-full text-xs text-muted-foreground">{run.reason}</span>}
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
