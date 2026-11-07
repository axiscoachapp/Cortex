// Admin editor of the clinic's pre-consultation form (Configurações → Pré-consulta).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClinicAccess } from '@/features/reception/accessContext';
import {
  FIELD_LABELS, TYPE_LABELS, validateForm, type IntakeForm, type IntakeQuestion, type QuestionType, type RegistrationField,
} from '../../../supabase/functions/_shared/intakeForm';
import { intakeCall, type IntakeFormState } from './intakeApi';

const NONE = '__none__';
const slug = (text: string, taken: Set<string>) => {
  const base = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'pergunta';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
};

export function IntakeFormEditor() {
  const access = useClinicAccess();
  const queryClient = useQueryClient();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none', access?.admin ? 'admin' : 'member'];
  const q = useQuery({
    queryKey: ['intake-form', ...scope], queryFn: () => intakeCall<IntakeFormState>('form'),
    staleTime: 0, refetchOnMount: 'always', retry: false,
  });
  const [draft, setDraft] = useState<IntakeForm | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (!q.data || dirty) return;
    setDraft(q.data.form);
    setEnabled(q.data.enabled);
    setRevision(q.data.revision);
  }, [q.data, dirty]);
  const errors = useMemo(() => (draft ? validateForm(draft) : []), [draft]);
  const edit = (fn: (f: IntakeForm) => void) => {
    setDraft((f) => { if (!f) return f; const next = structuredClone(f); fn(next); return next; });
    setDirty(true);
    setMessage(null);
  };
  const save = useMutation({
    mutationFn: () => intakeCall<{ revision: number }>('saveForm', { revision, enabled, form: draft }),
    onSuccess: (r) => {
      setRevision(r.revision);
      setDirty(false);
      setMessage({ kind: 'ok', text: enabled ? 'Formulário salvo e ativo. Links novos usam esta versão.' : 'Formulário salvo. A pré-consulta está desligada.' });
      void queryClient.invalidateQueries({ queryKey: ['intake-form', ...scope] });
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  });

  if (q.isError && !dirty)
    return <p role="alert" className="text-sm text-destructive">{(q.error as Error).message} <button type="button" className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>;
  if (!draft || (!dirty && !q.isFetchedAfterMount)) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando o formulário…</p>;

  const allQuestions = draft.sections.flatMap((s) => s.questions);
  const takenIds = new Set(allQuestions.map((x) => x.id));
  const usedFields = new Set(allQuestions.map((x) => x.field).filter(Boolean));
  const choiceQuestions = allQuestions.filter((x) => x.type === 'choice');

  const setQ = (si: number, qi: number, patch: Partial<IntakeQuestion>) => edit((f) => {
    const cur = f.sections[si].questions[qi];
    const next: IntakeQuestion = { ...cur, ...patch };
    if (next.type !== 'choice' && next.type !== 'multi') delete next.options;
    else if (!next.options) next.options = ['Opção 1', 'Opção 2'];
    for (const k of Object.keys(patch) as Array<keyof IntakeQuestion>) if (patch[k] === undefined) delete next[k];
    f.sections[si].questions[qi] = next;
  });
  const move = (si: number, qi: number, dir: -1 | 1) => edit((f) => {
    const list = f.sections[si].questions;
    const j = qi + dir;
    if (j < 0 || j >= list.length) return;
    [list[qi], list[j]] = [list[j], list[qi]];
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div className="min-w-0">
          <p className="font-medium">Pré-consulta ativa</p>
          <p className="text-sm text-muted-foreground">Com ela ativa, a recepção copia o link de cada consulta em <Link to="/pre-consultas" className="underline">Pré-consultas</Link>, e as automações do WhatsApp podem enviá-lo.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); setDirty(true); setMessage(null); }} aria-label="Pré-consulta ativa" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="intake-intro">Apresentação</Label>
        <Textarea id="intake-intro" rows={2} value={draft.intro} maxLength={1500} onChange={(e) => edit((f) => { f.intro = e.target.value; })} />
      </div>

      {draft.sections.map((s, si) => (
        <section key={s.id} className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`sec-${s.id}`}>Seção</Label>
              <Input id={`sec-${s.id}`} value={s.title} maxLength={80} onChange={(e) => edit((f) => { f.sections[si].title = e.target.value; })} />
            </div>
            <div className="space-y-1 sm:w-56">
              <Label>Quem vê as respostas</Label>
              <Select value={s.audience} onValueChange={(v) => edit((f) => {
                f.sections[si].audience = v as 'registration' | 'health';
                if (v === 'health') for (const x of f.sections[si].questions) delete x.field;
              })}>
                <SelectTrigger aria-label={`Quem vê as respostas da seção ${s.title}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="registration">Recepção (cadastro)</SelectItem>
                  <SelectItem value="health">Só o médico (saúde)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" aria-label={`Remover a seção ${s.title}`} disabled={draft.sections.length === 1}
              onClick={() => edit((f) => { f.sections.splice(si, 1); })}><Trash2 className="h-4 w-4" /></Button>
          </div>

          <ol className="space-y-3">
            {s.questions.map((x, qi) => (
              <li key={x.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start gap-2">
                  <Input aria-label="Texto da pergunta" value={x.label} maxLength={200} onChange={(e) => setQ(si, qi, { label: e.target.value })} className="flex-1" />
                  <Button variant="ghost" size="icon" aria-label="Subir" disabled={qi === 0} onClick={() => move(si, qi, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Descer" disabled={qi === s.questions.length - 1} onClick={() => move(si, qi, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remover a pergunta ${x.label}`} onClick={() => edit((f) => {
                    const id = f.sections[si].questions[qi].id;
                    f.sections[si].questions.splice(qi, 1);
                    for (const sec of f.sections) for (const other of sec.questions) if (other.showIf?.question === id) delete other.showIf;
                  })}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={x.type} onValueChange={(v) => setQ(si, qi, { type: v as QuestionType })}>
                    <SelectTrigger aria-label="Tipo de resposta"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                  </Select>
                  {s.audience === 'registration' ? (
                    <Select value={x.field ?? NONE} onValueChange={(v) => setQ(si, qi, { field: v === NONE ? undefined : (v as RegistrationField) })}>
                      <SelectTrigger aria-label="Campo do cadastro"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem campo do cadastro</SelectItem>
                        {(Object.keys(FIELD_LABELS) as RegistrationField[]).filter((k) => k === x.field || !usedFields.has(k))
                          .map((k) => <SelectItem key={k} value={k}>Cadastro: {FIELD_LABELS[k]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : <span className="hidden sm:block" />}
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={!!x.required} onCheckedChange={(v) => setQ(si, qi, { required: v || undefined })} aria-label={`Obrigatória: ${x.label}`} />
                    Obrigatória
                  </label>
                </div>
                {(x.type === 'choice' || x.type === 'multi') && (
                  <Textarea aria-label="Opções, uma por linha" rows={Math.min(6, (x.options?.length ?? 2) + 1)} value={(x.options ?? []).join('\n')}
                    onChange={(e) => setQ(si, qi, { options: e.target.value.split('\n').map((o) => o.slice(0, 80)).slice(0, 20) })} />
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Ajuda (opcional)" placeholder="Ajuda (opcional)" value={x.help ?? ''} maxLength={300}
                    onChange={(e) => setQ(si, qi, { help: e.target.value || undefined })} />
                  <Select value={x.showIf ? `${x.showIf.question}::${x.showIf.equals}` : NONE}
                    onValueChange={(v) => setQ(si, qi, { showIf: v === NONE ? undefined : { question: v.split('::')[0], equals: v.split('::').slice(1).join('::') } })}>
                    <SelectTrigger aria-label="Quando mostrar"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Mostrar sempre</SelectItem>
                      {choiceQuestions.filter((c) => c.id !== x.id).flatMap((c) => (c.options ?? []).map((o) => (
                        <SelectItem key={`${c.id}::${o}`} value={`${c.id}::${o}`}>Só se "{c.label.slice(0, 30)}" = {o}</SelectItem>
                      )))}
                    </SelectContent>
                  </Select>
                </div>
              </li>
            ))}
          </ol>
          <Button variant="outline" size="sm" onClick={() => edit((f) => { f.sections[si].questions.push({ id: slug('pergunta', takenIds), label: 'Nova pergunta', type: 'text' }); })}>
            <Plus className="mr-1.5 h-4 w-4" /> Pergunta
          </Button>
        </section>
      ))}
      <Button variant="outline" size="sm" disabled={draft.sections.length >= 12}
        onClick={() => edit((f) => { f.sections.push({ id: slug('secao', new Set(f.sections.map((x) => x.id))), title: 'Nova seção', audience: 'health', questions: [{ id: slug('pergunta', takenIds), label: 'Nova pergunta', type: 'textarea' }] }); })}>
        <Plus className="mr-1.5 h-4 w-4" /> Seção
      </Button>

      <div className="space-y-2">
        <Label htmlFor="intake-thanks">Mensagem depois do envio</Label>
        <Textarea id="intake-thanks" rows={2} value={draft.thanks} maxLength={1500} onChange={(e) => edit((f) => { f.thanks = e.target.value; })} />
      </div>

      <p className="text-xs text-muted-foreground">
        O formulário não deve pedir exames, imagens nem documentos. As seções "Só o médico" nunca aparecem para a recepção.
        Mudanças valem para links criados depois de salvar.
      </p>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-destructive/5 p-3 pl-7 text-sm text-destructive">
          {errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-primary'}>{message.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={!dirty || errors.length > 0 || save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar formulário
        </Button>
        {dirty && <Button variant="ghost" onClick={() => { setDirty(false); setMessage(null); }}>Descartar mudanças</Button>}
      </div>
    </div>
  );
}
