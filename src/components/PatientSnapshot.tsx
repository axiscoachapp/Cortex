import { useState } from 'react';
import { User, Stethoscope, Pill, AlertTriangle, FolderOpen, Printer, FileText, Sparkles, StickyNote } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Patient } from '@/types/patient';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PatientSnapshotProps {
  patient: Patient | null;
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

function SectionHeader({ icon: Icon, label, action }: {
  icon: React.ElementType;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/70" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          {label}
        </span>
      </div>
      {action}
    </div>
  );
}

export function PatientSnapshot({ patient }: PatientSnapshotProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clinicalNotes = '' } = useQuery<string>({
    queryKey: ['patient-clinical-notes', patient?.id],
    queryFn: async () => {
      if (!patient?.id) return '';
      const { data } = await supabase
        .from('patients')
        .select('clinical_notes')
        .eq('id', patient.id)
        .single();
      return data?.clinical_notes ?? '';
    },
    enabled: !!patient?.id,
    staleTime: 30_000,
  });

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
      toast({ title: 'Nenhuma medicação registrada', description: 'Adicione medicações ao perfil antes de gerar a receita.', variant: 'destructive' });
      return;
    }

    const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const medsHtml = patient.medications.map((m, i) => `
      <div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid #e5e7eb">
        <div style="font-size:11pt;font-weight:700;color:#111827">${i + 1}. ${m.name} <span style="font-weight:400;color:#6b7280">${m.dosage}</span></div>
        ${m.instructions ? `<div style="margin-top:4px;font-size:10pt;color:#374151">${m.instructions}</div>` : ''}
      </div>`).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Receita — ${patient.name}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#111827;padding:60px;max-width:680px;margin:0 auto}.hdr{text-align:center;border-bottom:2px solid #1d4ed8;padding-bottom:16px;margin-bottom:24px}.hdr h1{font-size:18pt;font-weight:700;color:#1d4ed8}.hdr p{font-size:10pt;color:#6b7280;margin-top:4px}.pbox{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin-bottom:24px;font-size:10pt;color:#374151}.allergy{color:#dc2626;margin-top:4px}.rx{font-size:26pt;font-style:italic;font-weight:700;color:#1d4ed8;margin-bottom:20px}.ftr{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;color:#6b7280}.sig{text-align:center}.sig-line{width:200px;border-top:1px solid #374151;margin:50px auto 4px;font-size:9pt;color:#6b7280}@media print{body{padding:40px}}</style>
</head><body>
<div class="hdr"><h1>RECEITA MÉDICA</h1><p>Gerado pelo Cortex</p></div>
<div class="pbox">
  <div><strong>Paciente:</strong> ${patient.name} &nbsp;·&nbsp; <strong>Idade:</strong> ${patient.age} anos${patient.profession ? ` &nbsp;·&nbsp; ${patient.profession}` : ''}</div>
  ${patient.allergies.length > 0 ? `<div class="allergy">⚠ Alergias: ${patient.allergies.join(', ')}</div>` : ''}
</div>
<div class="rx">℞</div>
${medsHtml}
<div class="ftr"><span>${date}</span><div class="sig"><div class="sig-line">Assinatura do Médico</div></div></div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleProcessNotes = async () => {
    if (!notes.trim()) { toast({ title: 'Adicione notas antes de processar.', variant: 'destructive' }); return; }
    if (!patient?.id) return;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-clinical-notes', {
        body: { patientId: patient.id, notes: notes.trim() },
      });
      if (error) throw error;
      toast({ title: 'Notas processadas!', description: data.message || 'Perfil atualizado com insights da IA.' });
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['patient-clinical-notes', patient.id] });
    } catch (err: any) {
      toast({ title: 'Erro ao processar', description: err.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!patient) {
    return (
      <aside className="w-full h-full flex items-center justify-center bg-[hsl(215_40%_98%)]">
        <div className="text-center p-8 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
            <User className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground/60">Selecione um paciente</p>
        </div>
      </aside>
    );
  }

  const initials = patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className="w-full h-full flex flex-col overflow-hidden bg-[hsl(215_40%_98%)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/50 bg-white/60">
        <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3">
          Perfil Ativo
        </p>
        <div className="flex items-center gap-3">
          {patient.photoUrl ? (
            <img src={patient.photoUrl} alt={patient.name}
              className="w-12 h-12 rounded-xl object-cover ring-1 ring-border/50 shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white text-sm font-bold shadow-sm"
              style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 40%))' }}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm leading-tight truncate">{patient.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {patient.age} anos{patient.profession ? ` · ${patient.profession}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border/40">

        {/* Diagnoses */}
        <section className="p-4">
          <SectionHeader icon={Stethoscope} label="Diagnósticos" />
          {patient.diagnoses.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">Nenhum diagnóstico registrado</p>
          ) : (
            <div className="space-y-1.5">
              {patient.diagnoses.map((d, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/80 border border-border/40 shadow-[0_1px_3px_hsl(0_0%_0%/0.04)]">
                  <span className="font-mono text-[11px] text-medical-blue font-semibold shrink-0 mt-px">{d.code}</span>
                  <span className="text-xs text-foreground/75 leading-snug">{d.description}</span>
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
              <button
                onClick={handleGeneratePrescription}
                className="flex items-center gap-1 text-[10px] text-medical-blue hover:text-medical-blue-dark transition-colors font-medium"
              >
                <Printer className="w-3 h-3" />
                Receita
              </button>
            }
          />
          {patient.medications.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">Nenhuma medicação registrada</p>
          ) : (
            <div className="space-y-1.5">
              {patient.medications.map((m, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/80 border border-border/40 shadow-[0_1px_3px_hsl(0_0%_0%/0.04)]">
                  <div className="w-1.5 h-1.5 rounded-full bg-success mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-xs font-medium text-foreground truncate">{m.name}</span>
                      {m.startedAt && (
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {formatMedicationDuration(m.startedAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{m.dosage}
                      {m.instructions ? ` · ${m.instructions}` : ''}</p>
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
          />
          {patient.allergies.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/80 border border-border/40">
              <span className="text-xs text-muted-foreground/60">Nenhuma alergia registrada</span>
            </div>
          ) : (
            <div className="space-y-1">
              {patient.allergies.map((a, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20">
                  <span className="text-[10px]">⚠️</span>
                  <span className="text-xs font-medium text-destructive">Alergia a {a}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Saved annotations (written from chat in Comentário mode) */}
        {noteEntries.length > 0 && (
          <section className="p-4">
            <SectionHeader
              icon={StickyNote}
              label="Anotações do Médico"
              action={
                <span className="text-[10px] text-muted-foreground/70">{noteEntries.length}</span>
              }
            />
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
              {noteEntries.map((n, i) => (
                <div key={i} className="px-3 py-2 rounded-lg bg-white/80 border border-border/40">
                  {n.stamp && (
                    <p className="text-[10px] text-muted-foreground/70 font-mono mb-0.5">
                      {n.stamp}
                    </p>
                  )}
                  <p className="text-xs text-foreground/85 leading-snug whitespace-pre-wrap">
                    {n.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Clinical Notes — AI extraction */}
        <section className="p-4">
          <SectionHeader icon={FileText} label="Extrair com IA" />
          <Textarea
            placeholder="Cole observações longas — a IA estrutura em sintomas, fatores de risco, histórico familiar…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
          Perfil Completo & Arquivos
        </button>
      </div>

      <PatientProfileDrawer patient={patient} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </aside>
  );
}
