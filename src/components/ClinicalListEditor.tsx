import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { Diagnosis, Medication, Patient } from '@/types/patient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ClinicalListKind = 'allergies' | 'diagnoses' | 'medications';

/** One editable row; fields not used by a kind stay empty. */
interface Row {
  key: number;
  /** Allergy text, diagnosis description or medication name. */
  main: string;
  /** Diagnosis code or medication dose. */
  second: string;
  /** Medication instructions. */
  third: string;
  startedAt?: string;
}

const META: Record<
  ClinicalListKind,
  { title: string; item: string; add: string; main: string; second?: string; third?: string; empty: string }
> = {
  allergies: {
    title: 'Editar alergias',
    item: 'alergia',
    add: 'Adicionar alergia',
    main: 'Alergia',
    empty: 'Nenhuma alergia registrada.',
  },
  diagnoses: {
    title: 'Editar diagnósticos',
    item: 'diagnóstico',
    add: 'Adicionar diagnóstico',
    main: 'Diagnóstico',
    second: 'CID (opcional)',
    empty: 'Nenhum diagnóstico registrado.',
  },
  medications: {
    title: 'Editar medicações',
    item: 'medicação',
    add: 'Adicionar medicação',
    main: 'Medicamento',
    second: 'Dose',
    third: 'Instruções',
    empty: 'Nenhuma medicação registrada.',
  },
};

type Lists = Pick<Patient, 'allergies' | 'diagnoses' | 'medications'>;

function rowsOf(kind: ClinicalListKind, lists: Lists): Row[] {
  if (kind === 'allergies') return lists.allergies.map((main, key) => ({ key, main, second: '', third: '' }));
  if (kind === 'diagnoses')
    return lists.diagnoses.map((d, key) => ({ key, main: d.description, second: d.code ?? '', third: '' }));
  return lists.medications.map((m, key) => ({
    key,
    main: m.name,
    second: m.dosage ?? '',
    third: m.instructions ?? '',
    startedAt: m.startedAt,
  }));
}

function valueOf(kind: ClinicalListKind, rows: Row[]): string[] | Diagnosis[] | Medication[] {
  const kept = rows
    .map((row) => ({ ...row, main: row.main.trim(), second: row.second.trim(), third: row.third.trim() }))
    .filter((row) => row.main);
  if (kind === 'allergies') return kept.map((row) => row.main);
  if (kind === 'diagnoses') return kept.map((row) => ({ code: row.second, description: row.main }));
  return kept.map((row) => ({
    name: row.main,
    dosage: row.second,
    instructions: row.third,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
  }));
}

