import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, Image as ImageIcon, Download, Trash2, Loader2, Paperclip, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface PatientFilesProps {
  patientId: string;
  userId: string;
}

interface PatientFileRow {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  tag: string | null;
  created_at: string;
}

const BUCKET = 'patient-files';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ACCEPT = 'image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp,.heic';

function humanSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function inferTag(mimeType: string | null, name: string): string {
  if (mimeType?.startsWith('image/')) return 'Imagem';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(name)) return 'PDF';
  return 'Arquivo';
}

export function PatientFiles({ patientId, userId }: PatientFilesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: files = [], isLoading } = useQuery<PatientFileRow[]>({
    queryKey: ['patient-files', patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patient_files')
        .select('id, storage_path, file_name, mime_type, size_bytes, tag, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const uploadFiles = useCallback(async (selected: FileList | File[]) => {
    const arr = Array.from(selected);
    if (arr.length === 0) return;

    setUploading(true);
    let okCount = 0;
    let rejected: string[] = [];

    for (const file of arr) {
      if (file.size > MAX_BYTES) {
        rejected.push(`${file.name} (excede 25 MB)`);
        continue;
      }
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 80);
      const uid = crypto.randomUUID();
      const storagePath = `patients/${userId}/${patientId}/${uid}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || (ext === 'pdf' ? 'application/pdf' : undefined),
          upsert: false,
        });

      if (upErr) {
        rejected.push(`${file.name} (upload falhou)`);
        continue;
      }

      const { error: dbErr } = await supabase.from('patient_files').insert({
        patient_id: patientId,
        user_id: userId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        tag: inferTag(file.type, file.name),
      });

      if (dbErr) {
        // Roll back the storage upload if the row insert failed.
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        rejected.push(`${file.name} (registro falhou)`);
        continue;
      }
      okCount += 1;
    }

    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['patient-files', patientId] });

    if (okCount > 0) {
      toast({ title: `${okCount} arquivo${okCount > 1 ? 's enviados' : ' enviado'}` });
    }
    if (rejected.length > 0) {
      toast({
        title: 'Alguns arquivos não foram enviados',
        description: rejected.slice(0, 3).join(' · '),
        variant: 'destructive',
      });
    }
  }, [patientId, userId, queryClient, toast]);

  const handlePickFiles = () => fileInputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDownload = async (f: PatientFileRow) => {
    setBusyId(f.id);
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(f.storage_path, 60); // 60s is plenty for a click
      if (error || !data?.signedUrl) throw error ?? new Error('Sem URL');
      window.open(data.signedUrl, '_blank');
    } catch (err: any) {
      toast({ title: 'Erro ao abrir', description: err?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (f: PatientFileRow) => {
    if (!window.confirm(`Excluir "${f.file_name}"?`)) return;
    setBusyId(f.id);
    try {
      // Remove storage object first; if it's already gone we still want to clean the row.
      await supabase.storage.from(BUCKET).remove([f.storage_path]).catch(() => {});
      const { error } = await supabase.from('patient_files').delete().eq('id', f.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['patient-files', patientId] });
      toast({ title: 'Arquivo excluído' });
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err?.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const isImage = (mime: string | null) => !!mime && mime.startsWith('image/');

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handlePickFiles}
        className={cn(
          'rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-all',
          dragOver
            ? 'border-medical-blue bg-medical-blue-light/40'
            : 'border-border bg-secondary/30 hover:bg-secondary/50 hover:border-medical-blue/40',
        )}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Enviando...
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-card border border-border mx-auto flex items-center justify-center mb-2">
              <Upload className="w-4 h-4 text-medical-blue" />
            </div>
            <p className="text-sm font-medium text-foreground">Clique ou arraste arquivos aqui</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              PDF, JPG, PNG, WebP, HEIC · até 25 MB cada
            </p>
          </>
        )}
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map(i => (
            <div key={i} className="h-16 rounded-lg bg-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
          <Paperclip className="w-3.5 h-3.5" />
          Nenhum arquivo anexado a este paciente ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {files.map(f => (
            <div
              key={f.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors"
            >
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                isImage(f.mime_type) ? 'bg-medical-blue-light' : 'bg-destructive/10',
              )}>
                {isImage(f.mime_type)
                  ? <ImageIcon className="w-5 h-5 text-medical-blue" />
                  : <FileText className="w-5 h-5 text-destructive" />}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate" title={f.file_name}>
                  {f.file_name}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>{formatDate(f.created_at)}</span>
                  {f.size_bytes !== null && <span>· {humanSize(f.size_bytes)}</span>}
                  {f.tag && <span>· {f.tag}</span>}
                </p>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => handleDownload(f)}
                  disabled={busyId === f.id}
                  title="Abrir / baixar"
                >
                  {busyId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(f)}
                  disabled={busyId === f.id}
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Migration hint (shown only if the user hasn't deployed the migration yet) */}
      <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1.5 pt-1">
        <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
        Requer a migração <code className="font-mono">patient_files</code> aplicada no Supabase.
      </p>
    </div>
  );
}
