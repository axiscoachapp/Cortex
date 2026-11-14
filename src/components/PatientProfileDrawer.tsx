import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Calendar,
  User,
  Heart,
  Brain,
  Sparkles,
  Pencil,
  Check,
  X,
  MessageCircle,
  Printer,
  StickyNote,
  Phone,
  Mail,
  MessagesSquare,
} from 'lucide-react';
import { SoapNoteView } from '@/components/SoapNoteView';
import { Patient } from '@/types/patient';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { printSoap, printDossier, escapeHtml } from '@/lib/printDoc';
import { useClinicAccess } from '@/features/reception/accessContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { PatientFiles } from '@/components/PatientFiles';
import { PrescriptionList } from '@/components/PrescriptionList';
import { fetchAllRows } from '@/lib/pagination';
import { lastConsultationLabel } from '@/lib/dates';
import { parseProfileText, type ProfileTextGroup } from '@/lib/profileText';
import { isImportedNote } from '@/lib/importedNotes';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { hasInsights, useInsightsProposal, type AIInsights } from '@/hooks/useInsightsProposal';

interface PatientProfileDrawerProps {
  patient: Patient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional deep-link to the chat (e.g. switches mobile view on small screens). */
  onAskAI?: () => void;
}


interface Consultation {
  id: string;
  created_at: string;
  chief_complaint: string | null;
  soap_note: string | null;
  whatsapp_message: string | null;
  transcription: string | null;
}

