import { useState } from 'react';
import { ClipboardCheck, Pencil, X, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProfileUpdates, Diagnosis, Medication } from '@/types/patient';

interface ProfileUpdateCardProps {
  initial: ProfileUpdates;
  existing: {
    diagnoses: Diagnosis[];
    medications: Medication[];
    allergies: string[];
  };
  missingFields: string[];
  onAccept: (merged: ProfileUpdates) => Promise<void>;
  onDismiss: () => void;
}

type Status = 'pending' | 'editing' | 'saving' | 'accepted' | 'dismissed';

function mergeDiagnoses(existing: Diagnosis[], incoming: { description: string }[]): { description: string }[] {
  const existingDescs = new Set(existing.map(d => d.description.toLowerCase().trim()));
  const base = existing.map(d => ({ description: d.description }));
  for (const inc of incoming) {
    if (!existingDescs.has(inc.description.toLowerCase().trim())) base.push(inc);
  }
  return base;
}

function mergeMedications(
  existing: Medication[],
  incoming: { name: string; dosage: string; instructions: string }[],
): { name: string; dosage: string; instructions: string }[] {
  const existingNames = new Set(existing.map(m => m.name.toLowerCase().trim()));
  const base = existing.map(m => ({ name: m.name, dosage: m.dosage, instructions: m.instructions }));
  for (const inc of incoming) {
    if (!existingNames.has(inc.name.toLowerCase().trim())) base.push(inc);
  }
  return base;
}

function mergeAllergies(existing: string[], incoming: string[]): string[] {
  const set = new Set(existing.map(a => a.toLowerCase().trim()));
  const base = [...existing];
  for (const inc of incoming) {
    if (!set.has(inc.toLowerCase().trim())) base.push(inc);
  }
  return base;
}

