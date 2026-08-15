import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ExternalLink, Ban, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface PrescriptionRow {
  id: string;
  doc_type: 'receita_simples' | 'receita_antimicrobiano' | 'atestado' | 'solicitacao_exames';
  status: 'generated' | 'signed' | 'revoked';
  secret_code: string;
  created_at: string;
  expires_at: string;
}

const TYPE_LABELS: Record<PrescriptionRow['doc_type'], string> = {
  receita_simples: 'Receita simples',
  receita_antimicrobiano: 'Receita — antimicrobiano',
  atestado: 'Atestado médico',
  solicitacao_exames: 'Solicitação de exames',
};

const STATUS_META: Record<PrescriptionRow['status'], { label: string; cls: string }> = {
  generated: { label: 'Sem assinatura', cls: 'bg-amber-100 text-amber-700' },
  signed:    { label: 'Assinada',       cls: 'bg-green-100 text-green-700' },
  revoked:   { label: 'Revogada',       cls: 'bg-red-100 text-red-700' },
};

const FN_BASE = 'https://conhcwuwtrkerpbblzgu.supabase.co/functions/v1/validate-prescription';

export function PrescriptionList({ patientId }: { patientId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<PrescriptionRow[]>({
    queryKey: ['patient-prescriptions', patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescriptions')
        .select('id, doc_type, status, secret_code, created_at, expires_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as PrescriptionRow[]) ?? [];
    },
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const handleRevoke = async (rx: PrescriptionRow) => {
    if (!window.confirm('Revogar este documento? Farmácias não conseguirão mais validá-lo.')) return;
    setBusyId(rx.id);
    try {
      const { error } = await supabase
        .from('prescriptions')
        .update({ status: 'revoked' })
        .eq('id', rx.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['patient-prescriptions', patientId] });
      toast({ title: 'Documento revogado' });
    } catch (err: any) {
      toast({ title: 'Erro ao revogar', description: err?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const copyCode = async (rx: PrescriptionRow) => {
    await navigator.clipboard.writeText(rx.secret_code);
    toast({ title: 'Código copiado', description: rx.secret_code });
  };

  if (isLoading || rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm">
        <FileSignature className="w-4 h-4 text-medical-blue" />
        Receitas & Atestados
        <span className="text-[10px] text-muted-foreground/70 font-normal">{rows.length}</span>
      </h3>
      <div className="space-y-1.5">
        {rows.map(rx => {
          const meta = STATUS_META[rx.status];
          const expired = new Date(rx.expires_at).getTime() < Date.now();
          return (
            <div key={rx.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/60 bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{TYPE_LABELS[rx.doc_type]}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(rx.created_at).toLocaleDateString('pt-BR')} · código {rx.secret_code}
                  {expired && rx.status !== 'revoked' ? ' · expirada' : ''}
                </p>
              </div>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0', meta.cls)}>
                {expired && rx.status === 'generated' ? 'Expirada' : meta.label}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                  title="Copiar código de acesso"
                  onClick={() => copyCode(rx)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                  title="Abrir documento"
                  onClick={() => window.open(`${FN_BASE}?id=${rx.id}&_secretCode=${rx.secret_code}`, '_blank')}
                  disabled={rx.status === 'revoked' || expired}
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600"
                  title="Revogar"
                  onClick={() => handleRevoke(rx)}
                  disabled={rx.status === 'revoked' || busyId === rx.id}
                >
                  {busyId === rx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
