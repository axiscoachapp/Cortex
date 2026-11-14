import { useEffect, useState } from 'react';
import { User, Stethoscope, Pill, AlertTriangle, FolderOpen, Printer, FileText, Sparkles, StickyNote, Pencil } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Patient } from '@/types/patient';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import { ClinicalListEditor, type ClinicalListKind } from './ClinicalListEditor';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { printMedicationList } from '@/lib/printDoc';
import { allergyLabel } from '@/lib/allergyLabel';
import { useClinicAccess } from '@/features/reception/accessContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { hasInsights, useInsightsProposal, type AIInsights } from '@/hooks/useInsightsProposal';
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';

interface PatientSnapshotProps {
  patient: Patient | null;
  /** Optional callback — passed to the dossier drawer's "Perguntar à IA" button. */
  onAskAI?: () => void;
  onWorkStateChange?: (busy: boolean) => void;
}

function formatMedicationDuration(startedAt: string): string {
  const days = Math.floor((Date.now() - new Date(startedAt).getTime()) / 86400000);
  if (days < 1) return 'hoje';
  if (days === 1) return '1 dia';
  if (days < 30) return `${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} ${years === 1 ? 'ano' : 'anos'}` : `${years}a ${rem}m`;
}

function EditListButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-1 min-h-8 px-1 text-[0.6875rem] text-medical-blue hover:text-medical-blue-dark transition-colors font-medium"
    >
      <Pencil className="w-3 h-3" />
      Editar
    </button>
  );
}

function SectionHeader({ icon: Icon, label, action }: {
  icon: React.ElementType;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-widest">
          {label}
        </span>
      </div>
      {action}
    </div>
  );
}

