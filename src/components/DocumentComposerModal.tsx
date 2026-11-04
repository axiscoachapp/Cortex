import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pill, FileSignature, ClipboardPlus, Search, X, Loader2, AlertTriangle, FlaskConical, ShieldAlert,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { validateCertificateDays } from '../../supabase/functions/_shared/documentLayout';
import { currentPatientAge } from '../../supabase/functions/_shared/patientAge';
import { Patient, Medication } from '@/types/patient';
import { useUserSettings } from '@/hooks/useUserSettings';
import {
  antimicrobialsIn, controlledFindings, controlledSubstancesIn, FORMULA_FORMS, formulaError, formulaSubstances, planControlledPrescription,
  type CompoundedFormula,
} from '../../supabase/functions/_shared/regulatedMedications';
import { PrescriptionTemplatePicker, type ApplyMode } from '@/components/PrescriptionTemplatePicker';
import { CidInput, ExamSearch, examLine } from '@/components/ReferenceSearch';
import type { SnippetItem } from '@/lib/documentSnippets';

/** Sex values that satisfy RDC 471/2021; 'nao_informado' does not. */
const PRINTABLE_SEX = new Set(['feminino', 'masculino', 'intersexo']);

export type RxDocType = 'receita_simples' | 'receita_antimicrobiano' | 'receita_controle_especial' | 'atestado' | 'solicitacao_exames';

/** How the RCE identifies a patient without a CPF in the registration (D8). */
type PatientDocumentKind = 'nao_possui' | 'passaporte' | 'outro';

interface ComposerMed extends Medication {
  /** Compounded formula (manipulado); its components are checked like any drug. */
  formula?: CompoundedFormula;
  checked: boolean;
  fromCatalog?: boolean;
  antimicrobial?: boolean;
  /** Active ingredient(s) from the Anvisa catalog — grounds duplication alerts. */
  ingredient?: string | null;
  /** Receita de Controle Especial only: strength of the controlled substance and
   *  the quantity dispensed (number + unit; the PDF writes it in words too). */
  concentration?: string;
  quantity?: string;
  unit?: string;
}

/** What the RCE adds to each medication sent to generate-prescription. */
export type ComposerMedication = Medication & { concentration?: string; quantity?: number; unit?: string; formula?: CompoundedFormula };

/** Content of a Receita de Controle Especial (stored only in the document). */
export interface ControlledContent {
  patientAddress: string;
  patientDocument?: { kind: PatientDocumentKind; value?: string };
  cid?: string;
  justification?: string;
}

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
    medications: ComposerMedication[];
    content?: { days?: number; cid?: string; note?: string; exams?: string[]; indication?: string } | ControlledContent;
  }) => Promise<void>;
  isGenerating: boolean;
}

// `shown` adds a soft hyphen where a long word may break on a phone; the
// accessible name keeps the plain label.
const TYPE_META: Array<{ value: RxDocType; label: string; shown?: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'receita_simples',        label: 'Receita simples',  hint: 'Validade 30 dias',                  icon: Pill },
  { value: 'receita_antimicrobiano', label: 'Antimicrobiano',   shown: 'Antimicro­biano', hint: 'Retenção · validade 10 dias', icon: AlertTriangle },
  { value: 'receita_controle_especial', label: 'Controle especial', hint: 'Listas C1 e C5 · 2 vias · 30 dias', icon: ShieldAlert },
  { value: 'atestado',               label: 'Atestado médico',  hint: 'Afastamento com validação por QR', icon: ClipboardPlus },
  { value: 'solicitacao_exames',     label: 'Solicitação de exames', hint: 'Lista de exames com QR',      icon: FlaskConical },
];

/** Tokens of an Anvisa ingredient string ("losartana potássica, hidroclorotiazida"). */
function ingredientTokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length >= 4);
}