function listsFromRow(row: { allergies: string[] | null; diagnoses: Json | null; medications: Json | null }): Lists {
  const objects = (value: Json | null) =>
    Array.isArray(value)
      ? value.filter((entry): entry is Record<string, Json> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
      : [];
  const text = (value: Json | undefined) => (typeof value === 'string' ? value : '');
  return {
    allergies: (row.allergies ?? []).filter((entry) => typeof entry === 'string'),
    diagnoses: objects(row.diagnoses).map((d) => ({ code: text(d.code), description: text(d.description) })),
    medications: objects(row.medications).map((m) => ({
      name: text(m.name),
      dosage: text(m.dosage),
      instructions: text(m.instructions),
      ...(typeof m.startedAt === 'string' ? { startedAt: m.startedAt } : {}),
    })),
  };
}

function describe(kind: ClinicalListKind, lists: Lists): string {
  if (kind === 'allergies') return lists.allergies.join(', ') || 'lista vazia';
  if (kind === 'diagnoses')
    return lists.diagnoses.map((d) => (d.code ? `${d.code} ${d.description}` : d.description)).join('; ') || 'lista vazia';
  return lists.medications.map((m) => [m.name, m.dosage].filter(Boolean).join(' ')).join('; ') || 'lista vazia';
}

/**
 * Doctor-authored correction of a patient's allergies, diagnoses or
 * medications. These lists feed every AI prompt as the patient's current
 * state, so they must be editable without the AI. Saves are guarded by the
 * patient's revision: a change made elsewhere is shown, never overwritten.
 */
export function ClinicalListEditor({
  kind,
  patient,
  userId,
  open,
  onOpenChange,
}: {
  kind: ClinicalListKind;
  patient: Patient;
  userId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = META[kind];
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [base, setBase] = useState('');
  const [revision, setRevision] = useState<number | undefined>(patient.revision);
  const [confirmingKey, setConfirmingKey] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<Lists | null>(null);
  const nextKey = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const initial = rowsOf(kind, patient);
    nextKey.current = initial.length;
    setRows(initial);
    setBase(JSON.stringify(valueOf(kind, initial)));
    setRevision(patient.revision);
    setConfirmingKey(null);
    setError('');
    setCurrent(null);
    // Re-seed only on open or patient switch, never while the doctor edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, patient.id]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const dirty = JSON.stringify(valueOf(kind, rows)) !== base;

  const close = () => {
    if (saving) return;
    if (dirty && !window.confirm('Descartar as alterações desta lista?')) return;
    onOpenChange(false);
  };

  const update = (key: number, field: 'main' | 'second' | 'third', value: string) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  const add = () => {
    const key = nextKey.current++;
    setRows((previous) => [...previous, { key, main: '', second: '', third: '' }]);
    // Focus the new row's first field after it renders.
    setTimeout(() => document.getElementById(`clinical-list-${kind}-${key}-main`)?.focus(), 0);
  };

  const remove = (key: number) => {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setConfirmingKey(null);
  };

  const save = async () => {
    if (saving) return;
    if (kind === 'medications' && rows.some((row) => !row.main.trim() && (row.second.trim() || row.third.trim()))) {
      setError('Informe o nome de cada medicamento ou remova a linha.');
      return;
    }
    if (revision === undefined) {
      setError('Não foi possível conferir a versão do prontuário. Feche e abra o paciente de novo.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data, error: failure } = await supabase
        .from('patients')
        .update({ [kind]: valueOf(kind, rows) as unknown as Json })
        .eq('id', patient.id)
        .eq('revision', revision)
        .select('id')
        .maybeSingle();
      if (failure) throw failure;
      if (!data) {
        const fresh = await supabase
          .from('patients')
          .select('revision, allergies, diagnoses, medications')
          .eq('id', patient.id)
          .single();
        if (fresh.data) {
          setCurrent(listsFromRow(fresh.data));
          setRevision(fresh.data.revision);
        }
        setError(
          'Este prontuário foi alterado em outra tela. Suas alterações foram mantidas. Confira a lista atual abaixo e salve de novo.',
        );
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
      onOpenChange(false);
    } catch {
      setError('Não foi possível salvar. Suas alterações foram mantidas; tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-lg max-h-[90dvh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">{meta.title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {patient.name}. Esta lista é usada pela IA como o estado atual do paciente.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={saving} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 border-0 m-0 min-w-0">
          <legend className="sr-only">{meta.title}</legend>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{meta.empty}</p>}
          <ul className="space-y-3">
            {rows.map((row, index) => {
              const label = row.main.trim() || `${meta.item} ${index + 1}`;
              return (
                <li key={row.key} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <label htmlFor={`clinical-list-${kind}-${row.key}-main`} className="text-xs font-medium">
                        {meta.main}
                      </label>
                      <Input
                        id={`clinical-list-${kind}-${row.key}-main`}
                        value={row.main}
                        maxLength={200}
                        onChange={(event) => update(row.key, 'main', event.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                      aria-label={`Remover ${label}`}
                      onClick={() => (row.main.trim() ? setConfirmingKey(row.key) : remove(row.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {(meta.second || meta.third) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {meta.second && (
                        <div className="space-y-1">
                          <label htmlFor={`clinical-list-${kind}-${row.key}-second`} className="text-xs font-medium">
                            {meta.second}
                          </label>
                          <Input
                            id={`clinical-list-${kind}-${row.key}-second`}
                            value={row.second}
                            maxLength={120}
                            onChange={(event) => update(row.key, 'second', event.target.value)}
                          />
                        </div>
                      )}
                      {meta.third && (
                        <div className="space-y-1">
                          <label htmlFor={`clinical-list-${kind}-${row.key}-third`} className="text-xs font-medium">
                            {meta.third}
                          </label>
                          <Input
                            id={`clinical-list-${kind}-${row.key}-third`}
                            value={row.third}
                            maxLength={300}
                            onChange={(event) => update(row.key, 'third', event.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {confirmingKey === row.key && (
                    <div role="alertdialog" aria-label={`Remover ${label}?`} className="rounded-md bg-destructive/10 p-2 text-sm space-y-2">
                      <p>Remover {label} da lista? A mudança vale ao salvar.</p>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingKey(null)}>
                          Manter
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => remove(row.key)}>
                          Remover
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 min-h-10" onClick={add}>
            <Plus className="h-4 w-4" />
            {meta.add}
          </Button>
          {current && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs space-y-2">
              <p>
                <span className="font-medium">Lista atual salva:</span> {describe(kind, current)}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const fresh = rowsOf(kind, current);
                  nextKey.current = fresh.length;
                  setRows(fresh);
                  setBase(JSON.stringify(valueOf(kind, fresh)));
                  setCurrent(null);
                  setError('');
                }}
              >
                Usar a lista atual
              </Button>
            </div>
          )}
        </fieldset>

        {error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="px-5 pb-2 text-sm text-destructive outline-none">
            {error}
          </div>
        )}
        <div className="px-5 py-3 border-t border-border/50 shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!dirty && !current)}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
