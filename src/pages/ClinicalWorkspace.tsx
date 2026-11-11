import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandLockup } from '@/components/BrandLockup';
import { formatDateOnly } from '@/lib/dates';
import { WORK_KINDS, WorkKind, WorkEntry } from '@/lib/clinicalWorkspace';
import { ClinicalWorkEditor } from '@/components/ClinicalWorkEditor';
import { ClinicalMarkdown } from '@/components/ClinicalMarkdown';
import type { Tables, Json } from '@/integrations/supabase/types';

type Item = Tables<'clinical_work_items'>;
const statusLabels: Record<string, string> = {
  open: 'Pendente',
  draft: 'Rascunho',
  done: 'Concluído',
  approved: 'Aprovado',
  cancelled: 'Encerrado',
};
function detailsOf(item?: Item): Record<string, string> {
  return item?.details && typeof item.details === 'object' && !Array.isArray(item.details)
    ? Object.fromEntries(
        Object.entries(item.details).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : {};
}

function workSnapshotText(snapshot: Json): string {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '';
  const detail =
    snapshot.details && typeof snapshot.details === 'object' && !Array.isArray(snapshot.details)
      ? snapshot.details
      : {};
  const state =
    typeof detail.state === 'string'
      ? ({ active: 'Ativo', changed: 'Alterado', stopped: 'Suspenso' } as Record<string, string>)[detail.state]
      : '';
  return [
    snapshot.title,
    snapshot.content,
    typeof detail.date === 'string' ? 'Data: ' + formatDateOnly(detail.date) : '',
    detail.value ? 'Valor: ' + detail.value + ' ' + (detail.unit ?? '') : '',
    state ? 'Estado: ' + state : '',
    detail.source ? 'Fonte: ' + detail.source : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

type WorkspaceProps = {
  patientId: string | null;
  schedulingQueue?: boolean;
  embedded?: boolean;
  manual?: boolean;
  entry?: WorkEntry;
  appointmentParam?: string;
  complaintParam?: string;
  onExitGuardChange?: (guard: () => boolean) => void;
};

/** Same records and editor, scoped to the patient already open in the chart. */
export function PatientWorkspace(props: Omit<WorkspaceProps, 'embedded' | 'schedulingQueue'>) {
  const { user } = useAuth();
  return <ClinicalWorkspace key={`${user?.id}/${props.patientId}`} {...props} embedded />;
}

function ClinicalWorkspace({ patientId, schedulingQueue = false, embedded = false, manual = false,
  appointmentParam, complaintParam, entry, onExitGuardChange }: WorkspaceProps) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Item | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEntry, setEditorEntry] = useState<WorkEntry>();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const [tab, setTab] = useState('work');
  const [compare, setCompare] = useState<string | null>(null);
  const [workCompare, setWorkCompare] = useState<string | null>(null);
  const exitEditor = useRef<() => boolean>(() => true);
  const [editorVersion, setEditorVersion] = useState(0);
  // Changing ?patient= keeps this page mounted. Reset per-patient UI state
  // during render so patient A's open record can never appear (or be saved)
  // under patient B's header.
  const [statePatientId, setStatePatientId] = useState(patientId);
  if (statePatientId !== patientId) {
    setStatePatientId(patientId);
    setEditing(undefined);
    setEditorOpen(false);
    setEditorEntry(undefined);
    setCompare(null);
    setWorkCompare(null);
    setTab('work');
    exitEditor.current = () => true;
  }
  const openEditor = (item?: Item) => {
    if (editorOpen && !exitEditor.current()) return;
    setEditing(item);
    setEditorEntry(undefined);
    setEditorVersion((value) => value + 1);
    setEditorOpen(true);
  };
  const patients = useQuery({
    queryKey: ['workspace-directory', user?.id, search],
    enabled: !!user && !embedded,
    queryFn: async () => {
      let q = supabase.from('patients').select('id,name').eq('user_id', user!.id).is('archived_at', null).order('name').order('id').limit(50);
      if (search.trim()) q = q.ilike('name', `%${search.trim().replace(/[%_,()]/g, '')}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
  const patient = useQuery({
    queryKey: ['workspace-patient', user?.id, patientId],
    enabled: !!user && !!patientId,
    gcTime: embedded ? 0 : 5 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: !embedded,
    refetchOnReconnect: !embedded,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('patients')
        .select('id,name')
        .eq('id', patientId!)
        .eq('user_id', user!.id)
        .abortSignal(signal)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const patientReady = !!user && !!patient.data && !patient.isError && !patient.isFetching;
  const work = useQuery({
    queryKey: ['clinical-work', user?.id, patientId, limit, schedulingQueue],
    enabled: !!user && (!embedded || patientReady),
    queryFn: async ({ signal }) => {
      let q = supabase
        .from('clinical_work_items')
        .select('*')
        .eq('user_id', user!.id)
        .abortSignal(signal)
        .order('updated_at', { ascending: false })
        .order('id')
        .limit(limit);
      if (patientId) q = q.eq('patient_id', patientId);
      else q = q.in('status', ['open', 'draft']);
      if (schedulingQueue) q = q.eq('kind', 'task').in('details->>workflow', ['waitlist', 'confirmation']);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
  const audio = useQuery({
    queryKey: ['pending-audio', user?.id],
    enabled: !!user && !embedded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultation_drafts')
        .select('id,patient_id,status,updated_at')
        .eq('user_id', user!.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ['workspace-history', user?.id, patientId, limit],
    enabled: patientReady && tab === 'history',
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('consultations')
        .select('id,created_at,chief_complaint,soap_note,revision')
        .eq('patient_id', patientId!)
        .eq('user_id', user!.id)
        .abortSignal(signal)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(limit);
      if (error) throw error;
      return data;
    },
  });
  const revisions = useQuery({
    queryKey: ['workspace-revisions', user?.id, patientId, compare],
    enabled: patientReady && !!compare,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('clinical_record_revisions')
        .select('*')
        .eq('patient_id', patientId!)
        .eq('user_id', user!.id)
        .abortSignal(signal)
        .eq('record_id', compare!)
        .order('revision', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
  const priorWork = useQuery({
    queryKey: ['workspace-work-revisions', user?.id, workCompare],
    enabled: !!user && !!workCompare && (!embedded || patientReady),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('clinical_work_revisions')
        .select('id,revision,snapshot,created_at')
        .eq('user_id', user!.id)
        .abortSignal(signal)
        .eq('item_id', workCompare!)
        .order('revision', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
  const ids = [
    ...new Set([
      ...(work.data ?? []).map((item) => item.patient_id),
      ...(audio.data ?? []).map((item) => item.patient_id),
    ]),
  ].sort();
  const names = useQuery({
    queryKey: ['workspace-patient-names', user?.id, ids.join('|')],
    enabled: !!user && !embedded && ids.length > 0,
    queryFn: async () => {
      const results: Record<string, string> = {};
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error } = await supabase
          .from('patients')
          .select('id,name')
          .eq('user_id', user!.id)
          .in('id', ids.slice(index, index + 100));
        if (error) throw error;
        for (const item of data ?? []) results[item.id] = item.name;
      }
      return results;
    },
  });
  // Arriving from "Consulta manual" (?new=1) opens the editor directly.
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if ((!manual && !entry) || !patientReady || !patientId || autoOpened.current === patientId) return;
    autoOpened.current = patientId;
    setEditing(undefined);
    setEditorEntry(entry);
    setEditorVersion((value) => value + 1);
    setEditorOpen(true);
  }, [manual, entry, patientReady, patientId]);
  useEffect(() => {
    onExitGuardChange?.(() => !editorOpen || exitEditor.current());
  }, [onExitGuardChange, editorOpen]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['clinical-work'] });
    void client.invalidateQueries({ queryKey: ['workspace-history'] });
    void client.invalidateQueries({ queryKey: ['patients'] });
  };
  // A confirmed manual consultation completes its appointment and adds a consultation.
  const refreshAfterFinalize = () => {
    void client.invalidateQueries({ queryKey: ['appointments-today'] });
    void client.invalidateQueries({ queryKey: ['appointments'] });
    void client.invalidateQueries({ queryKey: ['patient-consultations', patientId] });
    void client.invalidateQueries({ queryKey: ['patient-detail', patientId] });
  };
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const transition = async (item: Item, status: string) => {
    if (transitioningId) return;
    setTransitioningId(item.id);
    try {
      const { data, error } = await supabase
        .from('clinical_work_items')
        .update({ status })
        .eq('id', item.id)
        .eq('revision', item.revision)
        .select('id')
        .maybeSingle();
      if (error || !data) window.alert('Não foi possível atualizar. Recarregue para conferir a versão.');
      refresh();
    } finally {
      setTransitioningId(null);
    }
  };
  if (embedded && !patientReady) return patient.isError || !user ? (
    <p role="alert">Paciente indisponível ou sem acesso. <button className="underline" onClick={() => patient.refetch()}>Tentar novamente</button></p>
  ) : <p role="status">Carregando paciente…</p>;
  const Content = embedded ? 'section' : 'main';
  return (
    <div className={embedded ? 'min-w-0 break-words' : 'min-h-screen bg-background'}>
      {!embedded && <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto p-4 flex items-center gap-4">
          <Link to="/" aria-label="Voltar ao início" className="p-2">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <BrandLockup compact />
          <span className="ml-auto text-xs text-muted-foreground hidden sm:block">Autoria e revisão do médico</span>
        </div>
      </header>}
      <Content aria-label={embedded ? 'Acompanhamento do paciente' : undefined} className={embedded ? 'min-w-0 space-y-5' : 'max-w-6xl mx-auto p-4 sm:p-7 space-y-6'}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {embedded && <h3 className="font-semibold break-words">{patient.data?.name}</h3>}
          {!embedded && <div>
            <p className="text-xs text-primary uppercase tracking-widest">Continuidade do cuidado</p>
            <h1 className="font-serif text-3xl mt-2">{patient.data?.name ?? (schedulingQueue ? 'Lista de espera e confirmações' : 'Trabalho pendente')}</h1>
          </div>}
          {patient.data && (
            <Button onClick={() => openEditor()}>
              <Plus className="w-4 h-4 mr-2" />
              Novo registro
            </Button>
          )}
        </div>
        {!patientId && (
          <section className="grid md:grid-cols-[1fr_2fr] gap-5">
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Abrir paciente privado</h2>
              <Input
                aria-label="Buscar paciente para documentação"
                placeholder="Buscar pelo nome"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {patients.isError ? (
                <p role="alert">
                  Diretório indisponível.{' '}
                  <button className="underline" onClick={() => patients.refetch()}>
                    Tentar novamente
                  </button>
                </p>
              ) : patients.isLoading ? (
                <p role="status">Carregando…</p>
              ) : (
                <ul className="divide-y">
                  {patients.data?.map((p) => (
                    <li key={p.id}>
                      <Link className="block py-3 text-sm hover:text-primary" to={'/trabalho?patient=' + p.id}>
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                {patients.data?.length ?? 0} pacientes encontrados{patients.data?.length === 50 ? ' (limite de 50; refine a busca)' : ''}.
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Áudios e revisões recuperáveis</h2>
              {audio.isError ? (
                <p role="alert">
                  Não foi possível carregar rascunhos.{' '}
                  <button className="underline" onClick={() => audio.refetch()}>
                    Tentar novamente
                  </button>
                </p>
              ) : audio.isLoading ? (
                <p role="status">Carregando…</p>
              ) : audio.data?.length ? (
                <ul className="divide-y">
                  {audio.data.map((d) => (
                    <li key={d.id}>
                      <Link className="block py-3 text-sm" to={'/?patient=' + d.patient_id}>
                        Retomar consulta · {names.data?.[d.patient_id] ?? 'Paciente'} ·{' '}
                        {d.status === 'review'
                          ? 'Aguardando revisão'
                          : d.status === 'error'
                            ? 'Nova tentativa necessária'
                            : 'Processamento pendente'}{' '}
                        · {new Date(d.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma consulta em recuperação.</p>
              )}
            </div>
          </section>
        )}
        {patientId &&
          (patient.isError ? (
            <p role="alert">
              Paciente indisponível ou sem acesso.{' '}
              <Link className="underline" to="/trabalho">
                Voltar à lista
              </Link>
            </p>
          ) : patient.isLoading ? (
            <p role="status">Carregando paciente…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={tab === 'work' ? 'default' : 'outline'}
                  aria-pressed={tab === 'work'}
                  className="max-w-full h-auto min-h-10 whitespace-normal"
                  onClick={() => setTab('work')}
                >
                  Registros e acompanhamento
                </Button>
                <Button
                  variant={tab === 'history' ? 'default' : 'outline'}
                  aria-pressed={tab === 'history'}
                  onClick={() => setTab('history')}
                >
                  Linha do tempo
                </Button>
                {!embedded && <Link className="text-sm underline self-center" to={'/?patient=' + patientId}>
                  Consulta e documentos
                </Link>}
              </div>
              {editorOpen && user && (!editing || editing.patient_id === patientId) && (
                <ClinicalWorkEditor
                  key={patientId + '/' + (editing?.id ?? 'new') + '/' + editorVersion}
                  item={editing}
                  entry={editing ? undefined : editorEntry}
                  appointmentId={editing ? undefined : appointmentParam}
                  initialTitle={editing ? undefined : complaintParam}
                  patientId={patientId}
                  userId={user.id}
                  onSaved={refresh}
                  onFinalized={refreshAfterFinalize}
                  onExitGuardChange={(guard) => {
                    exitEditor.current = guard;
                  }}
                  onClose={() => setEditorOpen(false)}
                />
              )}
            </>
          ))}
        {names.isError && (
          <p role="alert" className="text-sm">
            Não foi possível atualizar os nomes. Os identificadores dos pacientes foram mantidos; confirme o prontuário
            antes de editar.
          </p>
        )}
        {(!patientId || tab === 'work') && (
          <section className="space-y-3" aria-label="Registros clínicos e pendências">
            {work.isError ? (
              <p role="alert">
                Não foi possível carregar os registros.{' '}
                <button className="underline" onClick={() => work.refetch()}>
                  Tentar novamente
                </button>
              </p>
            ) : work.isLoading ? (
              <p role="status">Carregando registros…</p>
            ) : work.data?.length ? (
              work.data.map((item) => (
                <article key={item.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap justify-between items-start gap-3">
                    <div>
                      <p className="text-xs text-primary">
                        {WORK_KINDS[item.kind as WorkKind]} · {statusLabels[item.status]}
                      </p>
                      <h2 className="font-semibold mt-1">{item.title}</h2>
                      {!patientId && (
                        <p className="text-sm mt-1">{names.data?.[item.patient_id] ?? 'Paciente'}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Atualizado em {new Date(item.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        {item.due_date ? ' · prazo ' + formatDateOnly(item.due_date) : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {patientId ? (
                        <Button size="sm" variant="outline" onClick={() => openEditor(item)}>
                          Abrir registro
                        </Button>
                      ) : (
                        <Link className="text-sm underline" to={'/trabalho?patient=' + item.patient_id}>
                          Abrir paciente
                        </Link>
                      )}
                      {item.revision > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setWorkCompare(workCompare === item.id ? null : item.id)}
                        >
                          Ver versões
                        </Button>
                      )}
                      {item.kind === 'task' && item.status === 'open' && (
                        <Button size="sm" variant="outline" disabled={transitioningId === item.id} onClick={() => transition(item, 'done')}>
                          Marcar concluído
                        </Button>
                      )}
                    </div>
                  </div>
                  <ClinicalMarkdown className="mt-3 line-clamp-4" text={item.content} />
                  {workCompare === item.id && (
                    <div className="border-t pt-3 mt-3 space-y-2">
                      {priorWork.isError ? (
                        <p role="alert">Não foi possível carregar versões anteriores.</p>
                      ) : priorWork.isLoading ? (
                        <p role="status">Carregando versões…</p>
                      ) : (
                        priorWork.data?.map((version) => (
                          <details key={version.id}>
                            <summary className="cursor-pointer text-sm">
                              Versão {version.revision} · {new Date(version.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </summary>
                            <pre className="whitespace-pre-wrap text-xs bg-muted p-3 mt-2 rounded">
                              {workSnapshotText(version.snapshot)}
                            </pre>
                          </details>
                        ))
                      )}
                    </div>
                  )}
                  {item.kind === 'task' && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {
                        (
                          {
                            result: 'Exame',
                            referral: 'Encaminhamento',
                            followup: 'Retorno',
                            waitlist: 'Lista de espera',
                            confirmation: 'Confirmação',
                          } as Record<string, string>
                        )[detailsOf(item).workflow ?? 'result']
                      }{' '}
                      ·{' '}
                      {
                        (
                          {
                            requested: 'Aguardando',
                            received: 'Recebido',
                            reviewed: 'Revisado',
                            acted: 'Conduta registrada',
                            contacted: 'Contato realizado',
                            confirmed: 'Confirmado pelo paciente',
                            declined: 'Recusado pelo paciente',
                          } as Record<string, string>
                        )[detailsOf(item).stage ?? 'requested']
                      }
                      {detailsOf(item).availability ? ' · ' + detailsOf(item).availability : ''}
                    </p>
                  )}
                  {item.kind === 'observation' && (
                    <p className="text-sm mt-2">
                      {detailsOf(item).value} {detailsOf(item).unit} · {detailsOf(item).date} · fonte:{' '}
                      {detailsOf(item).source || 'não informada'}
                    </p>
                  )}
                  {item.kind === 'medication' && (
                    <p className="text-sm mt-2">
                      {
                        ({ active: 'Ativo', changed: 'Alterado', stopped: 'Suspenso' } as Record<string, string>)[
                          detailsOf(item).state
                        ]
                      }{' '}
                      · {detailsOf(item).date} · fonte: {detailsOf(item).source || 'registro do médico'}
                    </p>
                  )}
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-6">
                Nenhum registro nesta lista. Abra um paciente para documentar ou criar um acompanhamento.
              </p>
            )}
          </section>
        )}
        {patientId && tab === 'history' && (
          <section className="space-y-4">
            {history.isError ? (
              <p role="alert">
                Histórico indisponível.{' '}
                <button className="underline" onClick={() => history.refetch()}>
                  Tentar novamente
                </button>
              </p>
            ) : history.isLoading ? (
              <p role="status">Carregando histórico…</p>
            ) : history.data?.length ? (
              history.data.map((c) => (
                <article className="rounded-xl border bg-card p-5" key={c.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="font-semibold">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')} · {c.chief_complaint || 'Consulta'}
                    </h2>
                    <Button size="sm" variant="outline" onClick={() => setCompare(compare === c.id ? null : c.id)}>
                      Comparar revisões
                    </Button>
                  </div>
                  <ClinicalMarkdown className="mt-4" text={c.soap_note ?? ''} />
                  {compare === c.id && (
                    <div className="border-t mt-4 pt-4 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Texto atual acima. Versões anteriores preservadas abaixo.
                      </p>
                      {revisions.isError ? (
                        <p role="alert">Revisões indisponíveis.</p>
                      ) : revisions.isLoading ? (
                        <p role="status">Carregando revisões…</p>
                      ) : revisions.data?.length ? (
                        revisions.data.map((r) => (
                          <details key={r.id}>
                            <summary className="cursor-pointer text-sm">
                              Versão {r.revision} · {new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </summary>
                            <pre className="text-sm whitespace-pre-wrap p-3 bg-muted rounded mt-2">
                              {typeof r.snapshot === 'object' && r.snapshot && !Array.isArray(r.snapshot)
                                ? String(r.snapshot.soap_note ?? '')
                                : ''}
                            </pre>
                          </details>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Sem versões anteriores.</p>
                      )}
                    </div>
                  )}
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Sem consultas registradas.</p>
            )}
          </section>
        )}
        {(work.data?.length === limit || history.data?.length === limit) && (
          <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>
            Carregar mais registros
          </Button>
        )}
        <p className="text-xs text-muted-foreground border-t pt-4">
          Listas e registros pertencem à sua conta. Compartilhamento entre médicos é gerenciado separadamente. Nenhuma
          pendência é concluída por interpretação automática.
        </p>
      </Content>
    </div>
  );
}
