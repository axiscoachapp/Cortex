import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BookOpen, Plus, Trash2, Loader2, FileText, Search,
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

interface KBDoc {
  id: string;
  title: string;
  source_type: string;
  char_count: number;
  status: 'processing' | 'ready' | 'error';
  created_at: string;
}

const STATUS_META: Record<KBDoc['status'], { label: string; cls: string }> = {
  processing: { label: 'Processando', cls: 'bg-amber-100 text-amber-700' },
  ready:      { label: 'Pronto',       cls: 'bg-green-100 text-green-700' },
  error:      { label: 'Erro',         cls: 'bg-red-100 text-red-700' },
};

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery<KBDoc[]>({
    queryKey: ['knowledge-docs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('id, title, source_type, char_count, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as KBDoc[]) ?? [];
    },
    enabled: !!user?.id,
    staleTime: 20_000,
    // Poll while anything is still indexing so the badge flips to "Pronto".
    refetchInterval: (q) => (q.state.data as KBDoc[] | undefined)?.some(d => d.status === 'processing') ? 4000 : false,
  });

  const filtered = docs.filter(d => d.title.toLowerCase().includes(search.trim().toLowerCase()));

  const handleAdd = async () => {
    if (!title.trim() || content.trim().length < 20) {
      toast({ title: 'Preencha o título e o conteúdo', description: 'Mínimo de 20 caracteres.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('ingest-knowledge', {
        body: { title, text: content },
      });
      if (error) {
        const body = (error as any)?.context?.json ? await (error as any).context.json().catch(() => null) : null;
        throw new Error(body?.error ?? 'Falha ao indexar');
      }
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', user?.id] });
      toast({ title: 'Conhecimento adicionado', description: 'O assistente já pode usá-lo nas conversas.' });
      setAddOpen(false); setTitle(''); setContent('');
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d: KBDoc) => {
    if (!window.confirm(`Excluir "${d.title}" da base de conhecimento?`)) return;
    setBusyId(d.id);
    const { error } = await supabase.from('knowledge_documents').delete().eq('id', d.id);
    setBusyId(null);
    if (error) toast({ title: 'Erro ao excluir', variant: 'destructive' });
    else { toast({ title: 'Excluído' }); queryClient.invalidateQueries({ queryKey: ['knowledge-docs', user?.id] }); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-3 md:px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <BookOpen className="h-5 w-5 text-medical-blue shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-semibold text-foreground leading-tight">Base de Conhecimento</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Documentos e protocolos que o assistente usa nas conversas
              </p>
            </div>
          </div>
          <Button variant="medical" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Adicionar conhecimento</span>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-3 md:px-4 py-6 max-w-3xl space-y-4">
        {docs.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquise pelo nome" className="pl-9" />
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[0, 1].map(i => <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />)}</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-medical-blue-light flex items-center justify-center mx-auto">
              <BookOpen className="w-6 h-6 text-medical-blue" />
            </div>
            <p className="text-sm font-semibold text-foreground">Sua base de conhecimento está vazia</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Adicione protocolos, artigos ou diretrizes para que o assistente use essas informações
              durante as conversas, com respostas mais precisas para você.
            </p>
            <Button variant="medical" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> Adicionar conhecimento
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            Nenhum documento corresponde à busca.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(d => {
              const meta = STATUS_META[d.status];
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 bg-white">
                  <div className="w-9 h-9 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-medical-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleDateString('pt-BR')} · {(d.char_count / 1000).toFixed(1)}k caracteres
                    </p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${meta.cls}`}>{meta.label}</span>
                  <Button size="icon" variant="ghost" aria-label="Excluir documento" className="h-8 w-8 hover:text-destructive shrink-0"
                    onClick={() => handleDelete(d)} disabled={busyId === d.id}>
                    {busyId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={addOpen} onOpenChange={(v) => { if (!saving) setAddOpen(v); }}>
        <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base font-semibold">Adicionar conhecimento</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">Título</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Protocolo de manejo de HAS" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">Conteúdo</label>
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Cole aqui o protocolo, artigo ou diretriz. O texto é dividido e indexado para o assistente consultar."
                className="min-h-[240px] text-sm"
              />
              <p className="text-[10px] text-muted-foreground">{content.length.toLocaleString('pt-BR')} caracteres</p>
            </div>
          </div>
          <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>Cancelar</Button>
            <Button size="sm" className="gap-1.5" onClick={handleAdd} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