/** Drug name without dose/form, safe to use as a quoted PostgREST filter value. */
function catalogTerm(name: string): string {
  return name
    .replace(/\s\d.*$/, '')
    .replace(/["\\%_(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function DocumentComposerModal({
  open, onOpenChange, patient, onGenerate, isGenerating,
}: DocumentComposerModalProps) {
  const [docType, setDocType] = useState<RxDocType>('receita_simples');
  const [meds, setMeds] = useState<ComposerMed[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [days, setDays] = useState('1');
  const [cid, setCid] = useState('');
  const [note, setNote] = useState('');
  const [examsText, setExamsText] = useState('');
  const [indication, setIndication] = useState('');
  // Receita de Controle Especial (D8). The address stays in this document only.
  const [patientAddress, setPatientAddress] = useState('');
  // No default: "não possui" is printed only when the doctor picks it.
  const [documentKind, setDocumentKind] = useState<PatientDocumentKind | ''>('');
  const [documentValue, setDocumentValue] = useState('');
  const [rceCid, setRceCid] = useState('');
  const [justification, setJustification] = useState('');
  // Compounded formula editor (null = closed).
  const emptyFormula = { name: '', components: [{ substance: '', amount: '' }], vehicle: '', form: '', quantity: '' };
  const [formulaDraft, setFormulaDraft] = useState<typeof emptyFormula | null>(null);
  const [formulaProblem, setFormulaProblem] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMedications = useRef(patient.medications);
  const initialMedicationSelection = useRef<ComposerMed[]>([]);
  useEffect(() => { latestMedications.current = patient.medications; }, [patient.medications]);

  // Reset to the patient's current medications whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setDocType('receita_simples');
    initialMedicationSelection.current = (latestMedications.current ?? []).map(m => ({ ...m, checked: true }));
    setMeds(initialMedicationSelection.current);
    setQuery(''); setHits([]);
    setDays('1'); setCid(''); setNote('');
    setExamsText(''); setIndication('');
    setPatientAddress(''); setDocumentKind(''); setDocumentValue('');
    setRceCid(''); setJustification('');
    setFormulaDraft(null); setFormulaProblem('');
  }, [open, patient.id]);

  // Ground profile meds in the catalog (best-effort name match) so the
  // duplication alert can compare active ingredients.
  useEffect(() => {
    if (!open) return;
    const unresolved = (latestMedications.current ?? [])
      .map((m, i) => ({ name: m.name, i }))
      .filter(x => x.name && x.name.trim().length >= 4);
    if (unresolved.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const { name, i } of unresolved.slice(0, 10)) {
        // Match the whole drug name (dose/units stripped), not just its first
        // word: "Ácido fólico" must not ground to another "ácido ..." product.
        const term = catalogTerm(name);
        if (term.length < 4) continue;
        const { data } = await supabase
          .from('medication_catalog')
          .select('active_ingredient, is_antimicrobial')
          .or(`product_name.ilike."${term}%",active_ingredient.ilike."${term}%"`)
          .limit(1);
        if (cancelled) return;
        const hit = data?.[0];
        if (hit) {
          setMeds(prev => prev.map((m, j) => j === i && m.ingredient === undefined
            ? { ...m, ingredient: hit.active_ingredient, antimicrobial: hit.is_antimicrobial || m.antimicrobial }
            : m));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, patient.id]);

  // Debounced catalog autocomplete (Anvisa registered medications).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    let cancelled = false;
    const q = query.trim();
    if (q.length < 3) { setHits([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      // Quoted values: commas and parentheses no longer break the filter.
      const safe = q.replace(/["\\%_]/g, '');
      const { data, error } = await supabase
        .from('medication_catalog')
        .select('id, product_name, active_ingredient, therapeutic_class, is_antimicrobial')
        .or(`product_name.ilike."%${safe}%",active_ingredient.ilike."%${safe}%"`)
        .limit(8);
      if (cancelled) return;
      setCatalogError(!!error);
      setHits((data as CatalogHit[]) ?? []);
      setSearching(false);
    }, 300);
    return () => { cancelled = true; if (searchTimer.current) clearTimeout(searchTimer.current); };
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
      ingredient: hit.active_ingredient,
    }]);
    setQuery(''); setHits([]);
    // Suggest the right document type when an antimicrobial enters the list.
    if (hit.is_antimicrobial && docType === 'receita_simples') {
      setDocType('receita_antimicrobiano');
    }
  };

  // The template's items arrive checked. 'replace' (confirmed in the picker when
  // something was selected) unchecks the current ones but keeps them in the
  // list with their doses; 'add' keeps them selected. Nothing is deduplicated.
  const applySnippet = (items: SnippetItem[], mode: ApplyMode) => {
    const added = items.map(item => ({
      name: item.name,
      dosage: item.dosage,
      instructions: item.instructions,
      checked: true,
      ...(item.formula ? { formula: item.formula, fromCatalog: true } : {}),
      antimicrobial: [item.name, ...formulaSubstances(item.formula)].some(n => antimicrobialsIn(n).length > 0),
    }));
    setMeds(prev => [...(mode === 'replace' ? prev.map(m => ({ ...m, checked: false })) : prev), ...added]);
    if (added.some(m => m.antimicrobial) && docType === 'receita_simples') setDocType('receita_antimicrobiano');
  };

  // Same rule as the server (formulaError); nothing is cut.
  const addFormula = () => {
    if (!formulaDraft) return;
    const formula: CompoundedFormula = {
      components: formulaDraft.components
        .map(c => ({ substance: c.substance.trim(), amount: c.amount.trim() }))
        .filter(c => c.substance || c.amount),
      ...(formulaDraft.vehicle.trim() ? { vehicle: formulaDraft.vehicle.trim() } : {}),
      form: formulaDraft.form.trim(),
      quantity: formulaDraft.quantity.trim(),
    };
    const problem = formulaError(formula);
    if (problem) { setFormulaProblem(problem); return; }
    setMeds(prev => [...prev, {
      name: formulaDraft.name.trim() || 'Fórmula manipulada',
      dosage: '',
      instructions: '',
      checked: true,
      fromCatalog: true, // removable from the list like a catalog item
      formula,
    }]);
    setFormulaDraft(null);
    setFormulaProblem('');
  };

  const selectedMeds = useMemo(() => meds.filter(m => m.checked), [meds]);
  // Same substance lists as generate-prescription (brands and spellings
  // included), plus the catalog's ingredient when the item came from it. The
  // server stays authoritative; these only warn before the round trip.
  const regulatedNames = (m: ComposerMed) => [m.name, m.ingredient ?? '', ...formulaSubstances(m.formula)].filter(Boolean);
  const hasAntimicrobial = selectedMeds.some(m => m.antimicrobial || regulatedNames(m).some(n => antimicrobialsIn(n).length > 0));
  const controlledSelected = [...new Set(selectedMeds.flatMap(m => regulatedNames(m).flatMap(controlledSubstancesIn)))];
  const isAtestado = docType === 'atestado';
  const isExames = docType === 'solicitacao_exames';
  const isReceita = !isAtestado && !isExames;
  const isControlled = docType === 'receita_controle_especial';
  // Forms the controlled items need: when all of them fit the RCE, the doctor
  // can switch to it; otherwise the warning names the notification.
  const controlledForms = [...new Set(selectedMeds.flatMap(m => regulatedNames(m).flatMap(controlledFindings)).map(f => f.form))];
  const fitsControlled = controlledForms.length > 0 && controlledForms.every(f => f === 'receita_controle_especial');

  // RDC 471/2021: the server refuses an antimicrobial prescription without the
  // prescriber phone or the patient's age and sex. Say so before generating.
  const { prescriber, isLoading: settingsLoading } = useUserSettings();
  const patientCpf = (patient.cpf ?? '').replace(/\D/g, '');
  const hasPatientCpf = patientCpf.length === 11;

  const controlledMedications = (): ComposerMedication[] => selectedMeds.map(({ name, dosage, instructions, concentration, quantity, unit, formula }) => ({
    name, dosage, instructions,
    ...(formula ? { formula } : {}),
    concentration: (concentration ?? '').trim(),
    quantity: Number((quantity ?? '').trim()),
    unit: (unit ?? '').trim(),
  }));
  const controlledContent = (): ControlledContent => ({
    patientAddress: patientAddress.trim(),
    ...(hasPatientCpf || !documentKind ? {} : { patientDocument: { kind: documentKind, ...(documentKind === 'nao_possui' ? {} : { value: documentValue.trim() }) } }),
    ...(rceCid.trim() ? { cid: rceCid.trim() } : {}),
    ...(justification.trim() ? { justification: justification.trim() } : {}),
  });
  // Same rules as the server (shared module), run before the round trip. The
  // server stays authoritative: it also reads brands in the Anvisa catalog.
  const controlledCheck = !isControlled || selectedMeds.length === 0 ? null : planControlledPrescription(
    controlledMedications().map((m, i) => ({ ...m, ingredients: selectedMeds[i].ingredient ? [selectedMeds[i].ingredient.toLowerCase()] : [] })),
    controlledContent(),
    { patientCpf: hasPatientCpf ? patientCpf : null, prescriberCpf: (prescriber.prescriberCpf ?? '').trim() || null, prescriberPhone: (prescriber.professionalPhone ?? '').trim() },
  );
  const controlledError = controlledCheck && 'error' in controlledCheck ? controlledCheck.error : null;
  const antimicrobialGaps = docType !== 'receita_antimicrobiano' ? [] : [
    ...(!settingsLoading && !prescriber.professionalPhone.trim() ? ['seu telefone profissional (Configurações)'] : []),
    ...(currentPatientAge(patient) === null ? ['a idade ou data de nascimento do paciente'] : []),
    ...(PRINTABLE_SEX.has(patient.sex ?? '') ? [] : ['o sexo do paciente']),
  ];

  // Grounded duplication alert: the same active ingredient (per the Anvisa
  // catalog) appearing in two or more selected medications.
  const duplicatedIngredients = useMemo(() => {
    const byToken = new Map<string, number>();
    for (const m of selectedMeds) {
      for (const t of new Set(ingredientTokens(m.ingredient))) {
        byToken.set(t, (byToken.get(t) ?? 0) + 1);
      }
    }
    return [...byToken.entries()].filter(([, n]) => n >= 2).map(([t]) => t);
  }, [selectedMeds]);

  const examList = useMemo(
    () => examsText.split(/\r?\n/).map(e => e.trim()).filter(Boolean),
    [examsText],
  );

  let validDays = false;
  try { validateCertificateDays(days.trim() ? Number(days) : NaN); validDays = true; } catch { /* retain invalid input for correction */ }
  const canGenerate = isAtestado
    ? validDays
    : isExames
    ? examList.length > 0 && examList.length <= 20
    : isControlled
    ? selectedMeds.length > 0 && selectedMeds.length <= 3
    : selectedMeds.length > 0 && selectedMeds.length <= 15;

  const handleGenerate = async () => {
    if (!canGenerate || isGenerating) return;
    await onGenerate({
      docType,
      medications: isControlled
        ? controlledMedications()
        : isReceita
        ? selectedMeds.map(({ name, dosage, instructions, formula }) => ({ name, dosage, instructions, ...(formula ? { formula } : {}) }))
        : [],
      content: isAtestado
        ? { days: validateCertificateDays(Number(days)), cid: cid.trim() || undefined, note: note.trim() || undefined }
        : isExames
        ? { exams: examList, indication: indication.trim() || undefined }
        : isControlled
        ? controlledContent()
        : undefined,
    });
  };

  const selection = (values: ComposerMed[]) => values.map(({ name, dosage, instructions, checked, concentration, quantity, unit, formula }) => ({ name, dosage, instructions, checked, concentration, quantity, unit, formula }));
  const dirty = docType !== 'receita_simples' || !!query.trim() || days !== '1' || !!cid.trim() || !!note.trim() || !!examsText.trim() || !!indication.trim()
    || !!patientAddress.trim() || !!documentKind || !!documentValue.trim() || !!rceCid.trim() || !!justification.trim()
    || JSON.stringify(selection(meds)) !== JSON.stringify(selection(initialMedicationSelection.current));
  const canClose = useUnsavedChanges(open && dirty);
  const changeOpen = (next: boolean) => {
    if (isGenerating || !canClose(next)) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">Documento para {patient.name}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            Gera o PDF com QR de validação. Assinatura ICP-Brasil será acoplada quando o provedor estiver conectado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {/* R3: while a document is being generated the form is read-only, so the
              screen cannot drift from the payload already sent. */}
          <fieldset disabled={isGenerating} aria-busy={isGenerating} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {/* Type selector */}
          <div className="grid grid-cols-2 gap-2">
            {TYPE_META.map(({ value, label, shown, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDocType(value)}
                aria-pressed={docType === value}
                aria-label={`${label}. ${hint}`}
                className={cn(
                  // min-w-0 + soft hyphen: "Antimicro-biano" breaks inside a 375px card instead of spilling out.
                  'min-w-0 rounded-lg border p-2.5 text-left transition-all hyphens-manual [overflow-wrap:anywhere]',
                  docType === value
                    ? 'border-medical-blue bg-medical-blue-light/40 ring-1 ring-medical-blue/30'
                    : 'border-border/60 bg-white hover:border-medical-blue/40',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5 mb-1', docType === value ? 'text-medical-blue' : 'text-muted-foreground')} />
                <p className="text-[0.6875rem] font-semibold text-foreground leading-tight">{shown ?? label}</p>
                <p className="text-[0.5625rem] text-muted-foreground mt-0.5 leading-tight">{hint}</p>
              </button>
            ))}
          </div>

          {isControlled && selectedMeds.length > 3 && (
            <p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">
              A receita de controle especial aceita no máximo 3 medicamentos (Portaria 344/98, art. 57). Desmarque os demais ou divida em mais de uma receita.
            </p>
          )}

          {(isReceita && !isControlled && selectedMeds.length > 15 || isExames && examList.length > 20) && (
            <p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">
              Divida a seleção em documentos de até 15 medicamentos ou 20 exames. Nenhum item será omitido.
            </p>
          )}

          {isReceita && !isControlled && controlledSelected.length > 0 && (
            <div role="alert" className="text-[0.6875rem] text-red-800 bg-red-50 border border-red-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p>
                  Medicamento sujeito a controle especial ({controlledSelected.join(', ')}). Ele não pode sair neste receituário
                  {fitsControlled
                    ? ': use o tipo "Controle especial".'
                    : ': ao menos um exige notificação de receita em talão numerado, que o Cortex não emite (Portaria 344/98).'}
                </p>
                {fitsControlled && (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDocType('receita_controle_especial')}>
                    Usar controle especial
                  </Button>
                )}
              </div>
            </div>
          )}

          {isControlled && controlledError && selectedMeds.length <= 3 && (
            <p aria-live="polite" className="text-[0.6875rem] text-amber-800 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Antes de gerar: {controlledError}</span>
            </p>
          )}

          {isReceita && hasAntimicrobial && docType === 'receita_simples' && (
            <p className="text-[0.6875rem] text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Há antimicrobiano selecionado — considere o tipo "Antimicrobiano" (retenção, 10 dias).
            </p>
          )}

          {antimicrobialGaps.length > 0 && (
            <p role="alert" className="text-[0.6875rem] text-amber-800 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                A receita de antimicrobiano exige{' '}
                {antimicrobialGaps.length > 1
                  ? `${antimicrobialGaps.slice(0, -1).join(', ')} e ${antimicrobialGaps[antimicrobialGaps.length - 1]}`
                  : antimicrobialGaps[0]}
                . Complete antes de gerar (RDC 471/2021).
              </span>
            </p>
          )}

          {isReceita && duplicatedIngredients.length > 0 && (
            <p className="text-[0.6875rem] text-red-700 bg-red-50 border border-red-200/60 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <b>Princípio ativo duplicado</b> em mais de um medicamento selecionado:{' '}
                {duplicatedIngredients.join(', ')} (base Anvisa). Verifique antes de gerar.
              </span>
            </p>
          )}

          {isExames ? (
            <div className="space-y-3">
              <ExamSearch disabled={isGenerating} onPick={hit => setExamsText(prev => {
                const line = examLine(hit);
                const lines = prev.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                return lines.includes(line) ? prev : [...lines, line].join('\n');
              })} />
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Exames solicitados <span className="text-muted-foreground font-normal">(um por linha)</span></label>
                <Textarea
                  aria-label="Exames solicitados, um por linha"
                  value={examsText}
                  onChange={e => setExamsText(e.target.value)}
                  placeholder={'Hemograma completo\nGlicemia de jejum\nTSH'}
                  className="min-h-[120px] text-sm"
                />
                {examList.length > 0 && (
                  <p className="text-[0.625rem] text-muted-foreground">{examList.length} exame{examList.length > 1 ? 's' : ''}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Indicação clínica <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input aria-label="Indicação clínica" value={indication} onChange={e => setIndication(e.target.value)} placeholder="Ex: investigação de fadiga" maxLength={300} />
              </div>
            </div>
          ) : isAtestado ? (
            <div className="space-y-3">
              {!validDays && <p role="alert" className="text-xs text-destructive">Informe de 0,5 a 365 dias, em intervalos de meio dia.</p>}
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/80">Dias de afastamento</label>
                  <Input aria-label="Dias de afastamento" type="number" min={0.5} step={0.5} max={365} value={days} onChange={e => setDays(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/80">CID <span className="text-muted-foreground font-normal">(opcional, a pedido do paciente)</span></label>
                  <CidInput ariaLabel="CID, opcional a pedido do paciente" value={cid} onChange={setCid} placeholder="Ex: J06.9" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Observação <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input aria-label="Observação do atestado" value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: Repouso domiciliar recomendado" maxLength={400} />
              </div>
            </div>
          ) : (
            <>
              <PrescriptionTemplatePicker
                selected={selectedMeds}
                onApply={applySnippet}
                disabled={isGenerating}
              />

              {/* Catalog search */}
              <div className="space-y-1 relative">
                <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                  <Search className="w-3 h-3" />
                  Adicionar medicamento (base Anvisa)
                </label>
                <Input
                  aria-label="Buscar medicamento na base Anvisa"
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
                            <span className="text-[0.5625rem] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ANTIMICROBIANO</span>
                          )}
                        </p>
                        {h.active_ingredient && (
                          <p className="text-[0.625rem] text-muted-foreground">{h.active_ingredient}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Compounded formula (manipulado) */}
              {formulaDraft ? (
                <fieldset className="rounded-lg border border-border/70 bg-white p-3 space-y-2 m-0 min-w-0">
                  <legend className="text-xs font-semibold text-foreground px-1">Fórmula manipulada</legend>
                  <Input aria-label="Nome da fórmula (opcional)" className="h-8 text-xs" value={formulaDraft.name} maxLength={200}
                    onChange={e => setFormulaDraft({ ...formulaDraft, name: e.target.value })} placeholder="Nome da fórmula (opcional)" />
                  {formulaDraft.components.map((c, k) => (
                    <div key={k} className="grid grid-cols-[1fr_96px_28px] gap-1.5">
                      <Input aria-label={`Componente ${k + 1}`} className="h-8 text-xs" value={c.substance} maxLength={120}
                        onChange={e => setFormulaDraft({ ...formulaDraft, components: formulaDraft.components.map((x, j) => j === k ? { ...x, substance: e.target.value } : x) })}
                        placeholder="Substância (nome genérico)" />
                      <Input aria-label={`Quantidade do componente ${k + 1}`} className="h-8 text-xs" value={c.amount} maxLength={40}
                        onChange={e => setFormulaDraft({ ...formulaDraft, components: formulaDraft.components.map((x, j) => j === k ? { ...x, amount: e.target.value } : x) })}
                        placeholder="100 mg" />
                      <button type="button" aria-label={`Remover componente ${k + 1}`} disabled={formulaDraft.components.length === 1}
                        onClick={() => setFormulaDraft({ ...formulaDraft, components: formulaDraft.components.filter((_, j) => j !== k) })}
                        className="flex items-center justify-center rounded text-muted-foreground hover:text-red-500 disabled:opacity-30">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={formulaDraft.components.length >= 12}
                    onClick={() => setFormulaDraft({ ...formulaDraft, components: [...formulaDraft.components, { substance: '', amount: '' }] })}>
                    Adicionar componente
                  </Button>
                  <Input aria-label="Excipiente ou veículo (opcional)" className="h-8 text-xs" value={formulaDraft.vehicle} maxLength={80}
                    onChange={e => setFormulaDraft({ ...formulaDraft, vehicle: e.target.value })} placeholder="Excipiente q.s.p. 1 cápsula (opcional)" />
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input aria-label="Forma farmacêutica" className="h-8 text-xs" value={formulaDraft.form} maxLength={40} list="formula-forms"
                      onChange={e => setFormulaDraft({ ...formulaDraft, form: e.target.value })} placeholder="Forma (cápsula, creme…)" />
                    <Input aria-label="Quanto manipular" className="h-8 text-xs" value={formulaDraft.quantity} maxLength={40}
                      onChange={e => setFormulaDraft({ ...formulaDraft, quantity: e.target.value })} placeholder="30 cápsulas" />
                  </div>
                  <datalist id="formula-forms">{FORMULA_FORMS.map(f => <option key={f} value={f} />)}</datalist>
                  {formulaProblem && <p role="alert" className="text-[0.6875rem] text-destructive">{formulaProblem}</p>}
                  <div className="flex flex-col-reverse gap-1.5 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setFormulaDraft(null); setFormulaProblem(''); }}>Cancelar</Button>
                    <Button type="button" size="sm" className="h-7 text-xs" onClick={addFormula}>Adicionar à receita</Button>
                  </div>
                </fieldset>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFormulaDraft(emptyFormula)}>
                  Adicionar fórmula manipulada
                </Button>
              )}

              {/* Medication list */}
              <div className="space-y-1.5">
                {meds.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">
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
                        id={`rx-medication-${i}`}
                        checked={m.checked}
                        onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))}
                        className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                      />
                      <label htmlFor={`rx-medication-${i}`} className="text-xs font-semibold text-foreground flex-1 cursor-pointer">{m.name}</label>
                      {m.antimicrobial && (
                        <span className="text-[0.5625rem] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ATM</span>
                      )}
                      {m.formula && (
                        <span className="text-[0.5625rem] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">MANIPULADO</span>
                      )}
                      {m.fromCatalog && (
                        <button
                          type="button"
                          aria-label={`Remover ${m.name} da receita`}
                          onClick={() => setMeds(prev => prev.filter((_, j) => j !== i))}
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {m.formula && (
                      <p className="pl-5 text-[0.6875rem] text-muted-foreground break-words">
                        {m.formula.components.map(c => `${c.substance} ${c.amount}`).join(' + ')} · manipular {m.formula.quantity} ({m.formula.form})
                      </p>
                    )}
                    {m.checked && (
                      <div className="grid grid-cols-[110px_1fr] gap-1.5 pl-5">
                        <Input
                          aria-label={`Dose de ${m.name}`}
                          className="h-7 text-xs"
                          value={m.dosage ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, dosage: e.target.value } : x))}
                          placeholder="Dose"
                        />
                        <Input
                          aria-label={`Posologia e instruções de ${m.name}`}
                          className="h-7 text-xs"
                          value={m.instructions ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, instructions: e.target.value } : x))}
                          placeholder="Posologia / instruções"
                        />
                      </div>
                    )}
                    {m.checked && isControlled && (
                      // Phones: strength on its own row, quantity and unit below it.
                      <div className="grid grid-cols-2 gap-1.5 pl-5 sm:grid-cols-[1fr_72px_1fr]">
                        <Input
                          aria-label={`Concentração de ${m.name}`}
                          className="h-7 text-xs col-span-2 sm:col-span-1"
                          value={m.concentration ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, concentration: e.target.value } : x))}
                          placeholder="Concentração (50 mg)"
                          maxLength={40}
                        />
                        <Input
                          aria-label={`Quantidade de ${m.name}`}
                          className="h-7 text-xs"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          step={1}
                          value={m.quantity ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                          placeholder="Qtd."
                        />
                        <Input
                          aria-label={`Unidade de ${m.name}`}
                          className="h-7 text-xs"
                          value={m.unit ?? ''}
                          onChange={e => setMeds(prev => prev.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                          placeholder="comprimidos"
                          maxLength={40}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isControlled && (
                <div className="space-y-3 border-t border-border/50 pt-3">
                  <div className="space-y-1">
                    <label htmlFor="rce-address" className="text-xs font-medium text-foreground/80">
                      Endereço do paciente <span className="text-muted-foreground font-normal">(obrigatório; fica só neste documento)</span>
                    </label>
                    <Textarea
                      id="rce-address"
                      value={patientAddress}
                      onChange={e => setPatientAddress(e.target.value)}
                      placeholder="Rua, número, complemento, bairro, cidade/UF e CEP"
                      className="min-h-[60px] text-sm"
                      maxLength={300}
                    />
                  </div>

                  {hasPatientCpf ? (
                    <p className="text-[0.6875rem] text-muted-foreground">O CPF do cadastro do paciente será impresso.</p>
                  ) : (
                    <fieldset className="space-y-1.5 border-0 p-0 m-0 min-w-0">
                      <legend className="text-xs font-medium text-foreground/80">
                        Documento do paciente <span className="text-muted-foreground font-normal">(o cadastro não tem CPF)</span>
                      </legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {([['nao_possui', 'Não possui CPF'], ['passaporte', 'Passaporte'], ['outro', 'Outro documento']] as const).map(([value, label]) => (
                          <label key={value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name="rce-patient-document"
                              value={value}
                              checked={documentKind === value}
                              onChange={() => setDocumentKind(value)}
                              className="h-3.5 w-3.5"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {(documentKind === 'passaporte' || documentKind === 'outro') && (
                        <Input
                          aria-label={documentKind === 'passaporte' ? 'Número do passaporte' : 'Tipo e número do documento'}
                          value={documentValue}
                          onChange={e => setDocumentValue(e.target.value)}
                          placeholder={documentKind === 'passaporte' ? 'Número do passaporte' : 'Ex.: RG 12.345.678-9 SSP/PR'}
                          maxLength={40}
                        />
                      )}
                    </fieldset>
                  )}

                  <div className="space-y-1">
                    <label htmlFor="rce-cid" className="text-xs font-medium text-foreground/80">
                      CID ou diagnóstico <span className="text-muted-foreground font-normal">(obrigatório para anabolizante ou com justificativa)</span>
                    </label>
                    <CidInput id="rce-cid" value={rceCid} onChange={setRceCid} placeholder="Ex.: F32.1" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="rce-justification" className="text-xs font-medium text-foreground/80">
                      Justificativa <span className="text-muted-foreground font-normal">(só se a quantidade passar de 60 dias de tratamento)</span>
                    </label>
                    <Textarea
                      id="rce-justification"
                      value={justification}
                      onChange={e => setJustification(e.target.value)}
                      placeholder="Ex.: tratamento contínuo de 90 dias"
                      className="min-h-[52px] text-sm"
                      maxLength={600}
                    />
                  </div>
                </div>
              )}
            </>
          )}
          </fieldset>
        </div>

        {catalogError && <p role="alert" className="px-5 text-xs text-destructive">Não foi possível consultar o catálogo. Edite a busca para tentar novamente ou preencha o medicamento manualmente.</p>}
        {/* Stacked on phones (primary action on top), side by side from sm up. */}
        <div className="px-5 py-3 border-t border-border/50 shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => changeOpen(false)} disabled={isGenerating}>
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
