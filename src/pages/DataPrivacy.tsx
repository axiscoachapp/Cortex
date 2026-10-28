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
import { assembleDataExport, writeDataExport } from '@/lib/dataExport';
import { functionErrorBody } from '@/lib/functionErrors';

export default function DataPrivacy() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [exportProgress, setExportProgress] = useState('');
  const [exportError, setExportError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteConfirmed = confirmText.trim().toUpperCase() === 'EXCLUIR';

  const handleExport = async () => {
    if (!user?.id || exporting || deleting) return;
    setExporting(true);
    setExportError('');
    let destination: { write(chunk: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> } | undefined;
    try {
      // Request the destination during the click gesture. File writes commit
      // only after the server confirms the snapshot remained consistent.
      const picker = (window as Window & { showSaveFilePicker?: (options: object) => Promise<{ createWritable(): Promise<NonNullable<typeof destination>> }> }).showSaveFilePicker;
      if (picker) {
        const handle = await picker.call(window, { suggestedName: `cortex-dados-${new Date().toISOString().slice(0, 10)}.json`, types: [{ description: 'Dados Cortex', accept: { 'application/json': ['.json'] } }] });
        destination = await handle.createWritable();
        const count = await writeDataExport(user.id, body => supabase.functions.invoke('export-user-data', { body }), setExportProgress, chunk => destination!.write(chunk));
        await destination.close();
        destination = undefined;
        setExportProgress(`Exportação concluída: ${count} arquivos incluídos com verificação SHA-256.`);
        toast({ title: 'Exportação concluída', description: 'Cópia consistente dos registros e arquivos verificados.' });
        return;
      }
      const exportData = await assembleDataExport(user.id, body => supabase.functions.invoke('export-user-data', { body }), setExportProgress);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cortex-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportProgress(`Exportação concluída: ${exportData.files.length} arquivos incluídos com verificação SHA-256.`);
      toast({ title: 'Exportação concluída', description: 'Cópia consistente dos registros e arquivos verificados.' });
    } catch (error) {
      if (destination) await destination.abort().catch(() => {});
      setExportProgress('');
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setExportError(error instanceof Error ? error.message : 'Não foi possível concluir a exportação. Nenhum arquivo parcial foi baixado. Tente novamente.');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirmed || deleting || exporting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const { data, error } = await supabase.functions.invoke('delete-user-data', {});
      if (error) {
        const body = await functionErrorBody(error);
        throw new Error(typeof body?.error === 'string' ? body.error.slice(0, 300) : 'A exclusão não foi concluída. Tente novamente para terminar a remoção dos dados.');
      }
      if (data?.success !== true) throw new Error('O servidor não confirmou a exclusão completa. Tente novamente.');
      toast({ title: 'Conta excluída', description: 'Conta e arquivos ativos removidos. Logs e backups seguem as políticas de retenção aplicáveis.' });
      await signOut();
      navigate('/auth');
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'A exclusão não foi concluída. Tente novamente para terminar a remoção dos dados.');
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
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
              'Acesso aos dados: exporte uma cópia consistente dos seus registros e arquivos.',
              'Correção: edite pacientes e consultas diretamente no aplicativo.',
              'Exclusão: remove dados ativos elegíveis; prontuários com custódia compartilhada precisam de resolução prévia.',
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
            Baixa um arquivo JSON com seus registros, configurações, modelos e base de conhecimento,
            além dos arquivos anexados, áudios e documentos gerados. Os arquivos ficam em Base64,
            com checksum SHA-256 para verificar a integridade. Credenciais de integração são excluídas.
          </p>
          <p className="text-xs text-muted-foreground">Em navegadores com gravação direta em arquivo, a exportação é escrita em partes e pode superar 100 MB. Nos demais navegadores, o limite é 100 MB. Alterações durante a exportação exigem reinício para preservar a consistência.</p>
          {exportProgress && <p role="status" className="text-sm break-words">{exportProgress}</p>}
          {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exporting || deleting}
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
            Remove sua conta e os registros e arquivos ativos elegíveis. A remoção das cópias externas identificadas é confirmada antes da conclusão. Envios sem confirmação precisam de reconciliação pelo suporte; falhas permanecem disponíveis para nova tentativa. Logs operacionais e backups seguem políticas de retenção próprias.
            Esta ação é <strong>irreversível</strong> — considere exportar seus dados antes de prosseguir.
          </p>

          <AlertDialog open={deleteDialogOpen} onOpenChange={next => { if (!deleting) { setDeleteDialogOpen(next); if (!next) { setConfirmText(''); setDeleteError(''); } } }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting || exporting} className="gap-2">
                {deleting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Excluindo...</>
                  : <><Trash2 className="w-4 h-4" />Excluir minha conta</>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto max-w-[calc(100vw-16px)] sm:max-w-lg">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Confirmar exclusão permanente
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    A exclusão dos dados ativos inclui:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    <li>Pacientes e prontuários elegíveis, após resolução de eventual custódia compartilhada</li>
                    <li>Todas as consultas e transcrições</li>
                    <li>Todos os agendamentos</li>
                    <li>Todos os arquivos enviados</li>
                    <li>Sua conta de acesso ({user?.email})</li>
                  </ul>
                  <p className="font-medium text-destructive">
                    Esta ação não pode ser desfeita.
                  </p>
                </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5">
                <label htmlFor="delete-confirm" className="text-sm text-foreground/80">
                  Digite <strong>EXCLUIR</strong> para confirmar:
                </label>
                <input
                  id="delete-confirm"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="EXCLUIR"
                  autoComplete="off"
                  className="w-full h-10 px-3 rounded-lg text-sm border border-border bg-background focus:outline-none focus:ring-2 focus:ring-destructive/30"
                />
              </div>
              {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting} onClick={() => setConfirmText('')}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={event => { event.preventDefault(); void handleDeleteAccount(); }}
                  disabled={!deleteConfirmed || deleting}
                  className="bg-destructive hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? 'Excluindo…' : 'Sim, excluir tudo'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

      </main>
    </div>
  );
}
