import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ExternalLink, Ban, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/pagination';

interface PrescriptionRow {
  id: string;
  doc_type: 'receita_simples' | 'receita_antimicrobiano' | 'atestado' | 'solicitacao_exames';
  status: 'generated' | 'signed' | 'revoked';
  secret_code: string;
  created_at: string;
  expires_at: string;
  signature_verified_at?: string | null;
  issuance_verified_at?: string | null;
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

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL ?? 'https://conhcwuwtrkerpbblzgu.supabase.co'}/functions/v1/validate-prescription`;

export function PrescriptionList({ patientId }: { patientId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const { user } = useAuth();

  const { data: rows = [], isLoading, isError, refetch } = useQuery<PrescriptionRow[]>({
    queryKey: ['patient-prescriptions', patientId, user?.id],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase
        .from('prescriptions')
        .select('*')
        .eq('patient_id', patientId)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to));
      return (data as PrescriptionRow[]) ?? [];
    },
    enabled: !!patientId && !!user,
    staleTime: 30_000,
  });

  const handleRevoke = async (rx: PrescriptionRow) => {
    if (!window.confirm('Revogar este documento? Farmácias não conseguirão mais validá-lo.')) return;
    setBusyId(rx.id);
    try {
      const { error } = await supabase.rpc('revoke_prescription', { p_id: rx.id });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['patient-prescriptions', patientId] });
      toast({ title: 'Documento revogado' });
    } catch (err) {
      toast({ title: 'Erro ao revogar', description: err instanceof Error ? err.message : 'Tente novamente.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const copyCode = async (rx: PrescriptionRow) => {
    try {
      await navigator.clipboard.writeText(rx.secret_code);
      toast({ title: 'Código copiado', description: rx.secret_code });
    } catch { toast({ title:'Não foi possível copiar o código', variant:'destructive' }); }
  };

  if (isLoading) return <p role="status" className="text-xs text-muted-foreground">Carregando receitas…</p>;
  if (isError) return <p role="alert" className="text-xs text-destructive">Não foi possível carregar as receitas. <button className="underline" onClick={() => refetch()}>Tentar novamente</button></p>;
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm">
        <FileSignature className="w-4 h-4 text-medical-blue" />
        Receitas & Atestados
        <span className="text-[10px] text-muted-foreground/70 font-normal">{rows.length}</span>
      </h3>
      <div className="space-y-1.5">
        {rows.slice(0, visibleCount).map(rx => {
          const trusted = !!rx.issuance_verified_at;
          const meta = rx.status === 'revoked' ? STATUS_META.revoked : !trusted
            ? { label: 'Reemitir documento', cls:'bg-amber-100 text-amber-700' }
            : rx.status === 'signed' && !rx.signature_verified_at
              ? {label:'Assinatura não verificada',cls:'bg-amber-100 text-amber-700'} : STATUS_META[rx.status];
          const expired = new Date(rx.expires_at).getTime() < Date.now();
          return (
            <div key={rx.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/60 bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{TYPE_LABELS[rx.doc_type]}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(rx.created_at).toLocaleDateString('pt-BR')} · código {rx.secret_code}
                  {expired && rx.status !== 'revoked' ? ' · expirada' : ''}
                </p>
                {!trusted && rx.status !== 'revoked' && <p className="text-[10px] text-amber-800">Emissão anterior não verificada. Reemita para permitir a validação pública.</p>}
              </div>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0', meta.cls)}>
                {trusted && expired && rx.status !== 'revoked' ? 'Expirada' : meta.label}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                  title="Copiar código de acesso"
                  aria-label="Copiar código de acesso"
                  onClick={() => copyCode(rx)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                  title="Abrir documento"
                  aria-label="Abrir documento"
                  onClick={() => window.open(`${FN_BASE}?id=${encodeURIComponent(rx.id)}&_secretCode=${encodeURIComponent(rx.secret_code)}`, '_blank', 'noopener,noreferrer')}
                  disabled={!trusted || rx.status === 'revoked' || expired}
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600"
                  title="Revogar"
                  aria-label="Revogar documento"
                  onClick={() => handleRevoke(rx)}
                  disabled={rx.status === 'revoked' || busyId === rx.id}
                >
                  {busyId === rx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          );
        })}
        {visibleCount < rows.length && <Button variant="outline" onClick={() => setVisibleCount(value=>value+20)}>Mostrar mais receitas ({rows.length-visibleCount})</Button>}
      </div>
    </section>
  );
}
