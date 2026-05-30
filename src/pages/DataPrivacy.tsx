import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Trash2, Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function DataPrivacy() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    if (!user?.id) return;
    setExporting(true);
    try {
      const [patientsRes, consultationsRes, appointmentsRes] = await Promise.all([
        supabase.from('patients').select('*').eq('user_id', user.id),
        supabase.from('consultations').select('*').eq('user_id', user.id),
        supabase.from('appointments').select('*').eq('user_id', user.id),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        userId: user.id,
        email: user.email,
        patients:      patientsRes.data      ?? [],
        consultations: consultationsRes.data ?? [],
        appointments:  appointmentsRes.data  ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cortex-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: 'Exportação concluída', description: 'Seus dados foram salvos como arquivo JSON.' });
    } catch {
      toast({ title: 'Erro ao exportar', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-user-data', {});
      if (error) throw error;
      toast({ title: 'Conta excluída', description: 'Todos os seus dados foram removidos permanentemente.' });
      await signOut();
      navigate('/auth');
    } catch (err: any) {
      toast({
        title: 'Erro ao excluir conta',
        description: err.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Shield className="h-5 w-5 text-medical-blue" />
          <h1 className="text-base font-semibold text-foreground">Privacidade & Dados</h1>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl space-y-8">

        <section className="rounded-xl border border-border bg-white p-6 space-y-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4 text-medical-blue" />
            Seus direitos — LGPD
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem o direito de
            acessar, corrigir, exportar e solicitar a exclusão de todos os seus dados pessoais e
            prontuários médicos armazenados no Cortex.
          </p>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-none">
            {[
              'Acesso aos dados: você pode exportar uma cópia completa a qualquer momento.',
              'Correção: edite pacientes e consultas diretamente no aplicativo.',
              'Exclusão: apaga permanentemente todos os dados, incluindo prontuários.',
              'Portabilidade: o arquivo exportado está em formato JSON aberto.',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-medical-blue shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Export */}
        <section className="rounded-xl border border-border bg-white p-6 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4 h-4 text-medical-blue" />
            Exportar meus dados
          </h2>
          <p className="text-sm text-muted-foreground">
            Baixa um arquivo JSON com todos os seus pacientes, consultas e agendamentos.
            O arquivo pode ser aberto em qualquer editor de texto ou planilha.
          </p>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exporting}
            className="gap-2"
          >
            {exporting
              ? <><Loader2 className="w-4 h-4 animate-spin" />Exportando...</>
              : <><Download className="w-4 h-4" />Exportar todos os dados</>}
          </Button>
        </section>

        {/* Delete account */}
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <h2 className="font-semibold text-destructive flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Excluir conta e dados
          </h2>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente todos os seus pacientes, consultas, arquivos e conta de acesso.
            Esta ação é <strong>irreversível</strong> — considere exportar seus dados antes de prosseguir.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting} className="gap-2">
                {deleting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Excluindo...</>
                  : <><Trash2 className="w-4 h-4" />Excluir minha conta</>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Confirmar exclusão permanente
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Isso excluirá <strong>permanentemente</strong>:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    <li>Todos os pacientes e prontuários</li>
                    <li>Todas as consultas e transcrições</li>
                    <li>Todos os agendamentos</li>
                    <li>Todos os arquivos enviados</li>
                    <li>Sua conta de acesso ({user?.email})</li>
                  </ul>
                  <p className="font-medium text-destructive">
                    Esta ação não pode ser desfeita.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Sim, excluir tudo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

      </main>
    </div>
  );
}