export function ProfileUpdateCard({
  initial,
  existing,
  missingFields,
  onAccept,
  onDismiss,
}: ProfileUpdateCardProps) {
  const [status, setStatus] = useState<Status>('pending');

  // Editable state — kept as flat string arrays for simplicity
  const [editDx, setEditDx]      = useState<string[]>(initial.diagnoses.map(d => d.description));
  const [editMeds, setEditMeds]  = useState<Array<{ name: string; dosage: string; instructions: string }>>(initial.medications);
  const [editAlg, setEditAlg]    = useState<string[]>(initial.allergies);

  // "add" input buffers
  const [addDx, setAddDx]   = useState('');
  const [addMed, setAddMed] = useState({ name: '', dosage: '', instructions: '' });
  const [addAlg, setAddAlg] = useState('');

  if (status === 'accepted') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200/60 rounded-lg px-4 py-3">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        Perfil clínico atualizado com as informações desta consulta.
      </div>
    );
  }

  if (status === 'dismissed') {
    return (
      <div className="text-xs text-muted-foreground/60 px-1">
        Atualização do perfil ignorada.
      </div>
    );
  }

  const hasSomething = initial.diagnoses.length > 0 || initial.medications.length > 0 || initial.allergies.length > 0;
  if (!hasSomething && missingFields.length === 0) return null;

  const handleAccept = async () => {
    const data: ProfileUpdates =
      status === 'editing'
        ? {
            diagnoses:   editDx.filter(Boolean).map(d => ({ description: d })),
            medications: editMeds.filter(m => m.name.trim()),
            allergies:   editAlg.filter(Boolean),
          }
        : initial;

    setStatus('saving');
    await onAccept({
      diagnoses:   mergeDiagnoses(existing.diagnoses, data.diagnoses),
      medications: mergeMedications(existing.medications, data.medications),
      allergies:   mergeAllergies(existing.allergies, data.allergies),
    });
    setStatus('accepted');
  };

  return (
    <div className="rounded-lg border border-medical-blue/20 bg-medical-blue-light/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-medical-blue/10">
        <div className="w-7 h-7 rounded-lg bg-medical-blue-light flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-3.5 h-3.5 text-medical-blue" />
        </div>
        <span className="text-sm font-semibold text-medical-blue flex-1">Atualização do Perfil Clínico</span>
        <span className="text-[10px] font-medium text-medical-blue/60 bg-medical-blue-light px-2 py-0.5 rounded-full">
          Sugestão da IA — revise antes de aceitar
        </span>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* Diagnoses */}
        {(status === 'editing' ? editDx.length > 0 || true : initial.diagnoses.length > 0) && (
          <Section
            label="Diagnósticos"
            color="amber"
            visible={status === 'editing' || initial.diagnoses.length > 0}
          >
            {status === 'editing' ? (
              <EditList
                items={editDx}
                renderItem={(v, i) => (
                  <ItemRow key={i} onRemove={() => setEditDx(editDx.filter((_, j) => j !== i))}>
                    <input
                      value={v}
                      onChange={e => setEditDx(editDx.map((x, j) => j === i ? e.target.value : x))}
                      className="flex-1 text-xs bg-white border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-medical-blue/30"
                    />
                  </ItemRow>
                )}
                addInput={
                  <AddRow
                    placeholder="Adicionar diagnóstico..."
                    value={addDx}
                    onChange={setAddDx}
                    onAdd={() => { if (addDx.trim()) { setEditDx([...editDx, addDx.trim()]); setAddDx(''); } }}
                  />
                }
              />
            ) : (
              <ChipList items={initial.diagnoses.map(d => d.description)} color="amber" />
            )}
          </Section>
        )}

        {/* Medications */}
        {(status === 'editing' ? true : initial.medications.length > 0) && (
          <Section
            label="Medicamentos"
            color="blue"
            visible={status === 'editing' || initial.medications.length > 0}
          >
            {status === 'editing' ? (
              <EditList
                items={editMeds}
                renderItem={(med, i) => (
                  <ItemRow key={i} onRemove={() => setEditMeds(editMeds.filter((_, j) => j !== i))}>
                    <div className="flex-1 grid grid-cols-3 gap-1">
                      {(['name', 'dosage', 'instructions'] as const).map(field => (
                        <input
                          key={field}
                          value={med[field]}
                          onChange={e => setEditMeds(editMeds.map((m, j) => j === i ? { ...m, [field]: e.target.value } : m))}
                          placeholder={field === 'name' ? 'Nome' : field === 'dosage' ? 'Dose' : 'Instruções'}
                          className="text-xs bg-white border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-medical-blue/30"
                        />
                      ))}
                    </div>
                  </ItemRow>
                )}
                addInput={
                  <div className="flex gap-1 mt-1">
                    {(['name', 'dosage', 'instructions'] as const).map(field => (
                      <input
                        key={field}
                        value={addMed[field]}
                        onChange={e => setAddMed({ ...addMed, [field]: e.target.value })}
                        placeholder={field === 'name' ? 'Nome' : field === 'dosage' ? 'Dose' : 'Instruções'}
                        className="flex-1 text-xs bg-white border border-dashed border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-medical-blue/30"
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        if (addMed.name.trim()) {
                          setEditMeds([...editMeds, { ...addMed }]);
                          setAddMed({ name: '', dosage: '', instructions: '' });
                        }
                      }}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-medical-blue/10 hover:bg-medical-blue/20 text-medical-blue"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                }
              />
            ) : (
              <ChipList
                items={initial.medications.map(m => `${m.name} ${m.dosage}`.trim())}
                color="blue"
              />
            )}
          </Section>
        )}

        {/* Allergies */}
        {(status === 'editing' ? true : initial.allergies.length > 0) && (
          <Section
            label="Alergias"
            color="red"
            visible={status === 'editing' || initial.allergies.length > 0}
          >
            {status === 'editing' ? (
              <EditList
                items={editAlg}
                renderItem={(v, i) => (
                  <ItemRow key={i} onRemove={() => setEditAlg(editAlg.filter((_, j) => j !== i))}>
                    <input
                      value={v}
                      onChange={e => setEditAlg(editAlg.map((x, j) => j === i ? e.target.value : x))}
                      className="flex-1 text-xs bg-white border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-medical-blue/30"
                    />
                  </ItemRow>
                )}
                addInput={
                  <AddRow
                    placeholder="Adicionar alergia..."
                    value={addAlg}
                    onChange={setAddAlg}
                    onAdd={() => { if (addAlg.trim()) { setEditAlg([...editAlg, addAlg.trim()]); setAddAlg(''); } }}
                  />
                }
              />
            ) : (
              <ChipList items={initial.allergies} color="red" />
            )}
          </Section>
        )}

        {/* Missing fields prompt */}
        {missingFields.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Perfil incompleto:</span>{' '}
              {missingFields.join(' · ')} não cadastrado{missingFields.length > 1 ? 's' : ''}.
              {' '}Adicione via Comentário ou no perfil do paciente para habilitar lembretes.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-medical-blue/10 flex gap-2">
        {status === 'editing' ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => setStatus('pending')}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs ml-auto"
              onClick={handleAccept}
              disabled={status === 'saving'}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Salvar edição
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              onClick={() => { setStatus('dismissed'); onDismiss(); }}
            >
              Ignorar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => setStatus('editing')}
              disabled={!hasSomething}
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs ml-auto"
              onClick={handleAccept}
              disabled={status === 'saving' || !hasSomething}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {status === 'saving' ? 'Salvando...' : 'Aceitar e salvar'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small sub-components ─────────────────────────────────────────────────────

const colorMap = {
  amber: 'bg-amber-100 text-amber-800',
  blue:  'bg-blue-100 text-blue-800',
  red:   'bg-red-100 text-red-800',
};

function Section({
  label,
  color,
  children,
  visible,
}: {
  label: string;
  color: keyof typeof colorMap;
  children: React.ReactNode;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="space-y-1.5">
      <p className={cn('text-[10px] font-bold uppercase tracking-wider', {
        'text-amber-600': color === 'amber',
        'text-blue-600':  color === 'blue',
        'text-red-600':   color === 'red',
      })}>
        {label}
      </p>
      {children}
    </div>
  );
}

function ChipList({ items, color }: { items: string[]; color: keyof typeof colorMap }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colorMap[color])}>
          {item}
        </span>
      ))}
    </div>
  );
}

function EditList<T>({
  items,
  renderItem,
  addInput,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  addInput: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => renderItem(item, i))}
      {addInput}
    </div>
  );
}

function ItemRow({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-muted-foreground/50 hover:text-red-500"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function AddRow({
  placeholder,
  value,
  onChange,
  onAdd,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex gap-1 mt-1">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onAdd())}
        placeholder={placeholder}
        className="flex-1 text-xs bg-white border border-dashed border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-medical-blue/30"
      />
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-medical-blue/10 hover:bg-medical-blue/20 text-medical-blue"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
