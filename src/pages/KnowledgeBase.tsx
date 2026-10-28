import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Plus, Loader2, FileText, Search, RotateCw, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { fetchAllRows } from '@/lib/pagination';
import { functionErrorBody } from '@/lib/functionErrors';
import { createKnowledgeSource, reviewKnowledgeSource } from '@/lib/knowledge';
import { ProtocolShareControls, SharedProtocolsPanel } from '@/components/ProtocolSharing';

interface KBDoc {
  id: string; title: string; source_type: string; char_count: number; status: string; created_at: string;
  source_reference: string | null; source_version: string | null; review_status: string;
  reviewed_at: string | null; reviewer_name: string | null; indexed_at: string | null;
}
interface SourceDetail extends KBDoc { source_text: string | null; supersedes_document_id: string | null }
const date = (value: string) => new Date(value).toLocaleString('pt-BR');
function statusLabel(doc: KBDoc) {
  if (doc.review_status === 'retired') return 'Retirado';
  if (doc.review_status !== 'approved') return 'Aguardando revisão';
  return doc.status === 'ready' ? 'Revisado e disponível' : doc.status === 'processing' ? 'Indexando' : doc.status === 'error' ? 'Falha na indexação' : 'Revisado · não indexado';
}

export default function KnowledgeBasePage() {
  const navigate = useNavigate(); const { user } = useAuth(); const { toast } = useToast(); const queryClient = useQueryClient();
  const [search, setSearch] = useState(''); const [visibleCount, setVisibleCount] = useState(50);
  const [addOpen, setAddOpen] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const [reference, setReference] = useState(''); const [version, setVersion] = useState(''); const [supersedes, setSupersedes] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [busyId, setBusyId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState(''); const [draftError, setDraftError] = useState('');
  const guardDraft = useUnsavedChanges(addOpen && !!(title.trim() || content.trim() || reference.trim() || version.trim()));
  const { data: docs = [], isLoading, isError, refetch } = useQuery<KBDoc[]>({
    queryKey: ['knowledge-docs', user?.id], enabled: !!user?.id, staleTime: 20_000,
    queryFn: () => fetchAllRows<KBDoc>((from, to) => supabase.from('knowledge_documents')
      .select('id,title,source_type,char_count,status,created_at,source_reference,source_version,review_status,reviewed_at,reviewer_name,indexed_at')
      .order('created_at', { ascending: false }).order('id').range(from, to)),
    refetchInterval: q => q.state.data?.some(doc => doc.status === 'processing') ? 4000 : false,
  });
  const source = useQuery<SourceDetail>({
    queryKey: ['knowledge-source', user?.id, selectedId], enabled: !!selectedId && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('knowledge_documents').select('*').eq('id', selectedId!).eq('user_id', user!.id).single();
      if (error || !data) throw new Error('Não foi possível carregar o texto original.');
      return data as unknown as SourceDetail;
    },
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['knowledge-docs', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['knowledge-source', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['usage-daily', user?.id] });
  };
  const filtered = docs.filter(doc => `${doc.title} ${doc.source_reference ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const closeAdd = (next: boolean) => {
    if (saving || !guardDraft(next)) return;
    if (!next) { setTitle(''); setContent(''); setReference(''); setVersion(''); setSupersedes(null); setDraftError(''); }
    setAddOpen(next);
  };
  const newVersion = (doc: SourceDetail) => {
    setTitle(doc.title); setContent(doc.source_text ?? ''); setReference(doc.source_reference ?? ''); setVersion(''); setSupersedes(doc.id); setSelectedId(null); setAddOpen(true);
  };
  const create = async () => {
    if (!title.trim() || content.trim().length < 20 || content.length > 60_000 || !reference.trim() || !version.trim()) {
      setDraftError('Informe título, fonte, versão e texto original com 20 a 60.000 caracteres.'); return;
    }
    if (saving) return;
    setSaving(true); setDraftError('');
    try {
      const id = await createKnowledgeSource({ title, text: content, reference, version, supersedesDocumentId: supersedes });
      setAddOpen(false); setTitle(''); setContent(''); setReference(''); setVersion(''); setSupersedes(null); setSelectedId(id);
      await refresh(); toast({ title: 'Original preservado', description: 'Revise a versão antes de disponibilizá-la ao assistente.' });
    } catch (error) { setDraftError(error instanceof Error ? error.message : 'Não foi possível salvar. Seu texto foi mantido.'); }
    finally { setSaving(false); }
  };
  const index = async (doc: SourceDetail, approve: boolean) => {
    if (busyId) return;
    setBusyId(doc.id); setOperationError('');
    try {
      if (approve) await reviewKnowledgeSource(doc.id, true);
      const { data, error } = await supabase.functions.invoke('ingest-knowledge', { body: { documentId: doc.id } });
      if (error) { const body = await functionErrorBody(error); throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível indexar. O original permanece salvo.'); }
      if (data?.status !== 'ready') throw new Error('A indexação ainda não foi confirmada. Reabra a fonte antes de tentar novamente.');
      toast({ title: 'Fonte revisada e disponível', description: 'O assistente pode consultar esta versão e citar a fonte.' });
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'A indexação falhou. O original foi preservado.'); }
    finally { setBusyId(null); await refresh(); }
  };
  const retire = async (doc: SourceDetail) => {
    if (busyId || !window.confirm(`Retirar "${doc.title}" das referências do assistente? O original e a revisão serão preservados.`)) return;
    setBusyId(doc.id); setOperationError('');
    try { await reviewKnowledgeSource(doc.id, false); toast({ title: 'Fonte retirada', description: 'Novas consultas não usarão esta versão.' }); }
    catch (error) { setOperationError(error instanceof Error ? error.message : 'Não foi possível retirar a fonte.'); }
    finally { setBusyId(null); await refresh(); }
  };
  return <div className="min-h-screen bg-background">
    <header className="bg-card border-b sticky top-0 z-10"><div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0"><Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}><ArrowLeft className="w-5 h-5" /></Button><BookOpen className="w-5 h-5 text-primary shrink-0" /><div><h1 className="text-lg font-semibold">Biblioteca de protocolos</h1><p className="text-xs text-muted-foreground hidden sm:block">Fontes originais, versões e revisão médica</p></div></div>
      <Button size="sm" onClick={() => { setSupersedes(null); setAddOpen(true); }} aria-label="Adicionar conhecimento"><Plus className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Adicionar fonte</span></Button>
    </div></header>
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <p className="text-sm text-muted-foreground rounded-xl border bg-card p-4">Somente versões revisadas e com indexação concluída entram nas respostas do assistente. Use protocolos gerais e referências; anexos e informações identificáveis de pacientes não devem ser reutilizados nesta biblioteca.</p>
      <div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" /><Input aria-label="Buscar conhecimento" value={search} onChange={e => { setSearch(e.target.value); setVisibleCount(50); }} placeholder="Buscar título ou fonte" className="pl-9" /></div>
      {isLoading ? <p role="status">Carregando fontes…</p> : isError ? <div role="alert" className="space-y-3"><p>Não foi possível carregar a biblioteca.</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div> : !docs.length ? <div className="border rounded-xl bg-card py-12 text-center space-y-3"><BookOpen className="w-8 h-8 text-primary mx-auto" /><h2 className="font-semibold">Sua biblioteca está vazia</h2><p className="text-sm text-muted-foreground">Adicione o texto original de um protocolo para começar a revisão.</p><Button variant="outline" onClick={() => setAddOpen(true)}>Adicionar fonte</Button></div> : !filtered.length ? <p>Nenhuma fonte corresponde à busca.</p> : filtered.slice(0, visibleCount).map(doc => <article key={doc.id} className="border rounded-xl bg-card p-4 flex gap-3 items-start"><FileText className="w-5 h-5 mt-1 text-primary shrink-0" /><div className="min-w-0 flex-1 space-y-1"><h2 className="font-semibold break-words">{doc.title}</h2><p className="text-xs text-muted-foreground break-words">Versão {doc.source_version ?? 'não informada'} · {doc.source_reference ?? 'Fonte original não preservada'}</p><p className="text-xs text-muted-foreground">{doc.reviewed_at ? `Revisão: ${date(doc.reviewed_at)} · ${doc.reviewer_name ?? 'Médico'}` : 'Revisão pendente'} · {doc.char_count.toLocaleString('pt-BR')} caracteres</p><p className="text-xs font-medium">{statusLabel(doc)}</p></div><Button size="sm" variant="outline" onClick={() => { setOperationError(''); setSelectedId(doc.id); }}>Ver fonte</Button></article>)}
      {filtered.length > visibleCount && <Button variant="outline" onClick={() => setVisibleCount(n => n + 50)}>Mostrar mais fontes</Button>}
      <SharedProtocolsPanel />
    </main>
    <Dialog open={addOpen} onOpenChange={closeAdd}><DialogContent className="max-w-2xl max-h-[92dvh] flex flex-col"><DialogHeader><DialogTitle>{supersedes ? 'Adicionar nova versão' : 'Adicionar fonte'}</DialogTitle><DialogDescription>O original é preservado. Alterações de conteúdo criam outra versão, com nova revisão.</DialogDescription></DialogHeader>
      <div className="overflow-y-auto space-y-4 px-1"><div className="space-y-1"><Label htmlFor="knowledge-title">Título</Label><Input id="knowledge-title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></div><div className="grid sm:grid-cols-2 gap-4"><div className="space-y-1"><Label htmlFor="knowledge-reference">Fonte / referência bibliográfica</Label><Input id="knowledge-reference" maxLength={2000} value={reference} onChange={e => setReference(e.target.value)} placeholder="Publicação, entidade ou endereço da fonte" /></div><div className="space-y-1"><Label htmlFor="knowledge-version">Versão / edição</Label><Input id="knowledge-version" maxLength={80} value={version} onChange={e => setVersion(e.target.value)} placeholder="Ex.: edição 2026" /></div></div><div className="space-y-1"><Label htmlFor="knowledge-content">Texto original do protocolo</Label><Textarea id="knowledge-content" rows={12} maxLength={60000} value={content} onChange={e => setContent(e.target.value)} /><p className="text-xs text-muted-foreground">{content.length.toLocaleString('pt-BR')} / 60.000 caracteres. Não inclua prontuários ou dados de pacientes.</p></div>{draftError && <p role="alert" className="text-sm text-destructive">{draftError}</p>}</div>
      <div className="border-t pt-4 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => closeAdd(false)}>Cancelar</Button><Button disabled={saving} onClick={create}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Salvar original para revisão</Button></div>
    </DialogContent></Dialog>
    <Dialog open={!!selectedId} onOpenChange={next => { if (!next && !busyId) { setSelectedId(null); setOperationError(''); } }}><DialogContent className="max-w-3xl max-h-[92dvh] flex flex-col"><DialogHeader><DialogTitle>{source.data?.title ?? 'Fonte original'}</DialogTitle><DialogDescription>Revise o texto completo e sua procedência. A aprovação identifica o médico e a data desta versão.</DialogDescription></DialogHeader>
      {source.isLoading ? <p role="status">Carregando original…</p> : source.isError ? <div role="alert"><p>Não foi possível carregar o original.</p><Button variant="outline" onClick={() => source.refetch()}>Tentar novamente</Button></div> : source.data && <><div className="overflow-y-auto space-y-4 px-1"><dl className="grid sm:grid-cols-2 gap-3 text-sm"><div><dt className="font-medium">Fonte</dt><dd className="break-words">{source.data.source_reference ?? 'Não preservada'}</dd></div><div><dt className="font-medium">Versão</dt><dd>{source.data.source_version ?? 'Não informada'}</dd></div><div><dt className="font-medium">Revisão</dt><dd>{source.data.reviewed_at ? `${source.data.reviewer_name} · ${date(source.data.reviewed_at)}` : 'Pendente'}</dd></div><div><dt className="font-medium">Disponibilidade</dt><dd>{statusLabel(source.data)}</dd></div></dl>
      {source.data.source_text ? <pre className="whitespace-pre-wrap break-words text-sm font-sans border rounded-lg p-4 bg-muted/30">{source.data.source_text}</pre> : <p className="rounded-lg border p-4 text-sm">O texto original desta fonte antiga não foi preservado. Ela permanece fora das respostas. Adicione uma nova versão com o original para revisar e indexar.</p>}{operationError && <p role="alert" className="text-sm text-destructive">{operationError}</p>}<ProtocolShareControls source={source.data}/></div>
      <div className="flex flex-wrap gap-2 border-t pt-4"><Button variant="outline" disabled={!!busyId} onClick={() => newVersion(source.data!)}><Plus className="w-4 h-4 mr-2" />Nova versão</Button>{source.data.source_text && (source.data.review_status !== 'approved' ? <Button disabled={!!busyId} onClick={() => index(source.data!, true)}>{busyId && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Revisei o original · aprovar e indexar</Button> : <><Button variant="outline" disabled={!!busyId} onClick={() => index(source.data!, false)}><RotateCw className="w-4 h-4 mr-2" />{source.data.status === 'ready' ? 'Reindexar mesma versão' : 'Tentar indexação'}</Button><Button variant="outline" disabled={!!busyId} onClick={() => retire(source.data!)}><Archive className="w-4 h-4 mr-2" />Retirar das referências</Button></> )}</div></>}
    </DialogContent></Dialog>
  </div>;
}
