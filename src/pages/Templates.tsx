import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileStack, Plus, Search, Pencil, Copy, Trash2, Loader2,
  Sparkles, ClipboardPaste, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface DocumentTemplate {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  content: string;
  created_at: string;
}

type CreateMode = 'ai' | 'example' | 'existing';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('ai');
  const [createInput, setCreateInput] = useState('');
  const [baseTemplateId, setBaseTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', content: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery<DocumentTemplate[]>({
    queryKey: ['document-templates', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_templates')
        .select('id, user_id, name, description, content, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as DocumentTemplate[]) ?? [];
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
  }, [templates, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['document-templates', user?.id] });

  const handleCreate = async () => {
    if (!user?.id) return;
    setCreating(true);
    try {
      if (createMode === 'existing') {
        const base = templates.find(t => t.id === baseTemplateId);
        if (!base) { toast({ title: 'Escolha um modelo de origem', variant: 'destructive' }); return; }
        const { error } = await supabase.from('document_templates').insert({
          user_id: user.id,
          name: `${base.name} (cópia)`,
          description: base.description,
          content: base.content,
        });
        if (error) throw error;
        toast({ title: 'Modelo duplicado', description: 'Edite a cópia como preferir.' });
      } else {
        if (createInput.trim().length < 10) {
          toast({ title: 'Descreva ou cole o conteúdo', description: 'Mínimo de 10 caracteres.', variant: 'destructive' });
          return;
        }
        const { data, error } = await supabase.functions.invoke('create-template-ai', {
          body: {
            mode: createMode === 'example' ? 'from_example' : 'from_description',
            input: createInput,
          },
        });
        if (error) {
          const body = (error as any)?.context?.json ? await (error as any).context.json().catch(() => null) : null;
          throw new Error(body?.error ?? 'Falha na geração');
        }
        const { error: insErr } = await supabase.from('document_templates').insert({
          user_id: user.id,
          name: data.name,
          description: data.description,
          content: data.content,
        });
        if (insErr) throw insErr;
        queryClient.invalidateQueries({ queryKey: ['usage-daily', user.id] });
        toast({ title: 'Modelo criado pela IA', description: `"${data.name}" — revise e ajuste como preferir.` });
      }
      setCreateOpen(false);
      setCreateInput('');
      invalidate();
    } catch (err: any) {
      toast({ title: 'Erro ao criar modelo', description: err?.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (t: DocumentTemplate) => {
    setEditing(t);
    setEditDraft({ name: t.name, description: t.description ?? '', content: t.content });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('document_templates')
        .update({
          name: editDraft.name.trim() || editing.name,
          description: editDraft.description.trim() || null,
          content: editDraft.content,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editing.id);
      if (error) throw error;
      toast({ title: 'Modelo salvo' });
      setEditing(null);
      invalidate();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDuplicate = async (t: DocumentTemplate) => {
    if (!user?.id) return;
    setBusyId(t.id);
    const { error } = await supabase.from('document_templates').insert({
      user_id: user.id, name: `${t.name} (cópia)`, description: t.description, content: t.content,
    });
    setBusyId(null);
    if (error) toast({ title: 'Erro ao duplicar', variant: 'destructive' });
    else { toast({ title: 'Modelo duplicado' }); invalidate(); }
  };

  const handleDelete = async (t: DocumentTemplate) => {
    if (!window.confirm(`Excluir o modelo "${t.name}"?`)) return;
    setBusyId(t.id);
    const { error } = await supabase.from('document_templates').delete().eq('id', t.id);
    setBusyId(null);
    if (error) toast({ title: 'Erro ao excluir', variant: 'destructive' });
    else { toast({ title: 'Modelo excluído' }); invalidate(); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-3 md:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <FileStack className="h-5 w-5 text-medical-blue shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-semibold text-foreground leading-tight">Modelos de Documento</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Estruturas personalizadas para as evoluções geradas pela IA
              </p>
            </div>
          </div>
          <Button variant="medical" size="sm" className="gap-1.5" onClick={() => { setCreateMode('ai'); setCreateOpen(true); }}>
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Criar meu modelo</span>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-3 md:px-4 py-6 max-w-3xl space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquise pelo nome do modelo"
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-sm text-muted-foreground">
            Nenhum modelo encontrado.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(t => {
              const builtin = t.user_id === null;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 bg-white shadow-[0_1px_4px_hsl(0_0%_0%/0.04)]">
                  <div className="w-9 h-9 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-medical-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.description ?? '—'}</p>
                  </div>
                  <span className={cn(
                    'text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0',
                    builtin ? 'bg-medical-blue-light text-medical-blue' : 'bg-green-100 text-green-700',
                  )}>
                    {builtin ? 'Cortex' : 'Meu'}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {!builtin && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Editar" onClick={() => openEdit(t)}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicar" disabled={busyId === t.id} onClick={() => handleDuplicate(t)}>
                      {busyId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                    </Button>
                    {!builtin && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" title="Excluir" disabled={busyId === t.id} onClick={() => handleDelete(t)}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-2">
          O modelo escolhido ao iniciar uma gravação substitui a estrutura SOAP padrão. Use títulos
          (##), itens com descrição e comandos condicionais entre parênteses — ex.:
          "(incluir apenas se mencionado explicitamente na transcrição. Caso contrário, omitir completamente)".
        </p>
      </main>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!creating) setCreateOpen(v); }}>
        <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">Criar modelo</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'ai' as const,       label: 'Criar com IA',        hint: 'Descreva o que deseja',        icon: Sparkles },
                { value: 'example' as const,  label: 'Do meu exemplo',      hint: 'Cole um documento seu',        icon: ClipboardPaste },
                { value: 'existing' as const, label: 'De um existente',     hint: 'Duplique e edite',             icon: Copy },
              ]).map(({ value, label, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCreateMode(value)}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-all',
                    createMode === value
                      ? 'border-medical-blue bg-medical-blue-light/40 ring-1 ring-medical-blue/30'
                      : 'border-border/60 bg-white hover:border-medical-blue/40',
                  )}
                >
                  <Icon className={cn('w-3.5 h-3.5 mb-1', createMode === value ? 'text-medical-blue' : 'text-muted-foreground')} />
                  <p className="text-[11px] font-semibold leading-tight">{label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>
                </button>
              ))}
            </div>

            {createMode === 'existing' ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Modelo de origem</label>
                <select
                  value={baseTemplateId}
                  onChange={e => setBaseTemplateId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg text-sm border border-border bg-background"
                >
                  <option value="">Selecionar…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">
                  {createMode === 'ai'
                    ? 'Descreva o modelo que deseja'
                    : 'Cole seu documento/anamnese/laudo de exemplo'}
                </label>
                <Textarea
                  value={createInput}
                  onChange={e => setCreateInput(e.target.value)}
                  placeholder={createMode === 'ai'
                    ? 'Ex: "Quero uma anamnese para reumatologia pediátrica" ou "Um modelo para organizar resultados de exames em tabela"'
                    : 'Cole aqui um documento real — a IA transforma em modelo reutilizável, removendo os dados do paciente'}
                  className="min-h-[140px] text-sm"
                />
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
            <Button size="sm" className="gap-1.5" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {createMode === 'existing' ? 'Duplicar' : 'Criar modelo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => { if (!v && !savingEdit) setEditing(null); }}>
        <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">Editar modelo</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <Input value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} placeholder="Nome" />
            <Input value={editDraft.description} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} placeholder="Descrição (1 frase)" />
            <Textarea
              value={editDraft.content}
              onChange={e => setEditDraft(d => ({ ...d, content: e.target.value }))}
              className="min-h-[380px] text-xs font-mono leading-relaxed"
            />
          </div>
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={savingEdit}>Cancelar</Button>
            <Button size="sm" className="gap-1.5" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Salvar modelo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