interface PatientDetail {
  revision: number;
  ai_insights: AIInsights | null;
  social_anamnesis: string;
  medical_history: string;
  clinical_notes: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ──────────────────────────────────────────────────────────────────────── */

export function PatientProfileDrawer({ patient, open, onOpenChange, onAskAI }: PatientProfileDrawerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'social' | 'medical' | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [editBase, setEditBase] = useState('');
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [visibleHistory, setVisibleHistory] = useState(50);
  const [acceptingInsights, setAcceptingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  useUnsavedChanges(!!editingField && draftValue !== editBase);
  const activePatientId = useRef(patient?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { prescriber } = useUserSettings();
  const { proposal, setProposal } = useInsightsProposal(patient?.id, user?.id);
  const access = useClinicAccess();
  const printAuthor = {
    name: prescriber.doctorName,
    crm: prescriber.crmNumber,
    crmUf: prescriber.crmUf,
    clinicName: access?.clinic?.name,
  };

  // Reset transient UI state on patient switch.
  useEffect(() => {
    setExpandedId(null);
    setEditingField(null);
    setDraftValue('');
    setEditBase('');
    setEditRevision(null);
    setSaveError('');
    setConflict(false);
    setSaving(false);
    setVisibleHistory(50);
    setInsightsError('');
    setAcceptingInsights(false);
    activePatientId.current = patient?.id;
  }, [patient?.id]);
  useEffect(() => {
    if (!editingField || draftValue === editBase) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editingField, draftValue, editBase]);

  /* ── Queries ─────────────────────────────────────────────────────────── */
  const enabled = !!patient?.id && !!user?.id && open;

  const {
    data: detail,
    isPending: detailLoading,
    fetchStatus: detailFetchStatus,
    isError: detailError,
    refetch: refetchDetail,
  } = useQuery<PatientDetail>({
    queryKey: ['patient-detail', patient?.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('revision, ai_insights, social_anamnesis, medical_history, clinical_notes')
        .eq('id', patient!.id)
        .single();
      if (error || !data) throw error ?? new Error('Patient not found');
      return {
        revision: data.revision,
        ai_insights: (data?.ai_insights as AIInsights) ?? null,
        social_anamnesis: data?.social_anamnesis ?? '',
        medical_history: data?.medical_history ?? '',
        clinical_notes: data?.clinical_notes ?? '',
      };
    },
    enabled,
    staleTime: 30_000,
  });

  const {
    data: storedConsultations = [],
    isPending: consultationsLoading,
    fetchStatus: consultationsFetchStatus,
    isError: consultationsError,
    refetch: refetchConsultations,
  } = useQuery<Consultation[]>({
    queryKey: ['patient-consultations', patient?.id, user?.id],
    queryFn: async () => {
      return fetchAllRows<Consultation>((from, to) =>
        supabase
          .from('consultations')
          .select('id, created_at, chief_complaint, soap_note, whatsapp_message, transcription')
          .eq('patient_id', patient!.id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      );
    },
    enabled,
    staleTime: 30_000,
  });

  /* ── Derived data ────────────────────────────────────────────────────── */
  const detailReady = enabled && !!detail && !detailError && detailFetchStatus === 'idle';
  const consultationsReady = enabled && !consultationsLoading && !consultationsError && consultationsFetchStatus === 'idle';
  const consultations = useMemo(() => consultationsReady ? storedConsultations : [], [consultationsReady, storedConsultations]);
  // "Gerados pela consulta" lists what a consultation in Cortex produced; records brought from the
  // clinic's previous system are read in Histórico.
  const generatedHere = useMemo(
    () => consultations.slice(0, visibleHistory).filter((c) => !isImportedNote(c.soap_note)),
    [consultations, visibleHistory],
  );
  const socialAnamnesis = detailReady ? detail.social_anamnesis : '';
  const medicalHistory = detailReady ? detail.medical_history : '';
  const aiInsights = detailReady ? detail.ai_insights : null;
  const clinicalNotes = detailReady ? detail.clinical_notes : '';
  const clinicalUnavailable = detailReady ? undefined : 'Aguarde a leitura dos dados clínicos para consultar esta seção.';

  const noteEntries = useMemo(
    () =>
      clinicalNotes
        .split(/\n(?=\[)/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
          return m ? { stamp: m[1], body: m[2].trim() } : { stamp: '', body: line };
        })
        .reverse(),
    [clinicalNotes],
  );

  const stats = useMemo(() => {
    const last = consultations[0];
    return {
      total: consultations.length,
      lastVisit: last ? lastConsultationLabel(last.created_at) : '',
      activeMeds: patient?.medications.length ?? 0,
    };
  }, [consultations, patient?.medications.length]);

  /* ── Editing ─────────────────────────────────────────────────────────── */
  const startEdit = (field: 'social' | 'medical') => {
    if (!detailReady || saving) return;
    if (editingField && draftValue !== editBase && !window.confirm('Descartar as alterações desta seção?')) return;
    setEditingField(field);
    const value = field === 'social' ? socialAnamnesis : medicalHistory;
    setDraftValue(value);
    setEditBase(value);
    setEditRevision(detail.revision);
    setSaveError('');
    setConflict(false);
  };

  const cancelEdit = () => {
    if (saving || (draftValue !== editBase && !window.confirm('Descartar as alterações desta seção?'))) return;
    setEditingField(null);
    setDraftValue('');
    setSaveError('');
    setConflict(false);
    setEditRevision(null);
  };

  const saveEdit = async (field: 'social' | 'medical') => {
    if (!patient?.id || !detailReady || saving || conflict || editRevision === null) return;
    const requestedId = patient.id;
    const update = field === 'social' ? { social_anamnesis: draftValue } : { medical_history: draftValue };

    setSaving(true);
    setSaveError('');
    try {
      const { data, error } = await supabase
        .from('patients')
        .update(update)
        .eq('id', requestedId)
        .eq('revision', editRevision)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        if (activePatientId.current === requestedId) {
          setConflict(true);
          setSaveError(
            'O prontuário foi alterado em outro atendimento. Seu texto foi mantido. Compare com a versão atual antes de salvar.',
          );
          await refetchDetail();
        }
        return;
      }
      if (activePatientId.current === requestedId) {
        setEditingField(null);
        setDraftValue('');
      }
      queryClient.invalidateQueries({ queryKey: ['patient-detail', requestedId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      toast({ title: 'Salvo com sucesso' });
    } catch {
      if (activePatientId.current === requestedId)
        setSaveError('Não foi possível salvar. Seu texto foi mantido; tente novamente.');
    } finally {
      if (activePatientId.current === requestedId) setSaving(false);
    }
  };
  /* ── AI insights proposal ─────────────────────────────────────────── */
  const acceptInsights = async () => {
    if (!patient?.id || !proposal || !detailReady || acceptingInsights) return;
    const requestedId = patient.id;
    setAcceptingInsights(true);
    setInsightsError('');
    try {
      const { data, error } = await supabase
        .from('patients')
        .update({ ai_insights: proposal.insights as Json })
        .eq('id', requestedId)
        .eq('revision', detail.revision)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        if (activePatientId.current === requestedId) {
          setInsightsError('O prontuário foi alterado em outra tela. Os dados foram atualizados; confira e aceite de novo.');
          await refetchDetail();
        }
        return;
      }
      setProposal(null);
      queryClient.invalidateQueries({ queryKey: ['patient-detail', requestedId] });
      toast({ title: 'Sugestões aceitas', description: 'As sugestões da IA foram salvas no perfil.' });
    } catch {
      if (activePatientId.current === requestedId)
        setInsightsError('Não foi possível salvar as sugestões. Elas foram mantidas aqui; tente de novo.');
    } finally {
      if (activePatientId.current === requestedId) setAcceptingInsights(false);
    }
  };

  const discardInsights = () => {
    if (acceptingInsights) return;
    if (!window.confirm('Descartar as sugestões da IA? Para gerar de novo será preciso processar as anotações outra vez.')) return;
    setProposal(null);
    setInsightsError('');
  };

  const requestOpenChange = (next: boolean) => {
    if (
      saving ||
      (!next && editingField && draftValue !== editBase && !window.confirm('Descartar as alterações do prontuário?'))
    )
      return false;
    if (!next) {
      setEditingField(null);
      setDraftValue('');
      setSaveError('');
      setConflict(false);
    }
    onOpenChange(next);
    return true;
  };

  /* ── Print ───────────────────────────────────────────────────────────── */
  const handlePrintDossier = () => {
    if (!patient || !detailReady || !consultationsReady) return;
    printDossier(patient, consultations, {
      author: printAuthor,
      socialAnamnesis,
      medicalHistory,
      clinicalNotes,
      diagnoses: patient.diagnoses,
    });
  };

  if (!patient) return null;

  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto">
        <SheetHeader className="border-b border-border pb-4">
          <SheetDescription className="sr-only">
            Dados clínicos, histórico de consultas e documentos deste paciente.
          </SheetDescription>
          {/* On a phone the name takes the whole width (clear of the close
              button) and the actions go below it. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <SheetTitle className="flex items-center gap-3 text-lg min-w-0 pr-8 sm:pr-0">
              <div className="w-10 h-10 rounded-full bg-medical-blue-light border-2 border-medical-blue/30 flex items-center justify-center shrink-0">
                <span className="text-medical-blue font-bold text-sm">
                  {patient.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-foreground line-clamp-2 break-words">
                  <span className="sr-only">Dossiê: </span>
                  {patient.name}
                </span>
                <p className="text-sm font-normal text-muted-foreground">
                  {patient.age === null ? 'Idade não informada' : String(patient.age) + ' anos'}
                  {patient.profession ? ` · ${patient.profession}` : ''}
                </p>
              </div>
            </SheetTitle>
            <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
              {onAskAI && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  onClick={() => {
                    if (requestOpenChange(false)) onAskAI();
                  }}
                  title="Abrir o chat para perguntar à IA sobre este paciente"
                >
                  <MessagesSquare className="w-3.5 h-3.5" />
                  <span>Perguntar à IA</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={handlePrintDossier}
                disabled={!detailReady || !consultationsReady}
                title="Imprimir dossiê completo"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Dossiê</span>
              </Button>
            </div>
          </div>

          {/* Contact chips */}
          {(patient.phone || patient.email) && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {patient.phone && (
                <a
                  href={`tel:${patient.phone}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-medium bg-medical-blue-light text-medical-blue-dark hover:bg-medical-blue/15 transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  {patient.phone}
                </a>
              )}
              {patient.email && (
                <a
                  href={`mailto:${patient.email}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-medium bg-secondary/60 hover:bg-secondary transition-colors text-foreground/80"
                >
                  <Mail className="w-3 h-3" />
                  {patient.email}
                </a>
              )}
            </div>
          )}

          {/* Visit summary in one line, so the tabs start near the top. */}
          <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
            {consultationsReady
              ? [
                  stats.total > 0 ? `Última consulta: ${stats.lastVisit}` : null,
                  stats.total === 1 ? '1 consulta' : `${stats.total} consultas`,
                  stats.activeMeds === 1 ? '1 medicação ativa' : `${stats.activeMeds} medicações ativas`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Carregando consultas…'}
          </p>
        </SheetHeader>
        {(detailLoading || detailFetchStatus !== 'idle') && (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            {detailFetchStatus === 'paused' ? 'Aguardando conexão para carregar os dados clínicos.' : 'Carregando os dados clínicos…'}
          </p>
        )}
        {detailError && detailFetchStatus === 'idle' && (
          <div role="alert" className="py-4 text-sm space-y-2">
            <p>
              Não foi possível carregar os dados clínicos. A edição está indisponível até o carregamento ser concluído.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchDetail()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {consultationsError && (
          <div role="alert" className="py-4 text-sm space-y-2">
            <p>Não foi possível carregar o histórico de consultas.</p>
            <Button variant="outline" size="sm" onClick={() => refetchConsultations()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {saveError && (
          <div role="alert" className="py-3 text-sm text-destructive space-y-2">
            <p>{saveError}</p>
            {conflict && detailReady && (
              <>
                <p className="whitespace-pre-wrap text-foreground">
                  Versão atual: {editingField === 'social' ? detail.social_anamnesis : detail.medical_history}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditRevision(detail.revision);
                    setConflict(false);
                    setSaveError('');
                  }}
                >
                  Conferi a versão atual — continuar revisão
                </Button>
              </>
            )}
          </div>
        )}

        <Tabs defaultValue="overview" className="mt-6">
          {/* On a phone the three labels may need two lines each (135% scale). */}
          <TabsList className="grid w-full grid-cols-3 mb-6 h-auto min-h-10">
            <TabsTrigger value="overview" className="text-xs sm:text-sm h-full whitespace-normal leading-tight px-1">
              Geral
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm h-full whitespace-normal leading-tight px-1">
              Histórico {consultations.length > 0 && `(${consultations.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs sm:text-sm h-full whitespace-normal leading-tight px-1">
              Documentos
            </TabsTrigger>
          </TabsList>

          {/* ─── Geral ───────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            <EditableSection
              icon={<User className="w-4 h-4 text-medical-blue" />}
              iconBg="bg-medical-blue-light"
              title="Anamnese social"
              value={socialAnamnesis}
              isEditing={editingField === 'social'}
              draftValue={draftValue}
              onEdit={() => startEdit('social')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('social')}
              onDraftChange={setDraftValue}
              disabled={saving || !detailReady || conflict}
              unavailableMessage={clinicalUnavailable}
              placeholder="Adicione informações sociais do paciente (estado civil, trabalho, hábitos...)"
            />

            <EditableSection
              icon={<Heart className="w-4 h-4 text-success" />}
              iconBg="bg-success/10"
              title="Histórico médico"
              value={medicalHistory}
              isEditing={editingField === 'medical'}
              draftValue={draftValue}
              onEdit={() => startEdit('medical')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('medical')}
              onDraftChange={setDraftValue}
              disabled={saving || !detailReady || conflict}
              unavailableMessage={clinicalUnavailable}
              placeholder="Adicione cirurgias, doenças preexistentes, histórico familiar..."
            />

            {/* Anotações do médico — written from chat in Comentário mode */}
            {noteEntries.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
                      <StickyNote className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="font-semibold text-foreground">Anotações do médico</h3>
                  </div>
                  <span className="text-[0.625rem] text-muted-foreground">{noteEntries.length}</span>
                </div>
                <div className="pl-10 space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1">
                  {noteEntries.map((n, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-secondary/40 border border-border/40">
                      {n.stamp && <p className="text-[0.625rem] text-muted-foreground font-mono mb-0.5">{n.stamp}</p>}
                      <p className="text-sm text-foreground/85 leading-snug whitespace-pre-wrap">{n.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI Insights */}
            <section className="space-y-3" aria-labelledby="ai-insights-title">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <h3 id="ai-insights-title" className="font-semibold text-foreground">Sugestões da IA</h3>
              </div>
              {proposal && (
                <div className="pl-10 space-y-3">
                  <div className="p-4 rounded-lg border border-primary/40 bg-primary/5 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Sugestão da IA para revisar</p>
                      <p className="text-xs text-muted-foreground">
                        Gerada a partir das suas anotações. Nada foi salvo no perfil até você aceitar.
                      </p>
                    </div>
                    <InsightsView insights={proposal.insights} />
                    {insightsError && (
                      <p role="alert" className="text-sm text-destructive">
                        {insightsError}
                      </p>
                    )}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button size="sm" variant="outline" onClick={discardInsights} disabled={acceptingInsights}>
                        Descartar
                      </Button>
                      <Button size="sm" onClick={acceptInsights} disabled={acceptingInsights || !detailReady}>
                        {acceptingInsights ? 'Salvando…' : 'Aceitar sugestões'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {!detailReady ? null : hasInsights(aiInsights) ? (
                <div className="pl-10 space-y-4">
                  {proposal && <p className="text-xs font-semibold text-muted-foreground uppercase">Salvos no perfil</p>}
                  <InsightsView insights={aiInsights} />
                </div>
              ) : proposal ? null : (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">
                    Nenhuma sugestão salva. Escreva anotações em “Extrair com IA”, ao lado da consulta, e revise a
                    sugestão antes de salvar.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ─── Histórico ───────────────────────────────────────────── */}
          <TabsContent value="history" className="space-y-4">
            <h3 className="font-semibold text-foreground">Histórico de Consultas</h3>
            {consultationsLoading || consultationsFetchStatus !== 'idle' ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-lg bg-secondary/40 animate-pulse" />
                ))}
              </div>
            ) : consultationsError ? null : consultations.length === 0 ? (
              <div className="p-6 text-center rounded-lg border border-border bg-card">
                <p className="text-sm text-muted-foreground">Nenhuma consulta registrada ainda.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
                <div className="space-y-4">
                  {consultations.slice(0, visibleHistory).map((c, idx) => {
                    const isFirst = idx === 0;
                    const isExpanded = expandedId === c.id;
                    return (
                      <div key={c.id} className="relative pl-10">
                        <div
                          className={cn(
                            'absolute left-2 top-1 w-4 h-4 rounded-full border-2 bg-background',
                            isFirst ? 'border-medical-blue bg-medical-blue' : 'border-muted-foreground/30',
                          )}
                        >
                          {isFirst && (
                            <span className="absolute inset-0 animate-ping rounded-full bg-medical-blue opacity-50" />
                          )}
                        </div>
                        <div
                          className={cn(
                            'p-4 rounded-lg border',
                            isFirst ? 'border-medical-blue/30 bg-medical-blue-light/50' : 'border-border bg-card',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium text-foreground">{lastConsultationLabel(c.created_at)}</span>
                              {isFirst && (
                                <Badge className="bg-medical-blue text-primary-foreground text-xs">Última consulta</Badge>
                              )}
                              {isImportedNote(c.soap_note) && (
                                <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                  Importado
                                </Badge>
                              )}
                            </div>
                            {(c.soap_note || c.whatsapp_message || c.transcription) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setExpandedId(isExpanded ? null : c.id)}
                              >
                                {isExpanded ? 'Ocultar' : 'Detalhes'}
                              </Button>
                            )}
                          </div>
                          {c.chief_complaint &&
                            // An imported record has a title, not a complaint taken in a consultation here.
                            (isImportedNote(c.soap_note) ? (
                              <p className="text-sm font-medium text-foreground">{c.chief_complaint}</p>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">Queixa:</span> {c.chief_complaint}
                              </p>
                            ))}
                          {isExpanded && (
                            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                              {c.soap_note && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
                                      {isImportedNote(c.soap_note) ? 'Registro importado' : 'Evolução SOAP'}
                                    </h5>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-[0.6875rem] gap-1"
                                      onClick={() =>
                                        printSoap(c.soap_note!, patient, c.chief_complaint ?? undefined, {
                                          consultationDate: c.created_at,
                                          author: printAuthor,
                                        })
                                      }
                                    >
                                      <Printer className="w-3 h-3" /> Imprimir
                                    </Button>
                                  </div>
                                  <SoapNoteView text={c.soap_note} />
                                </div>
                              )}
                              {c.whatsapp_message && (
                                <div>
                                  <div className="flex items-center gap-1.5 mb-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
                                    <MessageCircle className="w-3 h-3" />
                                    Mensagem ao paciente
                                  </div>
                                  <div className="text-sm whitespace-pre-wrap text-foreground/85 leading-relaxed bg-whatsapp-light/60 p-3 rounded-lg border border-whatsapp-green/20">
                                    {c.whatsapp_message}
                                  </div>
                                </div>
                              )}
                              {c.transcription && (
                                <details className="text-sm">
                                  <summary className="cursor-pointer text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground select-none">
                                    Transcrição completa
                                  </summary>
                                  <div className="mt-2 p-3 rounded-lg bg-secondary/40 border border-border/40 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80 max-h-[260px] overflow-y-auto scrollbar-thin">
                                    {c.transcription}
                                  </div>
                                </details>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ─── Documentos ──────────────────────────────────────────── */}
          <TabsContent value="documents" className="space-y-6">
            {/* Receitas e atestados gerados */}
            <PrescriptionList patientId={patient.id} />

            {/* Arquivos anexados */}
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold text-foreground">Arquivos anexados</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Exames, fotos, receitas externas — anexados manualmente ao paciente.
                </p>
              </div>
              {user?.id ? (
                <PatientFiles key={patient.id} patientId={patient.id} userId={user.id} />
              ) : (
                <p className="text-xs text-muted-foreground">Faça login para anexar arquivos.</p>
              )}
            </section>

            {/* Documentos gerados por consulta */}
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold text-foreground">Gerados pela consulta</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Evoluções SOAP e mensagens WhatsApp produzidas pela IA, prontas para imprimir.
                </p>
              </div>

              {consultationsLoading || consultationsFetchStatus !== 'idle' ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 rounded-lg bg-secondary/40 animate-pulse" />
                  ))}
                </div>
              ) : consultationsError ? null : generatedHere.length === 0 ? (
                <div className="p-6 text-center rounded-lg border border-border bg-card">
                  <p className="text-sm text-muted-foreground">
                    {consultations.length === 0
                      ? 'Nenhuma consulta registrada ainda.'
                      : 'Nenhuma consulta feita no Cortex ainda. Os registros importados estão em Histórico.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {generatedHere.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-medical-blue" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          Consulta de {formatDate(c.created_at)}
                        </p>
                        {c.chief_complaint && (
                          <p className="text-xs text-muted-foreground truncate">{c.chief_complaint}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.soap_note && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 gap-1 text-xs"
                            onClick={() =>
                                        printSoap(c.soap_note!, patient, c.chief_complaint ?? undefined, {
                                          consultationDate: c.created_at,
                                          author: printAuthor,
                                        })
                                      }
                          >
                            <Printer className="w-3.5 h-3.5" />
                            SOAP
                          </Button>
                        )}
                        {c.whatsapp_message && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 gap-1 text-xs text-whatsapp-green hover:text-whatsapp-green hover:bg-whatsapp-light/50"
                            onClick={() => {
                              const w = window.open('', '_blank');
                              if (!w) return;
                              w.document.write(
                                `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Mensagem — ${escapeHtml(patient.name)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;line-height:1.6;color:#111827}.msg{white-space:pre-wrap;padding:16px 18px;background:#dcfce7;border-radius:12px}h1{font-size:14pt;color:#15803d;margin-bottom:8px}</style></head><body><h1>Mensagem para ${escapeHtml(patient.name)}</h1><div class="msg">${escapeHtml(c.whatsapp_message!)}</div></body></html>`,
                              );
                              w.document.close();
                            }}
                            title="Abrir mensagem em nova aba"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            WhatsApp
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
        {consultations.length > visibleHistory && (
          <Button variant="outline" className="mt-4" onClick={() => setVisibleHistory((count) => count + 50)}>
            Mostrar mais consultas
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

interface EditableSectionProps {
  disabled?: boolean;
  unavailableMessage?: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  value: string;
  isEditing: boolean;
  draftValue: string;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDraftChange: (v: string) => void;
  placeholder: string;
}

/** How many facts of a group show before "Mostrar mais". */
const GROUP_PREVIEW = 6;

/** One group of the history: its heading (if any) and facts, long groups folded. */
function ProfileTextGroupView({ group }: { group: ProfileTextGroup }) {
  const [expanded, setExpanded] = useState(false);
  // Folding only pays off when it hides more than a couple of lines.
  const foldable = group.items.length > GROUP_PREVIEW + 2;
  const shown = foldable && !expanded ? group.items.slice(0, GROUP_PREVIEW) : group.items;
  const more = expanded ? 'Mostrar menos' : `Mostrar mais ${group.items.length - GROUP_PREVIEW}`;
  return (
    <div className="space-y-1.5">
      {group.heading && <h4 className="text-xs font-semibold text-foreground">{group.heading}</h4>}
      <ul className="space-y-1.5">
        {shown.map((item, i) => (
          <li key={i} className="text-sm text-muted-foreground leading-snug flex items-start gap-2">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {foldable && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-expanded={expanded}
          // The visible words first, then which group, so a screen reader can tell the buttons apart.
          aria-label={group.heading ? `${more} de ${group.heading}` : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {more}
        </Button>
      )}
    </div>
  );
}

function EditableSection({
  icon,
  iconBg,
  title,
  value,
  isEditing,
  draftValue,
  onEdit,
  onCancel,
  onSave,
  onDraftChange,
  placeholder,
  disabled,
  unavailableMessage,
}: EditableSectionProps) {
  const groups = parseProfileText(value);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', iconBg)}>{icon}</div>
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        {!isEditing && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Editar ${title.toLowerCase()}`}
            disabled={disabled}
            className="h-7 w-7"
            onClick={onEdit}
          >
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="pl-10 space-y-2">
          <Textarea
            aria-label={title}
            disabled={disabled}
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            // A grouped history is long: the box grows with it (up to most of the screen) instead of
            // showing four lines of forty.
            rows={Math.min(24, Math.max(4, draftValue.split('\n').length + 1))}
            className="min-h-[100px] max-h-[60vh] text-sm resize-y"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="medical" disabled={disabled} onClick={onSave} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />
              Salvar
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </Button>
          </div>
        </div>
      ) : unavailableMessage ? (
        <p className="text-sm leading-relaxed pl-10 text-muted-foreground">{unavailableMessage}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm leading-relaxed pl-10 text-muted-foreground italic">{placeholder}</p>
      ) : (
        <div className="pl-10 space-y-4">
          {groups.map((group, i) => (
            <ProfileTextGroupView key={`${i}:${group.heading ?? ''}`} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

function InsightsView({ insights }: { insights: AIInsights }) {
  const lists: Array<[keyof AIInsights, string, string, string]> = [
    ['symptoms', 'Sintomas', '•', 'text-medical-blue'],
    ['behavioral_observations', 'Observações comportamentais', '•', 'text-medical-blue'],
    ['risk_factors', 'Fatores de risco', '⚠️', 'text-destructive'],
    ['family_history', 'Histórico familiar', '•', 'text-medical-blue'],
    ['social_factors', 'Fatores sociais', '•', 'text-medical-blue'],
    ['clinical_changes', 'Mudanças clínicas', '✓', 'text-success'],
  ];
  return (
    <div className="space-y-4">
      {insights.summary && (
        <div className="p-4 rounded-lg bg-medical-blue-light/30 border border-medical-blue/20">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-medical-blue" />
            <span className="text-xs font-semibold text-medical-blue uppercase">Resumo</span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{insights.summary}</p>
        </div>
      )}
      {lists.map(([key, title, bullet, color]) => {
        const items = insights[key];
        return Array.isArray(items) && items.length ? (
          <InsightList key={key} title={title} items={items} bullet={bullet} bulletColor={color} />
        ) : null;
      })}
    </div>
  );
}

function InsightList({
  title,
  items,
  bullet,
  bulletColor,
}: {
  title: string;
  items: string[];
  bullet: string;
  bulletColor: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
            <span className={bulletColor}>{bullet}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
