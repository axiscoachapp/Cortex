import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, Loader2, X, Users,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ImportPatientsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

/** Target fields we import into `patients`. */
type Target = 'name' | 'age' | 'birthdate' | 'phone' | 'email' | 'profession' | 'skip';

const SOURCES = [
  { id: 'iclinic',       name: 'iClinic',          hint: 'Exportação de pacientes em CSV' },
  { id: 'consultorio',   name: 'Consultorio.live',  hint: 'Exportação de pacientes em CSV' },
  { id: 'amigo',         name: 'Amigo',            hint: 'Exportação de pacientes em CSV' },
  { id: 'memed',         name: 'Memed',            hint: 'Exportação de pacientes em CSV' },
  { id: 'generico',      name: 'Outro / Genérico', hint: 'Qualquer planilha com colunas' },
];

const TARGET_LABELS: Record<Target, string> = {
  name: 'Nome', age: 'Idade', birthdate: 'Data de nascimento',
  phone: 'Telefone', email: 'E-mail', profession: 'Profissão', skip: 'Ignorar coluna',
};

// Header auto-detection: normalized header substring → target.
const AUTO_MAP: Array<{ match: RegExp; target: Target }> = [
  { match: /nome|paciente|patient/i, target: 'name' },
  { match: /nascimento|birth|dt.?nasc|data.?nasc/i, target: 'birthdate' },
  { match: /idade|age/i, target: 'age' },
  { match: /telefone|celular|phone|whats|contato|fone/i, target: 'phone' },
  { match: /e-?mail/i, target: 'email' },
  { match: /profiss|ocupa|profession/i, target: 'profession' },
];

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  // Detect delimiter: comma or semicolon (BR exports often use ;).
  const firstLine = text.slice(0, 2000).split(/\r?\n/)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let cur = ''; let field = ''; let inQ = false; const line: string[] = [];
  const pushField = () => { line.push(field); field = ''; };
  const pushLine = () => { pushField(); rows.push([...line]); line.length = 0; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) pushField();
    else if (c === '\n') { pushLine(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
    cur = c;
  }
  if (field.length > 0 || line.length > 0) pushLine();
  const nonEmpty = rows.filter(r => r.some(cell => cell.trim().length > 0));
  const headers = (nonEmpty.shift() ?? []).map(h => h.trim());
  return { headers, rows: nonEmpty };
}

function ageFromBirthdate(v: string): number | null {
  const s = v.trim();
  // Accept dd/mm/yyyy, yyyy-mm-dd.
  let d: Date | null = null;
  const br = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const yr = br[3].length === 2 ? 1900 + Number(br[3]) : Number(br[3]);
    d = new Date(yr, Number(br[2]) - 1, Number(br[1]));
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
  return age >= 0 && age < 130 ? age : null;
}

export function ImportPatientsModal({ open, onOpenChange, userId }: ImportPatientsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'source' | 'map' | 'done'>('source');
  const [source, setSource] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);

  const reset = () => {
    setStep('source'); setSource(''); setHeaders([]); setRows([]);
    setMapping([]); setImporting(false); setResult(null);
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { headers: h, rows: r } = parseCSV(text);
    if (h.length === 0 || r.length === 0) {
      toast({ title: 'Arquivo vazio ou inválido', description: 'Verifique se é um CSV com cabeçalho.', variant: 'destructive' });
      return;
    }
    setHeaders(h);
    setRows(r);
    // Auto-map headers.
    setMapping(h.map(header => {
      const hit = AUTO_MAP.find(a => a.match.test(header));
      return hit?.target ?? 'skip';
    }));
    setStep('map');
  };

  const nameCol = useMemo(() => mapping.findIndex(m => m === 'name'), [mapping]);
  const canImport = nameCol >= 0;

  const handleImport = async () => {
    setImporting(true);
    const today = new Date().toISOString().slice(0, 10);
    const records = rows.map(row => {
      const rec: any = { user_id: userId, last_visit: today, status: 'novo' };
      let ageFromBd: number | null = null;
      mapping.forEach((t, i) => {
        const val = (row[i] ?? '').trim();
        if (!val) return;
        if (t === 'name') rec.name = val.slice(0, 120);
        else if (t === 'age') { const n = parseInt(val); if (n > 0 && n < 130) rec.age = n; }
        else if (t === 'birthdate') ageFromBd = ageFromBirthdate(val);
        else if (t === 'phone') rec.phone = val.slice(0, 40);
        else if (t === 'email') rec.email = val.slice(0, 120);
        else if (t === 'profession') rec.profession = val.slice(0, 80);
      });
      if (rec.age == null && ageFromBd != null) rec.age = ageFromBd;
      if (rec.age == null) rec.age = 0;
      return rec;
    }).filter(r => r.name);

    let ok = 0, failed = 0;
    const BATCH = 200;
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      const { error } = await supabase.from('patients').insert(chunk);
      if (error) failed += chunk.length; else ok += chunk.length;
    }
    setImporting(false);
    setResult({ ok, failed });
    setStep('done');
    queryClient.invalidateQueries({ queryKey: ['patients', userId] });
    if (ok > 0) toast({ title: `${ok} paciente${ok > 1 ? 's importados' : ' importado'}` });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!importing) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-medical-blue" />
            Importar pacientes
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {step === 'source' ? 'Selecione o prontuário de origem'
              : step === 'map' ? 'Confira o mapeamento das colunas'
              : 'Importação concluída'}
          </p>
        </DialogHeader>

        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }} />

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {step === 'source' && (
            <div className="space-y-2">
              {SOURCES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSource(s.id); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 bg-white hover:border-medical-blue/40 hover:bg-medical-blue-light/20 transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-4 h-4 text-medical-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.hint}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/50" />
                </button>
              ))}
            </div>
          )}

          {step === 'map' && (
            <div className="space-y-4">
              <div className="rounded-lg bg-medical-blue-light/30 border border-medical-blue/20 px-3 py-2 text-xs text-medical-blue">
                {rows.length} linha{rows.length > 1 ? 's' : ''} detectada{rows.length > 1 ? 's' : ''}. Cada coluna abaixo será importada para o campo escolhido.
              </div>
              <div className="space-y-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate" title={h}>{h || `Coluna ${i + 1}`}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {rows.slice(0, 2).map(r => r[i]).filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    <Select value={mapping[i]} onValueChange={(v) => setMapping(m => m.map((x, j) => j === i ? v as Target : x))}>
                      <SelectTrigger className="w-40 h-9 text-xs shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TARGET_LABELS) as Target[]).map(t => (
                          <SelectItem key={t} value={t}>{TARGET_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {!canImport && (
                <p className="text-[11px] text-red-600 flex items-center gap-1.5">
                  <X className="w-3 h-3" /> Selecione qual coluna é o <strong>Nome</strong> do paciente.
                </p>
              )}
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-6 space-y-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm font-semibold text-foreground">{result.ok} paciente{result.ok !== 1 ? 's' : ''} importado{result.ok !== 1 ? 's' : ''}</p>
              {result.failed > 0 && <p className="text-xs text-red-600">{result.failed} não puderam ser importados</p>}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border/50 shrink-0 flex justify-between gap-2">
          {step === 'map' ? (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStep('source')} disabled={importing}>
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar
              </Button>
              <Button size="sm" className="gap-1.5" onClick={handleImport} disabled={!canImport || importing}>
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Importar {rows.length}
              </Button>
            </>
          ) : step === 'done' ? (
            <Button size="sm" className="ml-auto" onClick={() => { onOpenChange(false); reset(); }}>Concluir</Button>
          ) : (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => onOpenChange(false)}>Cancelar</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
