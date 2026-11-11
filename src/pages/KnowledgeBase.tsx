import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Loader2, FileText, Search, RotateCw, Archive } from 'lucide-react';
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
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';
import { createKnowledgeSource, reviewKnowledgeSource } from '@/lib/knowledge';
import { ProtocolShareControls, SharedProtocolsPanel } from '@/components/ProtocolSharing';
import { extractKnowledgeFile } from '@/lib/knowledgeFile';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';
import { dialogLayout } from '@/lib/dialogLayout';
import { LoadErrorNotice, LoadingNotice } from '@/features/shared/StatusNotice';

interface KBDoc {
  id: string;
  title: string;
  source_type: string;
  char_count: number;
  status: string;
  created_at: string;
  source_reference: string | null;
  source_version: string | null;
  review_status: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  indexed_at: string | null;
}
interface SourceDetail extends KBDoc {
  source_text: string | null;
  supersedes_document_id: string | null;
  has_successor?: boolean;
}
const date = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function statusLabel(doc: KBDoc) {
  if (doc.review_status === 'retired') return 'Retirado';
  if (doc.review_status !== 'approved') return 'Aguardando revisão';
  return doc.status === 'ready'
    ? 'Revisado e disponível'
    : doc.status === 'processing'
      ? 'Preparando para o assistente'
      : doc.status === 'error'
        ? 'Não ficou pronta para o assistente'
        : 'Revisado · ainda não disponível';
}

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reference, setReference] = useState('');
  const [version, setVersion] = useState('');
  const [supersedes, setSupersedes] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState('');
  const [draftError, setDraftError] = useState('');
  const draftErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (draftError) draftErrorRef.current?.focus(); }, [draftError]);
  const [importing, setImporting] = useState(false);
  const importController = useRef<AbortController | null>(null);
  useEffect(()=>()=>{importController.current?.abort();},[]);
  const importFile = async(file:File) => {
    if(content.trim() && !window.confirm('Substituir o texto atual pelo conteúdo do arquivo?'))return;
    importController.current?.abort();
    const controller=new AbortController();importController.current=controller;
    setImporting(true);setDraftError('');
    try {
      const text=await extractKnowledgeFile(file,controller.signal);
      if(controller.signal.aborted)return;
      setContent(text);setTitle(previous=>previous||file.name.replace(/\.[^.]+$/,''));
    } catch(error) {
      if(!controller.signal.aborted)setDraftError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.');
    } finally {if(importController.current===controller)setImporting(false);}
  };
  const guardDraft = useUnsavedChanges(
    addOpen && !!(title.trim() || content.trim() || reference.trim() || version.trim()),
  );
  const {
    data: docs = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<KBDoc[]>({
    queryKey: ['knowledge-docs', user?.id],
    enabled: !!user?.id,
    staleTime: 20_000,
    queryFn: () =>
      fetchAllRows<KBDoc>((from, to) =>
        supabase
          .from('knowledge_documents')
          .select(
            'id,title,source_type,char_count,status,created_at,source_reference,source_version,review_status,reviewed_at,reviewer_name,indexed_at',
          )
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
    refetchInterval: (q) => (q.state.data?.some((doc) => doc.status === 'processing') ? 4000 : false),
  });
  const source = useQuery<SourceDetail>({
    queryKey: ['knowledge-source', user?.id, selectedId],
    enabled: !!selectedId && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('id', selectedId!)
        .eq('user_id', user!.id)
        .single();
      if (error || !data) throw new Error('Não foi possível carregar o texto original.');
      // A version with a successor is superseded: it cannot be approved or
      // indexed again (two versions of one protocol would reach the assistant).
      const { count } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .eq('supersedes_document_id', selectedId!);
      return { ...(data as unknown as SourceDetail), has_successor: (count ?? 0) > 0 };
    },
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['knowledge-docs', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['knowledge-source', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['usage-daily', user?.id] });
  };
  const filtered = docs.filter((doc) =>
    `${doc.title} ${doc.source_reference ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const closeAdd = (next: boolean) => {
    if (saving || !guardDraft(next)) return;
    if (!next) {
      importController.current?.abort();setImporting(false);
      setTitle('');
      setContent('');
      setReference('');
      setVersion('');
      setSupersedes(null);
      setDraftError('');
    }
    setAddOpen(next);
  };
  const newVersion = (doc: SourceDetail) => {
    setTitle(doc.title);
    setContent(doc.source_text ?? '');
    setReference(doc.source_reference ?? '');
    setVersion('');
    setSupersedes(doc.id);
    setSelectedId(null);
    setAddOpen(true);
  };
  const create = async () => {
    if (
      !title.trim() ||
      content.trim().length < 20 ||
      content.length > 60_000 ||
      !reference.trim() ||
      !version.trim()
    ) {
      setDraftError('Informe título, fonte, versão e texto original com 20 a 60.000 caracteres.');
      return;
    }
    if (saving) return;
    setSaving(true);
    setDraftError('');
    try {
      const id = await createKnowledgeSource({
        title,
        text: content,
        reference,
        version,
        supersedesDocumentId: supersedes,
      });
      setAddOpen(false);
      setTitle('');
      setContent('');
      setReference('');
      setVersion('');
      setSupersedes(null);
      setSelectedId(id);
      await refresh();
      toast({ title: 'Original preservado', description: 'Revise a versão antes de disponibilizá-la ao assistente.' });
    } catch (error) {
      setDraftError(await functionErrorMessage(error, 'Não foi possível salvar. Seu texto foi mantido.'));
    } finally {
      setSaving(false);
    }
  };
  const index = async (doc: SourceDetail, approve: boolean) => {
    if (busyId) return;
    setBusyId(doc.id);
    setOperationError('');
    try {
      if (approve) await reviewKnowledgeSource(doc.id, true);
      const { data, error } = await supabase.functions.invoke('ingest-knowledge', { body: { documentId: doc.id } });
      if (error) {
        const body = await functionErrorBody(error);
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Não foi possível preparar a fonte para o assistente. O texto original continua salvo.',
        );
      }
      if (data?.status !== 'ready')
        throw new Error('A fonte ainda não ficou pronta para o assistente. Abra a fonte de novo antes de tentar outra vez.');
      toast({
        title: 'Fonte revisada e disponível',
        description: 'O assistente pode consultar esta versão e citar a fonte.',
      });
    } catch (error) {
      setOperationError(await functionErrorMessage(error, 'Não foi possível preparar a fonte para o assistente. O texto original continua salvo.'));
    } finally {
      setBusyId(null);
      await refresh();
    }
  };
  const removeSource = async (doc: SourceDetail) => {
    if (
      busyId ||
      !window.confirm(
        `Excluir "${doc.title}" definitivamente? O texto desta versão será apagado e os compartilhamentos revogados.`,
      )
    )
      return;
    setBusyId(doc.id);
    setOperationError('');
    try {
      const rpc = supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: unknown }>;
      const { error } = await rpc('delete_knowledge_source', { p_document_id: doc.id });
      if (error) throw error;
      toast({ title: 'Fonte excluída' });
      setSelectedId(null);
    } catch (error) {
      setOperationError(await functionErrorMessage(error, 'Não foi possível excluir a fonte.'));
    } finally {
      setBusyId(null);
      await refresh();
    }
  };
  const retire = async (doc: SourceDetail) => {
    if (
      busyId ||
      !window.confirm(`Retirar "${doc.title}" das referências do assistente? O texto original e a revisão continuam guardados.`)
    )
      return;
    setBusyId(doc.id);
    setOperationError('');
    try {
      await reviewKnowledgeSource(doc.id, false);
      toast({ title: 'Fonte retirada', description: 'Novas consultas não usarão esta versão.' });
    } catch (error) {
      setOperationError(await functionErrorMessage(error, 'Não foi possível retirar a fonte.'));
    } finally {
      setBusyId(null);
      await refresh();
    }
  };
  return (
    <WorkspaceShell section="Conhecimento" contentClassName="space-y-6">
      <PageHeading title="Conhecimento" description="Seus protocolos e referências, revisados por você, para apoiar as respostas do assistente." actions={
          <Button
            className="min-h-11 gap-2"
            onClick={() => {
              setSupersedes(null);
              setAddOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Adicionar fonte
          </Button>
      } />
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground rounded-xl border bg-card p-4">
          O assistente só usa as versões que você revisou e aprovou. Guarde aqui protocolos gerais e referências, sem
          dados de pacientes.
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
          <Input
            aria-label="Buscar conhecimento"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(50);
            }}
            placeholder="Buscar título ou fonte"
            className="pl-9"
          />
        </div>
        {isLoading ? (
          <LoadingNotice label="Carregando fontes…" className="p-0" />
        ) : isError ? (
          <LoadErrorNotice subject="suas fontes" onRetry={() => void refetch()} />
        ) : !docs.length ? (
          <div className="border rounded-xl bg-card py-12 text-center space-y-3">
            <BookOpen className="w-8 h-8 text-primary mx-auto" />
            <h2 className="font-semibold">Sua biblioteca está vazia</h2>
            <p className="text-sm text-muted-foreground">
              Adicione o texto original de um protocolo para começar a revisão.
            </p>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              Adicionar fonte
            </Button>
          </div>
        ) : !filtered.length ? (
          <p>Nenhuma fonte corresponde à busca.</p>
        ) : (
          filtered.slice(0, visibleCount).map((doc) => (
            <article key={doc.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 rounded-xl border bg-card p-4 sm:flex sm:items-start">
              <FileText className="w-5 h-5 mt-1 text-primary shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="font-semibold break-words">{doc.title}</h2>
                <p className="text-xs text-muted-foreground break-words">
                  Versão {doc.source_version ?? 'não informada'} ·{' '}
                  {doc.source_reference ?? 'Fonte não informada'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {doc.reviewed_at
                    ? `Revisão: ${date(doc.reviewed_at)} · ${doc.reviewer_name ?? 'Médico'}`
                    : 'Revisão pendente'}
                </p>
                <p className="text-xs font-medium">{statusLabel(doc)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="col-start-2 min-h-11 justify-self-start sm:shrink-0"
                onClick={() => {
                  setOperationError('');
                  setSelectedId(doc.id);
                }}
              >
                Ver fonte
              </Button>
            </article>
          ))
        )}
        {filtered.length > visibleCount && (
          <Button variant="outline" onClick={() => setVisibleCount((n) => n + 50)}>
            Mostrar mais fontes
          </Button>
        )}
        <SharedProtocolsPanel />
      </div>
      <Dialog open={addOpen} onOpenChange={closeAdd}>
        <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
          <DialogHeader className={dialogLayout.header}>
            <DialogTitle>{supersedes ? 'Nova versão' : 'Adicionar fonte'}</DialogTitle>
            <DialogDescription>
              O texto original fica guardado. Mudar o conteúdo cria outra versão, que você revisa de novo.
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={(event) => { event.preventDefault(); if (!saving && !importing) void create(); }}>
          <div className={dialogLayout.body}>
            <div className="space-y-1">
              <Label htmlFor="knowledge-title">Título</Label>
              <Input id="knowledge-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="knowledge-reference">Fonte / referência bibliográfica</Label>
                <Input
                  id="knowledge-reference"
                  maxLength={2000}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Publicação, entidade ou endereço da fonte"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="knowledge-version">Versão / edição</Label>
                <Input
                  id="knowledge-version"
                  maxLength={80}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Ex.: edição 2026"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-file">Importar texto de PDF, TXT ou Markdown</Label>
              <Input id="knowledge-file" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" disabled={saving || importing} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importFile(file);}} />
              <p className="text-xs text-muted-foreground">O arquivo é lido no seu aparelho, sem usar IA. PDF com texto selecionável, até 10 MB e 60 páginas. Revise o texto extraído; salvar não aprova a fonte.</p>
              {importing && <p role="status" className="text-sm">Extraindo texto do arquivo…</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="knowledge-content">Texto original do protocolo</Label>
              <Textarea
                id="knowledge-content"
                disabled={importing}
                rows={12}
                maxLength={60000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {content.length.toLocaleString('pt-BR')} de 60.000 caracteres. Não inclua prontuários ou dados de
                pacientes.
              </p>
            </div>
          </div>
          <div className={dialogLayout.footer}>
            {draftError && (
              <p ref={draftErrorRef} role="alert" tabIndex={-1} className={dialogLayout.error}>
                {draftError}
              </p>
            )}
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" className={dialogLayout.button} disabled={saving} onClick={() => closeAdd(false)}>
                Cancelar
              </Button>
              <Button type="submit" className={dialogLayout.button} disabled={saving || importing}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Salvar original para revisão
              </Button>
            </div>
          </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedId}
        onOpenChange={(next) => {
          if (!next && !busyId) {
            setSelectedId(null);
            setOperationError('');
          }
        }}
      >
        <DialogContent className={`max-w-3xl ${dialogLayout.content}`}>
          <DialogHeader className={dialogLayout.header}>
            <DialogTitle>{source.data?.title ?? 'Fonte original'}</DialogTitle>
            <DialogDescription>
              Revise o texto completo e sua procedência. A aprovação identifica o médico e a data desta versão.
            </DialogDescription>
          </DialogHeader>
          {source.isLoading ? (
            <div className={dialogLayout.body}><LoadingNotice label="Carregando original…" className="p-0" /></div>
          ) : source.isError ? (
            <div className={dialogLayout.body}><LoadErrorNotice subject="o texto original" retrying={source.isFetching} onRetry={() => void source.refetch()} /></div>
          ) : (
            source.data && (
              <>
                <div className={dialogLayout.body}>
                  <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="font-medium">Fonte</dt>
                      <dd className="break-words">{source.data.source_reference ?? 'Não informada'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Versão</dt>
                      <dd>{source.data.source_version ?? 'Não informada'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Revisão</dt>
                      <dd>
                        {source.data.reviewed_at
                          ? `${source.data.reviewer_name} · ${date(source.data.reviewed_at)}`
                          : 'Pendente'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">Disponibilidade</dt>
                      <dd>{statusLabel(source.data)}</dd>
                    </div>
                  </dl>
                  {source.data.source_text ? (
                    <pre className="whitespace-pre-wrap break-words text-sm font-sans border rounded-lg p-4 bg-muted/30">
                      {source.data.source_text}
                    </pre>
                  ) : (
                    <p className="rounded-lg border p-4 text-sm">
                      O texto original desta fonte antiga não foi preservado. Ela fica fora das respostas do assistente.
                      Adicione uma nova versão com o texto original para revisar e aprovar.
                    </p>
                  )}
                  <ProtocolShareControls source={source.data} />
                </div>
                <div className={dialogLayout.footer}>
                {operationError && (
                  <p role="alert" className={dialogLayout.error}>
                    {operationError}
                  </p>
                )}
                <div className={dialogLayout.actions}>
                  {!source.data.has_successor && (
                    <Button
                      variant="ghost"
                      className={`${dialogLayout.button} mr-auto text-destructive`}
                      disabled={!!busyId}
                      onClick={() => removeSource(source.data!)}
                    >
                      Excluir fonte
                    </Button>
                  )}
                  <Button variant="outline" className={dialogLayout.button} disabled={!!busyId} onClick={() => newVersion(source.data!)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Nova versão
                  </Button>
                  {source.data.has_successor ? (
                    <p className="basis-full text-sm text-muted-foreground">
                      Esta versão foi substituída por uma mais recente e não é mais usada pelo assistente.
                    </p>
                  ) : (
                    source.data.source_text &&
                    (source.data.review_status !== 'approved' ? (
                      <Button className={dialogLayout.button} disabled={!!busyId} onClick={() => index(source.data!, true)}>
                        {busyId && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Revisei o original · aprovar
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" disabled={!!busyId} onClick={() => index(source.data!, false)}>
                          <RotateCw className="w-4 h-4 mr-2" />
                          {source.data.status === 'ready' ? 'Preparar de novo para o assistente' : 'Tentar de novo'}
                        </Button>
                        <Button variant="outline" disabled={!!busyId} onClick={() => retire(source.data!)}>
                          <Archive className="w-4 h-4 mr-2" />
                          Retirar das referências
                        </Button>
                      </>
                    ))
                  )}
                </div>
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}
