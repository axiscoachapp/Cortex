import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Copy, Trash2, Loader2, Sparkles, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { fetchAllRows } from '@/lib/pagination';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { functionErrorBody } from '@/lib/functionErrors';
import { ClinicalMarkdown } from '@/components/ClinicalMarkdown';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';

export interface DocumentTemplate {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  content: string;
  created_at: string;
}

type CreateMode = 'ai' | 'existing';

export default function TemplatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('ai');
  const [createInput, setCreateInput] = useState('');
  const [templateReviewed, setTemplateReviewed] = useState(false);
  const [baseTemplateId, setBaseTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', content: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentTemplate | null>(null);

  const {
    data: templates = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<DocumentTemplate[]>({
    queryKey: ['document-templates', user?.id],
    queryFn: async () => {
      const data = await fetchAllRows<DocumentTemplate>((from, to) =>
        supabase
          .from('document_templates')
          .select('id, user_id, name, description, content, created_at')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      );
      return data;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
  }, [templates, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['document-templates', user?.id] });
  const editDirty =
    !!editing &&
    (!editing.id ||
      editDraft.name !== editing.name ||
      editDraft.description !== (editing.description ?? '') ||
      editDraft.content !== editing.content);
  const createDirty = createOpen && (!!createInput.trim() || !!baseTemplateId);
  const canClose = useUnsavedChanges(editDirty || createDirty);
  useEffect(() => {
    if (!editDirty && !createDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editDirty, createDirty]);
  const closeEditor = () => {
    if (!savingEdit && canClose(false)) setEditing(null);
  };
  const closeCreate = (next: boolean) => {
    if (creating || !canClose(next)) return;
    if (!next) {
      setCreateInput('');
      setBaseTemplateId('');
    }
    setCreateOpen(next);
  };

  const handleCreate = async () => {
    if (!user?.id) return;
    setCreating(true);
    try {
      if (createMode === 'existing') {
        const base = templates.find((t) => t.id === baseTemplateId);
        if (!base) {
          toast({ title: 'Escolha um modelo de origem', variant: 'destructive' });
          return;
        }
        const { error } = await supabase.from('document_templates').insert({
          user_id: user.id,
          name: `${base.name} (cópia)`,
          description: base.description,
          content: base.content,
        });
        if (error) throw error;
        toast({ title: 'Modelo duplicado', description: 'Edite a cópia como preferir.' });
      } else {
        if (!createInput) {
          toast({ title: 'Selecione a especialidade', variant: 'destructive' });
          return;
        }
        const { data, error } = await supabase.functions.invoke('create-template-ai', {
          body: {
            mode: 'from_structure',
            specialty: createInput,
          },
        });
        if (error) {
          const body = await functionErrorBody(error);
          throw new Error(typeof body?.error === 'string' ? body.error : 'Falha na geração');
        }
        if (!data || typeof data.name !== 'string' || typeof data.content !== 'string' || !data.content.trim())
          throw new Error('Modelo inválido');
        setEditing({
          id: '',
          user_id: user.id,
          name: data.name,
          description: data.description ?? '',
          content: data.content,
          created_at: new Date().toISOString(),
        });
        setEditDraft({ name: data.name, description: data.description ?? '', content: data.content });
        setTemplateReviewed(false);
        queryClient.invalidateQueries({ queryKey: ['usage-daily', user.id] });
        toast({ title: 'Rascunho gerado', description: 'Revise todo o conteúdo e confirme antes de ativar o modelo.' });
      }
      setCreateOpen(false);
      setCreateInput('');
      invalidate();
    } catch {
      toast({
        title: 'Erro ao criar modelo',
        description: 'Seu rascunho foi mantido. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (t: DocumentTemplate) => {
    setEditing(t);
    setEditDraft({ name: t.name, description: t.description ?? '', content: t.content });
  };

  const handleSaveEdit = async () => {
    if (!editing || savingEdit || (!editing.id && !templateReviewed)) return;
    if (!editDraft.name.trim() || !editDraft.content.trim()) {
      toast({ title: 'Preencha o nome e o conteúdo do modelo', variant: 'destructive' });
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        name: editDraft.name.trim(),
        description: editDraft.description.trim() || null,
        content: editDraft.content,
        updated_at: new Date().toISOString(),
      };
      const { error } = editing.id
        ? await supabase.from('document_templates').update(payload).eq('id', editing.id)
        : await supabase.from('document_templates').insert({ ...payload, user_id: user!.id });
      if (error) throw error;
      toast({ title: 'Modelo salvo' });
      setEditing(null);
      invalidate();
    } catch {
      toast({
        title: 'Erro ao salvar',
        description: 'Suas alterações foram mantidas. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDuplicate = async (t: DocumentTemplate) => {
    if (!user?.id) return;
    setBusyId(t.id);
    const { error } = await supabase.from('document_templates').insert({
      user_id: user.id,
      name: `${t.name} (cópia)`,
      description: t.description,
      content: t.content,
    });
    setBusyId(null);
    if (error) toast({ title: 'Erro ao duplicar', variant: 'destructive' });
    else {
      toast({ title: 'Modelo duplicado' });
      invalidate();
    }
  };

  const handleDelete = async (t: DocumentTemplate) => {
    if (!window.confirm(`Excluir o modelo "${t.name}"?`)) return;
    setBusyId(t.id);
    const { error } = await supabase.from('document_templates').delete().eq('id', t.id);
    setBusyId(null);
    if (error) toast({ title: 'Erro ao excluir', variant: 'destructive' });
    else {
      toast({ title: 'Modelo excluído' });
      invalidate();
    }
  };

  return (
    <WorkspaceShell section="Modelos" contentClassName="space-y-6">
      <PageHeading title="Modelos de documento" description="Escolha e personalize as estruturas usadas nas suas evoluções. Todo texto gerado precisa da sua revisão." actions={
          <Button
            variant="medical"
            aria-label="Criar meu modelo"
            className="min-h-11 gap-2"
            onClick={() => {
              setCreateMode('ai');
              setCreateOpen(true);
            }}
          >
            <Sparkles className="w-4 h-4" />
            Criar meu modelo
          </Button>
      } />
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            aria-label="Buscar modelos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome do modelo…"
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div role="alert" className="text-center py-10 space-y-3">
            <p>Não foi possível carregar os modelos.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-sm text-muted-foreground">Nenhum modelo encontrado.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => {
              const builtin = t.user_id === null;
              return (
                <div
                  key={t.id}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-3 rounded-xl border border-border/60 bg-white shadow-[0_1px_4px_hsl(0_0%_0%/0.04)]"
                >
                  <div className="w-9 h-9 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-medical-blue" />
                  </div>
                  {/* On a phone the name keeps the whole first line; the badge
                      and actions move to a second line under it. */}
                  <button type="button" onClick={() => setPreview(t)} aria-label={`Pré-visualizar ${t.name}`} className="flex-1 min-w-[calc(100%-3rem)] sm:min-w-0 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <p className="text-sm font-semibold text-foreground line-clamp-2 break-words sm:truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.description ?? '—'}</p>
                  </button>
                  <span
                    className={cn(
                      'text-[0.5625rem] font-bold px-1.5 py-0.5 rounded shrink-0 ml-12 sm:ml-0',
                      builtin ? 'bg-medical-blue-light text-medical-blue' : 'bg-green-100 text-green-700',
                    )}
                  >
                    {builtin ? 'Cortex' : 'Meu'}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {!builtin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Editar"
                        aria-label={`Editar ${t.name}`}
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Duplicar"
                      aria-label={`Duplicar ${t.name}`}
                      disabled={busyId === t.id}
                      onClick={() => handleDuplicate(t)}
                    >
                      {busyId === t.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </Button>
                    {!builtin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 hover:text-destructive"
                        title="Excluir"
                        aria-label={`Excluir ${t.name}`}
                        disabled={busyId === t.id}
                        onClick={() => handleDelete(t)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[0.6875rem] text-muted-foreground leading-relaxed pt-2">
          O modelo escolhido ao iniciar uma gravação substitui a estrutura SOAP padrão. Use títulos (##), itens com
          descrição e comandos condicionais entre parênteses — ex.: "(incluir apenas se mencionado explicitamente na
          transcrição. Caso contrário, omitir completamente)".
        </p>
      </div>

      <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{preview?.name}</DialogTitle><DialogDescription>{preview?.description || 'Pré-visualização do modelo. Nenhuma consulta é criada e nenhum crédito é consumido.'}</DialogDescription></DialogHeader>
          <ClinicalMarkdown text={preview?.content ?? ''} />
          <Button variant="outline" onClick={() => { if (preview) void handleDuplicate(preview); }}>Duplicar para personalizar</Button>
        </DialogContent>
      </Dialog>
      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">Criar modelo</DialogTitle>
            <DialogDescription className="sr-only">
              Crie um modelo a partir de uma estrutura vazia de especialidade ou de um modelo existente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'ai' as const, label: 'Criar com IA', hint: 'Descreva o que deseja', icon: Sparkles },

                { value: 'existing' as const, label: 'De um existente', hint: 'Duplique e edite', icon: Copy },
              ].map(({ value, label, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={createMode === value}
                  onClick={() => setCreateMode(value)}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-all',
                    createMode === value
                      ? 'border-medical-blue bg-medical-blue-light/40 ring-1 ring-medical-blue/30'
                      : 'border-border/60 bg-white hover:border-medical-blue/40',
                  )}
                >
                  <Icon
                    className={cn(
                      'w-3.5 h-3.5 mb-1',
                      createMode === value ? 'text-medical-blue' : 'text-muted-foreground',
                    )}
                  />
                  <p className="text-[0.6875rem] font-semibold leading-tight">{label}</p>
                  <p className="text-[0.5625rem] text-muted-foreground mt-0.5 leading-tight">{hint}</p>
                </button>
              ))}
            </div>

            {createMode === 'existing' ? (
              <div className="space-y-1.5">
                <label htmlFor="template-source" className="text-xs font-medium text-foreground/80">
                  Modelo de origem
                </label>
                <select
                  id="template-source"
                  value={baseTemplateId}
                  onChange={(e) => setBaseTemplateId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg text-sm border border-border bg-background"
                >
                  <option value="">Selecionar…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="template-specialty" className="text-xs font-medium">
                  Estrutura da consulta
                </label>
                <select
                  id="template-specialty"
                  className="w-full h-10 rounded-md border bg-background px-3"
                  value={createInput}
                  onChange={(e) => setCreateInput(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  <option value="ginecologia">Ginecologia</option>
                  <option value="prenatal">Pré-natal</option>
                  <option value="urologia">Urologia</option>
                  <option value="retorno">Retorno</option>
                  <option value="geral">Consulta geral</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  A geração usa apenas a estrutura selecionada. Revise o rascunho antes de ativar. Para outros formatos,
                  duplique um modelo e edite os campos manualmente.
                </p>
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => closeCreate(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {createMode === 'existing' ? 'Duplicar' : 'Criar modelo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) closeEditor();
        }}
      >
        <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">
              {editing?.id ? 'Editar modelo' : 'Revisar rascunho do modelo'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Revise o nome, a descrição e as instruções do modelo antes de salvar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <label htmlFor="template-name" className="text-xs font-medium">
              Nome
            </label>
            <Input
              id="template-name"
              value={editDraft.name}
              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Nome"
            />
            <label htmlFor="template-description" className="text-xs font-medium">
              Descrição
            </label>
            <Input
              id="template-description"
              value={editDraft.description}
              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Descrição (1 frase)"
            />
            <label htmlFor="template-content" className="text-xs font-medium">
              Conteúdo do modelo
            </label>
            <Textarea
              id="template-content"
              value={editDraft.content}
              onChange={(e) => setEditDraft((d) => ({ ...d, content: e.target.value }))}
              className="min-h-[380px] text-xs font-mono leading-relaxed"
            />
          </div>
          {!editing?.id && (
            <label className="px-5 py-2 text-xs flex items-start gap-2">
              <input
                type="checkbox"
                checked={templateReviewed}
                onChange={(e) => setTemplateReviewed(e.target.checked)}
              />
              Revisei a estrutura e confirmei que não contém dados de pacientes, achados ou negativas predefinidas.
            </label>
          )}
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={closeEditor} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleSaveEdit}
              disabled={savingEdit || (!editing?.id && !templateReviewed)}
            >
              {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Salvar modelo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}