export function PatientSnapshot({ patient, onAskAI, onWorkStateChange }: PatientSnapshotProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingList, setEditingList] = useState<ClinicalListKind | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const { prescriber } = useUserSettings();
  const access = useClinicAccess();
  const draftKey = `${userId ?? ''}/${patient?.id ?? ''}`;
  const notes = drafts[draftKey] ?? '';
  const isProcessing = processing[draftKey] ?? false;
  const { proposal, setProposal } = useInsightsProposal(patient?.id, userId);
  const hasWork = Object.values(drafts).some(value => value.trim()) || Object.values(processing).some(Boolean);
  useEffect(() => { onWorkStateChange?.(hasWork); }, [hasWork, onWorkStateChange]);

  const {
    data: storedClinicalNotes = '',
    isPending: notesPending,
    fetchStatus: notesFetchStatus,
    isError: notesError,
    refetch: retryNotes,
  } = useQuery<string>({
    queryKey: ['patient-clinical-notes', patient?.id, userId],
    queryFn: async () => {
      if (!patient?.id) return '';
      const { data, error } = await supabase
        .from('patients')
        .select('clinical_notes')
        .eq('id', patient.id)
        .single();
      if (error) throw error;
      return data?.clinical_notes ?? '';
    },
    enabled: !!patient?.id && !!userId,
    staleTime: 30_000,
  });
  const notesReady = !!patient?.id && !!userId && !notesPending && !notesError && notesFetchStatus === 'idle';
  const clinicalNotes = notesReady ? storedClinicalNotes : '';

  // Parse "[stamp] body" entries; show newest first.
  const noteEntries: Array<{ stamp: string; body: string }> = (clinicalNotes ?? '')
    .split(/\n(?=\[)/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      return m ? { stamp: m[1], body: m[2].trim() } : { stamp: '', body: line };
    })
    .reverse();

  const handleGeneratePrescription = () => {
    if (!patient) return;
    if (patient.medications.length === 0) {
      toast({ title: 'Nenhuma medicação registrada', description: 'Adicione medicações ao perfil antes de imprimir a lista.', variant: 'destructive' });
      return;
    }
    printMedicationList(patient, {
      name: prescriber.doctorName,
      crm: prescriber.crmNumber,
      crmUf: prescriber.crmUf,
      clinicName: access?.clinic?.name,
    });
  };

  const handleProcessNotes = async () => {
    if (!notes.trim()) { toast({ title: 'Adicione notas antes de processar.', variant: 'destructive' }); return; }
    if (!patient?.id) return;
    const submitted = notes;
    const submittedKey = draftKey;
    setProcessing(prev => ({ ...prev, [submittedKey]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('process-clinical-notes', {
        body: { patientId: patient.id, notes: notes.trim(), userId },
      });
      if (error) {
        const body = await functionErrorBody(error);
        if (body?.quotaExceeded) {
          toast({ title: 'Limite diário atingido', description: typeof body.error === 'string' ? body.error : '', variant: 'destructive' });
          queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
          return;
        }
        throw error;
      }
      // The note is saved; insights only come back as a proposal to review.
      const insights = data?.insights as AIInsights | null | undefined;
      if (hasInsights(insights)) setProposal({ insights, createdAt: new Date().toISOString() });
      toast({ title: 'Anotação salva', description: data?.message || 'A anotação foi salva no prontuário.' });
      setDrafts(prev => prev[submittedKey] === submitted ? { ...prev, [submittedKey]: '' } : prev);
      queryClient.invalidateQueries({ queryKey: ['patient-clinical-notes', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch (err) {
      toast({ title: 'Erro ao processar', description: await functionErrorMessage(err, 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setProcessing(prev => ({ ...prev, [submittedKey]: false }));
    }
  };

  if (!patient) {
    return (
      <aside className="w-full h-full flex items-center justify-center bg-[hsl(215_40%_98%)]">
        <div className="text-center p-8 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
            <User className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Selecione um paciente</p>
        </div>
      </aside>
    );
  }

  const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className="w-full h-full flex flex-col overflow-hidden bg-[hsl(215_40%_98%)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/50 bg-white/60">
        <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Perfil ativo
        </p>
        <div className="flex items-center gap-3">
          {patient.photoUrl ? (
            <img src={patient.photoUrl} alt={patient.name}
              className="w-12 h-12 rounded-xl object-cover ring-1 ring-border/50 shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white text-sm font-bold shadow-sm"
              style={{ background: 'hsl(var(--primary))' }}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm leading-tight truncate">{patient.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {patient.age === null ? 'Idade não informada' : String(patient.age) + ' anos'}{patient.profession ? ` · ${patient.profession}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border/40">

        {/* Diagnoses */}
        <section className="p-4">
          <SectionHeader
            icon={Stethoscope}
            label="Diagnósticos"
            action={<EditListButton label="Editar diagnósticos" onClick={() => setEditingList('diagnoses')} />}
          />
          {patient.diagnoses.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhum diagnóstico registrado</p>
          ) : (
            <div className="space-y-1.5">
              {patient.diagnoses.map((d, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/80 border border-border/40 shadow-[0_1px_3px_hsl(0_0%_0%/0.04)]">
                  {d.code && (
                    <span className="font-mono text-[0.6875rem] text-medical-blue font-semibold shrink-0 mt-px">{d.code}</span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-foreground/75 leading-snug">{d.description}</p>
                    {d.note && <p className="text-[0.6875rem] text-muted-foreground leading-snug mt-0.5">{d.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Medications */}
        <section className="p-4">
          <SectionHeader
            icon={Pill}
            label="Medicações"
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGeneratePrescription}
                  className="flex items-center gap-1 min-h-8 px-1 text-[0.6875rem] text-medical-blue hover:text-medical-blue-dark transition-colors font-medium"
                >
                  <Printer className="w-3 h-3" />
                  Imprimir lista
                </button>
                <EditListButton label="Editar medicações" onClick={() => setEditingList('medications')} />
              </div>
            }
          />
          {patient.medications.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhuma medicação registrada</p>
          ) : (
            <div className="space-y-1.5">
              {patient.medications.map((m, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/80 border border-border/40 shadow-[0_1px_3px_hsl(0_0%_0%/0.04)]">
                  <div className="w-1.5 h-1.5 rounded-full bg-success mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-xs font-medium text-foreground truncate">{m.name}</span>
                      {m.startedAt && (
                        <span className="text-[0.625rem] text-muted-foreground shrink-0">
                          {formatMedicationDuration(m.startedAt)}
                        </span>
                      )}
                    </div>
                    {(m.dosage || m.instructions) && (
                      <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                        {[m.dosage, m.instructions].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {m.note && <p className="text-[0.6875rem] text-muted-foreground/80 italic mt-0.5">{m.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Allergies */}
        <section className="p-4">
          <SectionHeader
            icon={AlertTriangle}
            label="Alertas / Alergias"
            action={<EditListButton label="Editar alergias" onClick={() => setEditingList('allergies')} />}
          />
          {patient.allergies.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/80 border border-border/40">
              <span className="text-xs text-muted-foreground">Nenhuma alergia registrada</span>
            </div>
          ) : (
            <div className="space-y-1">
              {patient.allergies.map((a, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20">
                  <span className="text-[0.625rem]">⚠️</span>
                  <span className="text-xs font-medium text-destructive">{allergyLabel(a)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Saved annotations (written from chat in Comentário mode) */}
        {(noteEntries.length > 0 || !notesReady) && (
          <section className="p-4">
            <SectionHeader
              icon={StickyNote}
              label="Anotações do médico"
              action={
                notesReady ? <span className="text-[0.625rem] text-muted-foreground">{noteEntries.length}</span> : undefined
              }
            />
            {notesError && notesFetchStatus === 'idle' ? (
              <div role="alert" className="text-xs text-destructive space-y-2">
                <p>Não foi possível carregar as anotações salvas.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => retryNotes()}>Tentar novamente</Button>
              </div>
            ) : !notesReady ? (
              <p role="status" className="text-xs text-muted-foreground">
                {notesFetchStatus === 'paused' ? 'Aguardando conexão para carregar as anotações.' : 'Carregando anotações salvas…'}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
                {noteEntries.map((n, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg bg-white/80 border border-border/40">
                    {n.stamp && (
                      <p className="text-[0.625rem] text-muted-foreground font-mono mb-0.5">
                        {n.stamp}
                      </p>
                    )}
                    <p className="text-xs text-foreground/85 leading-snug whitespace-pre-wrap">
                      {n.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Clinical Notes — AI extraction */}
        <section className="p-4">
          <SectionHeader icon={FileText} label="Extrair com IA" />
          <Textarea
            aria-label={`Anotações para ${patient.name}`}
            placeholder="Cole observações longas — a IA estrutura em sintomas, fatores de risco, histórico familiar…"
            value={notes}
            onChange={(e) => setDrafts(prev => ({ ...prev, [draftKey]: e.target.value }))}
            className="min-h-[100px] text-xs resize-none bg-white/80 border-border/40 focus:ring-medical-blue/20"
            disabled={isProcessing}
          />
          <Button
            onClick={handleProcessNotes}
            disabled={isProcessing || !notes.trim()}
            size="sm"
            className="w-full mt-2 gap-2 h-8 text-xs"
            variant="medical"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isProcessing ? 'Processando...' : 'Processar com IA'}
          </Button>
          {proposal && (
            <div role="status" className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1.5">
              <p>A IA fez sugestões a partir das anotações. Nada foi gravado no perfil.</p>
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDrawerOpen(true)}>
                Revisar sugestões
              </Button>
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border/50 bg-white/60">
        <button
          onClick={() => setDrawerOpen(true)}
          className={cn(
            'w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-white',
            'border border-transparent hover:border-border/60 transition-all',
          )}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Perfil completo e arquivos
        </button>
      </div>

      {editingList && (
        <ClinicalListEditor
          kind={editingList}
          patient={patient}
          userId={userId}
          open
          onOpenChange={(next) => {
            if (!next) setEditingList(null);
          }}
        />
      )}

      <PatientProfileDrawer
        patient={patient}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onAskAI={onAskAI}
      />
    </aside>
  );
}
