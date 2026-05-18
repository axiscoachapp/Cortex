import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Calendar, User, Heart, Brain, Sparkles, Pencil, Check, X,
  MessageCircle, Printer, Stethoscope, Clock, StickyNote, Activity,
  Phone, Mail, MessagesSquare,
} from 'lucide-react';
import { SoapNoteView } from '@/components/SoapNoteView';
import { Patient } from '@/types/patient';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { printSoap, printDossier } from '@/lib/printDoc';
import { PatientFiles } from '@/components/PatientFiles';
import { UsageMeter } from '@/components/UsageMeter';

interface PatientProfileDrawerProps {
  patient: Patient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional deep-link to the chat (e.g. switches mobile view on small screens). */
  onAskAI?: () => void;
}

interface AIInsights {
  symptoms?: string[];
  behavioral_observations?: string[];
  risk_factors?: string[];
  family_history?: string[];
  social_factors?: string[];
  clinical_changes?: string[];
  summary?: string;
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
  ai_insights: AIInsights | null;
  social_anamnesis: string;
  medical_history: string;
  clinical_notes: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function relativeDays(iso: string): string {
  const d = daysBetween(iso);
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  if (d < 365) return `há ${Math.floor(d / 30)} meses`;
  return `há ${Math.floor(d / 365)} anos`;
}

/* ──────────────────────────────────────────────────────────────────────── */

export function PatientProfileDrawer({ patient, open, onOpenChange, onAskAI }: PatientProfileDrawerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'social' | 'medical' | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Reset transient UI state on patient switch.
  useEffect(() => {
    setExpandedId(null);
    setEditingField(null);
    setDraftValue('');
  }, [patient?.id]);

  /* ── Queries ─────────────────────────────────────────────────────────── */
  const enabled = !!patient?.id && open;

  const { data: detail, isLoading: detailLoading } = useQuery<PatientDetail>({
    queryKey: ['patient-detail', patient?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('patients')
        .select('ai_insights, social_anamnesis, medical_history, clinical_notes')
        .eq('id', patient!.id)
        .single();
      return {
        ai_insights: (data?.ai_insights as AIInsights) ?? null,
        social_anamnesis: data?.social_anamnesis ?? '',
        medical_history: data?.medical_history ?? '',
        clinical_notes: data?.clinical_notes ?? '',
      };
    },
    enabled,
    staleTime: 30_000,
  });

  const { data: consultations = [], isLoading: consultationsLoading } = useQuery<Consultation[]>({
    queryKey: ['patient-consultations', patient?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('consultations')
        .select('id, created_at, chief_complaint, soap_note, whatsapp_message, transcription')
        .eq('patient_id', patient!.id)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled,
    staleTime: 30_000,
  });

  /* ── Derived data ────────────────────────────────────────────────────── */
  const socialAnamnesis = detail?.social_anamnesis ?? patient?.socialAnamnesis ?? '';
  const medicalHistory = detail?.medical_history ?? patient?.medicalHistory ?? '';
  const aiInsights = detail?.ai_insights ?? null;
  const clinicalNotes = detail?.clinical_notes ?? '';

  const noteEntries = useMemo(() => clinicalNotes
    .split(/\n(?=\[)/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      return m ? { stamp: m[1], body: m[2].trim() } : { stamp: '', body: line };
    })
    .reverse(),
    [clinicalNotes]);

  const stats = useMemo(() => {
    const first = consultations[consultations.length - 1];
    const last = consultations[0];
    return {
      total: consultations.length,
      firstVisit: first ? relativeDays(first.created_at) : '—',
      lastVisit: last ? relativeDays(last.created_at) : '—',
      activeMeds: patient?.medications.length ?? 0,
    };
  }, [consultations, patient?.medications.length]);

  /* ── Editing ─────────────────────────────────────────────────────────── */
  const startEdit = (field: 'social' | 'medical') => {
    setEditingField(field);
    setDraftValue(field === 'social' ? socialAnamnesis : medicalHistory);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraftValue('');
  };

  const saveEdit = async (field: 'social' | 'medical') => {
    if (!patient?.id) return;
    const update = field === 'social'
      ? { social_anamnesis: draftValue }
      : { medical_history: draftValue };

    const { error } = await supabase.from('patients').update(update).eq('id', patient.id);
    if (error) { toast({ title: 'Erro ao salvar', variant: 'destructive' }); return; }

    setEditingField(null);
    setDraftValue('');
    // Refresh drawer detail AND the global patients query (used by sidebar/snapshot).
    queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    toast({ title: 'Salvo com sucesso' });
  };

  /* ── Print ───────────────────────────────────────────────────────────── */
  const handlePrintDossier = () => {
    if (!patient) return;
    printDossier(patient, consultations, {
      socialAnamnesis,
      medicalHistory,
      clinicalNotes,
      diagnoses: patient.diagnoses,
    });
  };

  if (!patient) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto">
        <SheetHeader className="border-b border-border pb-4">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="flex items-center gap-3 text-lg min-w-0">
              <div className="w-10 h-10 rounded-full bg-medical-blue-light border-2 border-medical-blue/30 flex items-center justify-center shrink-0">
                <span className="text-medical-blue font-bold text-sm">
                  {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-foreground truncate block max-w-[200px] md:max-w-[320px]">
                  Dossiê: {patient.name}
                </span>
                <p className="text-sm font-normal text-muted-foreground">
                  {patient.age} anos{patient.profession ? ` · ${patient.profession}` : ''}
                </p>
              </div>
            </SheetTitle>
            <div className="flex items-center gap-1 shrink-0">
              {onAskAI && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  onClick={() => { onOpenChange(false); onAskAI(); }}
                  title="Abrir o chat para perguntar à IA sobre este paciente"
                >
                  <MessagesSquare className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Perguntar à IA</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={handlePrintDossier}
                title="Imprimir dossiê completo"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Dossiê</span>
              </Button>
            </div>
          </div>

          {/* Contact chips */}
          {(patient.phone || patient.email) && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {patient.phone && (
                <a
                  href={`tel:${patient.phone}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-medical-blue-light text-medical-blue-dark hover:bg-medical-blue/15 transition-colors"
                >
                  <Phone className="w-3 h-3" />
                  {patient.phone}
                </a>
              )}
              {patient.email && (
                <a
                  href={`mailto:${patient.email}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-secondary/60 hover:bg-secondary transition-colors text-foreground/80"
                >
                  <Mail className="w-3 h-3" />
                  {patient.email}
                </a>
              )}
            </div>
          )}

          {/* Quick stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <Stat icon={Stethoscope} label="Consultas" value={String(stats.total)} loading={consultationsLoading} />
            <Stat icon={Clock} label="Última visita" value={stats.lastVisit} loading={consultationsLoading} />
            <Stat icon={Calendar} label="Primeira" value={stats.firstVisit} loading={consultationsLoading} />
            <Stat icon={Activity} label="Med. ativas" value={String(stats.activeMeds)} />
          </div>

          {/* Usage meter */}
          <div className="mt-3">
            <UsageMeter variant="pill" />
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-3 mb-6 h-10">
            <TabsTrigger value="overview" className="text-xs sm:text-sm h-full">Geral</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm h-full">
              Histórico {consultations.length > 0 && `(${consultations.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs sm:text-sm h-full">Documentos</TabsTrigger>
          </TabsList>

          {/* ─── Geral ───────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            <EditableSection
              icon={<User className="w-4 h-4 text-medical-blue" />}
              iconBg="bg-medical-blue-light"
              title="Anamnese Social"
              value={socialAnamnesis}
              isEditing={editingField === 'social'}
              draftValue={draftValue}
              onEdit={() => startEdit('social')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('social')}
              onDraftChange={setDraftValue}
              placeholder="Adicione informações sociais do paciente (estado civil, trabalho, hábitos...)"
            />

            <EditableSection
              icon={<Heart className="w-4 h-4 text-success" />}
              iconBg="bg-success/10"
              title="Histórico Médico"
              value={medicalHistory}
              isEditing={editingField === 'medical'}
              draftValue={draftValue}
              onEdit={() => startEdit('medical')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('medical')}
              onDraftChange={setDraftValue}
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
                    <h3 className="font-semibold text-foreground">Anotações do Médico</h3>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">{noteEntries.length}</span>
                </div>
                <div className="pl-10 space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1">
                  {noteEntries.map((n, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-secondary/40 border border-border/40">
                      {n.stamp && (
                        <p className="text-[10px] text-muted-foreground/70 font-mono mb-0.5">{n.stamp}</p>
                      )}
                      <p className="text-sm text-foreground/85 leading-snug whitespace-pre-wrap">{n.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI Insights */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">Insights da IA</h3>
              </div>
              {detailLoading ? (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                </div>
              ) : aiInsights && Object.keys(aiInsights).length > 0 ? (
                <div className="pl-10 space-y-4">
                  {aiInsights.summary && (
                    <div className="p-4 rounded-lg bg-medical-blue-light/30 border border-medical-blue/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-medical-blue" />
                        <span className="text-xs font-semibold text-medical-blue uppercase">Resumo</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed">{aiInsights.summary}</p>
                    </div>
                  )}
                  {aiInsights.symptoms?.length ? (
                    <InsightList title="Sintomas" items={aiInsights.symptoms} bullet="•" bulletColor="text-medical-blue" />
                  ) : null}
                  {aiInsights.behavioral_observations?.length ? (
                    <InsightList title="Observações Comportamentais" items={aiInsights.behavioral_observations} bullet="•" bulletColor="text-medical-blue" />
                  ) : null}
                  {aiInsights.risk_factors?.length ? (
                    <InsightList title="Fatores de Risco" items={aiInsights.risk_factors} bullet="⚠️" bulletColor="text-destructive" />
                  ) : null}
                  {aiInsights.family_history?.length ? (
                    <InsightList title="Histórico Familiar" items={aiInsights.family_history} bullet="•" bulletColor="text-medical-blue" />
                  ) : null}
                  {aiInsights.social_factors?.length ? (
                    <InsightList title="Fatores Sociais" items={aiInsights.social_factors} bullet="•" bulletColor="text-medical-blue" />
                  ) : null}
                  {aiInsights.clinical_changes?.length ? (
                    <InsightList title="Mudanças Clínicas" items={aiInsights.clinical_changes} bullet="✓" bulletColor="text-success" />
                  ) : null}
                </div>
              ) : (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">
                    Nenhum insight gerado ainda. Cole notas longas em "Extrair com IA" no painel direito.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          {/* ─── Histórico ───────────────────────────────────────────── */}
          <TabsContent value="history" className="space-y-4">
            <h3 className="font-semibold text-foreground">Histórico de Consultas</h3>
            {consultationsLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-20 rounded-lg bg-secondary/40 animate-pulse" />
                ))}
              </div>
            ) : consultations.length === 0 ? (
              <div className="p-6 text-center rounded-lg border border-border bg-card">
                <p className="text-sm text-muted-foreground">Nenhuma consulta registrada ainda.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
                <div className="space-y-4">
                  {consultations.map((c, idx) => {
                    const isFirst = idx === 0;
                    const isExpanded = expandedId === c.id;
                    return (
                      <div key={c.id} className="relative pl-10">
                        <div className={cn(
                          'absolute left-2 top-1 w-4 h-4 rounded-full border-2 bg-background',
                          isFirst ? 'border-medical-blue bg-medical-blue' : 'border-muted-foreground/30',
                        )}>
                          {isFirst && <span className="absolute inset-0 animate-ping rounded-full bg-medical-blue opacity-50" />}
                        </div>
                        <div className={cn(
                          'p-4 rounded-lg border',
                          isFirst ? 'border-medical-blue/30 bg-medical-blue-light/50' : 'border-border bg-card',
                        )}>
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium text-foreground">{formatDate(c.created_at)}</span>
                              <span className="text-xs text-muted-foreground">{relativeDays(c.created_at)}</span>
                              {isFirst && <Badge className="bg-medical-blue text-primary-foreground text-xs">Última</Badge>}
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
                          {c.chief_complaint && (
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">Queixa:</span> {c.chief_complaint}
                            </p>
                          )}
                          {isExpanded && (
                            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                              {c.soap_note && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Evolução SOAP</h5>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-[11px] gap-1"
                                      onClick={() => printSoap(c.soap_note!, patient, c.chief_complaint ?? undefined)}
                                    >
                                      <Printer className="w-3 h-3" /> Imprimir
                                    </Button>
                                  </div>
                                  <SoapNoteView text={c.soap_note} />
                                </div>
                              )}
                              {c.whatsapp_message && (
                                <div>
                                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
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
                                  <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground select-none">
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

            {/* Arquivos anexados */}
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold text-foreground">Arquivos anexados</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Exames, fotos, receitas externas — anexados manualmente ao paciente.
                </p>
              </div>
              {user?.id ? (
                <PatientFiles patientId={patient.id} userId={user.id} />
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

              {consultationsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-16 rounded-lg bg-secondary/40 animate-pulse" />
                  ))}
                </div>
              ) : consultations.length === 0 ? (
                <div className="p-6 text-center rounded-lg border border-border bg-card">
                  <p className="text-sm text-muted-foreground">Nenhuma consulta registrada ainda.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {consultations.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors">
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
                            onClick={() => printSoap(c.soap_note!, patient, c.chief_complaint ?? undefined)}
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
                              w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Mensagem — ${patient.name}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;line-height:1.6;color:#111827}.msg{white-space:pre-wrap;padding:16px 18px;background:#dcfce7;border-radius:12px}h1{font-size:14pt;color:#15803d;margin-bottom:8px}</style></head><body><h1>Mensagem para ${patient.name}</h1><div class="msg">${c.whatsapp_message!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></body></html>`);
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
      </SheetContent>
    </Sheet>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function Stat({
  icon: Icon, label, value, loading,
}: { icon: React.ElementType; label: string; value: string; loading?: boolean }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-secondary/40 border border-border/40">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
        {loading ? '—' : value}
      </div>
    </div>
  );
}

interface EditableSectionProps {
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

function EditableSection({
  icon, iconBg, title, value, isEditing, draftValue,
  onEdit, onCancel, onSave, onDraftChange, placeholder,
}: EditableSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', iconBg)}>
            {icon}
          </div>
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        {!isEditing && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="pl-10 space-y-2">
          <Textarea
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-[100px] text-sm resize-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="medical" onClick={onSave} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <p className={cn(
          'text-sm leading-relaxed pl-10 whitespace-pre-wrap',
          value ? 'text-muted-foreground' : 'text-muted-foreground/50 italic',
        )}>
          {value || placeholder}
        </p>
      )}
    </section>
  );
}

function InsightList({ title, items, bullet, bulletColor }: {
  title: string; items: string[]; bullet: string; bulletColor: string;
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
