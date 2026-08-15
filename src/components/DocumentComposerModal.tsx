import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pill, FileSignature, ClipboardPlus, Search, X, Loader2, AlertTriangle,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Patient, Medication } from '@/types/patient';

export type RxDocType = 'receita_simples' | 'receita_antimicrobiano' | 'atestado';

interface ComposerMed extends Medication { checked: boolean; fromCatalog?: boolean; antimicrobial?: boolean }

interface CatalogHit {
  id: number;
  product_name: string;
  active_ingredient: string | null;
  therapeutic_class: string | null;
  is_antimicrobial: boolean;
}

interface DocumentComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  onGenerate: (payload: {
    docType: RxDocType;
    medications: Medication[];
    content?: { days: number; cid?: string; note?: string };
  }) => Promise<void>;
  isGenerating: boolean;
}

const TYPE_META: Array<{ value: RxDocType; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'receita_simples',        label: 'Receita simples', hint: 'Validade 30 dias',                    icon: Pill },
  { value: 'receita_antimicrobiano', label: 'Antimicrobiano',  hint: 'Retenção · validade 10 dias',        icon: AlertTriangle },
  { value: 'atestado',               label: 'Atestado médico', hint: 'Afastamento com validação por QR',   icon: ClipboardPlus },
];

export function DocumentComposerModal({
  open, onOpenChange, patient, onGenerate, isGenerating,
}: DocumentComposerModalProps) {
  const [docType, setDocType] = useState<RxDocType>('receita_simples');
  const [meds, setMeds] = useState<ComposerMed[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [days, setDays] = useState('1');
  const [cid, setCid] = useState('');
  const [note, setNote] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to the patient's current medications whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setDocType('receita_simples');
    setMeds((patient.medications ?? []).map(m => ({ ...m, checked: true })));
    setQuery(''); setHits([]);
    setDays('1'); setCid(''); setNote('');
  }, [open, patient.id]);

  // Debounced catalog autocomplete (Anvisa registered medications).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 3) { setHits([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('medication_catalog')
        .select('id, product_name, active_ingredient, therapeutic_class, is_antimicrobial')
        .or(`product_name.ilike.%${q}%,active_ingredient.ilike.%${q}%`)
        .limit(8);
      setHits((data as CatalogHit[]) ?? []);
      setSearching(false);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  const addFromCatalog = (hit: CatalogHit) => {
    const name = hit.product_name
      .toLowerCase()
      .replace(/(^|\s|\+|\()([a-zà-ú])/g, (_, p, c) => p + c.toUpperCase());
    setMeds(prev => [...prev, {
      name,
      dosage: '',
      instructions: '',
      checked: true,
      fromCatalog: true,
      antimicrobial: hit.is_antimicrobial,
    }]);
    setQuery(''); setHits([]);
    // Suggest the right document type when an antimicrobial enters the list.
    if (hit.is_antimicrobial && docType === 'receita_simples') {
      setDocType('receita_antimicrobiano');
    }
  };

  const selectedMeds = useMemo(() => meds.filter(m => m.checked), [meds]);
  const hasAntimicrobial = selectedMeds.some(m => m.antimicrobial);
  const isAtestado = docType === 'atestado';

  const canGenerate = isAtestado
    ? Number(days) > 0
    : selectedMeds.length > 0;

  const handleGenerate = async () => {
    await onGenerate({
      docType,
      medications: selectedMeds.map(({ name, dosage, instructions }) => ({ name, dosage, instructions })),
      content: isAtestado
        ? { days: Number(days) || 1, cid: cid.trim() || undefined, note: note.trim() || undefined }
        : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isGenerating) onOpenChange(v); }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">Documento para {patient.name}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gera o PDF com QR de validação. Assinatura ICP-Brasil será acoplada quando o provedor estiver conectado.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
          {/* Type selector */}
          <div className="grid grid-cols-3 gap-2">
            {TYPE_META.map(({ value, label, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDocType(value)}
                className={cn(
                  'rounded-lg border p-2.5 text-left transition-all',
                  docType === value
                    ? 'border-medical-blue bg-medical-blue-light/40 ring-1 ring-medical-blue/30'
                    : 'border-border/60 bg-white hover:border-medical-blue/40',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5 mb-1', docType === value ? 'text-medical-blue' : 'text-muted-foreground')} />
                <p className="text-[11px] font-semibold text-foreground leading-tight">{label}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>
              </button>
            ))}
          </div>

          {hasAntimicrobial && docType === 'receita_simples' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Há antimicrobiano selecionado — considere o tipo "Antimicrobiano" (retenção, 10 dias).
            </p>
          )}

          {isAtestado ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/80">Dias de afastamento</label>
                  <Input type="number" min={0.5} step={0.5} max={365} value={days} onChange={e => setDays(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/80">CID <span className="text-muted-foreground font-normal">(opcional, a pedido do paciente)</span></label>
                  <Input value={cid} onChange={e => setCid(e.target.value)} placeholder="Ex: J06.9" maxLength={20} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Observação <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: Repouso domiciliar recomendado" maxLength={400} />
              </div>
            </div>
          ) : (
            <>
              {/* Catalog search */}
              <div className="space-y-1 relative">
                <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                  <Search className="w-3 h-3" />
                  Adicionar medicamento (base Anvisa)
                </label>
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Digite 3+ letras — nome comercial ou princípio ativo"
                />
                {(hits.length > 0 || searching) && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-white shadow-lg max-h-56 overflow-y-auto scrollbar-thin">
                    {searching && hits.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />Buscando…
                      </p>
                    ) : hits.map(h => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => addFromCatalog(h)}
                        className="w-full text-left px-3 py-2 hover:bg-medical-blue-light/40 border-b border-border/30 last:border-0"
                      >
                        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          {h.product_name}
                          {h.is_antimicrobial && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ANTIMICROBIANO</span>
                          )}
                        </p>
                        {h.active_ingredient && (
                          <p className="text-[10px] text-muted-foreground">{h.active_ingredient}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Medication list */}
              <div className="space-y-1.5">
                {meds.length === 0 && (
                  <p className="text-xs text-muted-foreground/70 italic py-2">
                    Sem medicamentos no perfil — adicione pela busca acima.
                  </p>
                )}
                {meds.map((m, i) => (
                  <div key={i} className={cn(
                    'rounded-lg border px-3 py-2 space-y-1.5',
                    m.checked ? 'border-border/70 bg-white' : 'border-border/40 bg-muted/20 opacity-60',
                  )}>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={m.checked}
                        onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))}
                        className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-foreground flex-1">{m.name}</span>
                      {m.antimicrobial && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ATM</span>
                      )}
                      {m.fromCatalog && (
                        <button
                          type="button"
                          onClick={() => setMeds(prev => prev.filter((_, j) => j !== i))}
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground/50 hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {m.checked && (
                      <div className="grid grid-cols-[110px_1fr] gap-1.5 pl-5">
                        <Input
                          className="h-7 text-xs"
                          value={m.dosage ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, dosage: e.target.value } : x))}
                          placeholder="Dose"
                        />
                        <Input
                          className="h-7 text-xs"
                          value={m.instructions ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, instructions: e.target.value } : x))}
                          placeholder="Posologia / instruções"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border/50 shrink-0 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancelar
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
            {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />}
            Gerar documento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
