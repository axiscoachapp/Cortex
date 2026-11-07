// Public pre-consultation page (no login). The link token is the only credential; nothing stored is
// shown back. Contract: docs/product/pre-consulta/CONTRATO.md.
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { IntakeApiError, intakePublicCall, type PublicIntake } from '@/features/intake/intakeApi';
import { isVisible, validateAnswers, type IntakeQuestion } from '../../supabase/functions/_shared/intakeForm';

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
});

function QuestionField({ q, value, error, onChange }: { q: IntakeQuestion; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const id = `q-${q.id}`;
  const describedBy = [q.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': describedBy };
  const text = typeof value === 'string' ? value : '';
  let control: React.ReactNode;
  switch (q.type) {
    case 'textarea':
      control = <Textarea {...common} rows={3} maxLength={2000} value={text} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'choice': case 'yesno': {
      const options = q.type === 'yesno' ? ['Sim', 'Não'] : q.options ?? [];
      const current = q.type === 'yesno' ? (value === true ? 'Sim' : value === false ? 'Não' : '') : text;
      control = (
        <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={current === o}
              onClick={() => onChange(q.type === 'yesno' ? o === 'Sim' : o)}
              className={cn('min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current === o ? 'border-primary bg-primary/10 font-medium text-foreground' : 'bg-white hover:border-primary/40')}>
              {o}
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'multi': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="grid gap-2 sm:grid-cols-2" aria-describedby={describedBy}>
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2 text-sm">
              <Checkbox aria-label={o} checked={list.includes(o)} onCheckedChange={(c) => onChange(c ? [...list, o] : list.filter((x) => x !== o))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      );
      break;
    }
    default: {
      const type = q.type === 'date' ? 'date' : q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text';
      const inputMode = q.type === 'cpf' || q.type === 'cep' || q.type === 'number' ? 'numeric' : q.type === 'phone' ? 'tel' : undefined;
      const autoComplete = q.field === 'name' ? 'name' : q.field === 'email' ? 'email' : q.field === 'cep' ? 'postal-code'
        : q.field === 'street' ? 'address-line1' : q.field === 'city' ? 'address-level2' : q.field === 'birth_date' ? 'bday' : 'off';
      control = <Input {...common} type={type} inputMode={inputMode} autoComplete={autoComplete} maxLength={q.type === 'text' ? 200 : 80}
        value={text} onChange={(e) => onChange(e.target.value)} />;
    }
  }
  return (
    <div className="space-y-2">
      <Label id={`${id}-label`} htmlFor={q.type === 'choice' || q.type === 'yesno' || q.type === 'multi' ? undefined : id} className="text-[15px] leading-snug">
        {q.label}{q.required && <span className="text-destructive" aria-hidden> *</span>}
        {q.required && <span className="sr-only"> (obrigatória)</span>}
      </Label>
      {q.help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{q.help}</p>}
      {control}
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function PreConsultaPage() {
  const { token = '' } = useParams();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [whatsapp, setWhatsapp] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const errorBox = useRef<HTMLDivElement>(null);

  const page = useQuery({
    queryKey: ['pre-consulta', token],
    queryFn: () => intakePublicCall<PublicIntake>('open', { token }),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const data = page.data;
  const form = data?.form ?? null;

  const visible = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (!form) return out;
    for (const s of form.sections) for (const q of s.questions) if (isVisible(q, answers) && answers[q.id] !== undefined) out[q.id] = answers[q.id];
    return out;
  }, [form, answers]);

  const submit = useMutation({
    mutationFn: () => intakePublicCall<{ answeredAt: string; thanks: string }>('submit', {
      token, formRevision: data?.formRevision, answers: visible, whatsappConsent: whatsapp, privacyAccepted: privacy,
    }),
    onError: (e: Error) => {
      setErrors(e instanceof IntakeApiError && e.errors.length ? e.errors : [e.message]);
      requestAnimationFrame(() => errorBox.current?.focus());
    },
  });

  const send = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const checked = validateAnswers(form, visible);
    const list = [...checked.errors, ...(privacy ? [] : ['Confirme que leu o aviso de privacidade.'])];
    setErrors(list);
    if (list.length) { requestAnimationFrame(() => errorBox.current?.focus()); return; }
    submit.mutate();
  };

  const errorFor = (q: IntakeQuestion) => errors.find((e) => e.startsWith(`${q.label}:`))?.slice(q.label.length + 1).trim();

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-[#F6F8F7] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">{children}
        <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Formulário seguro do Cortex · <Link to="/aviso-de-privacidade" className="underline">Aviso de privacidade</Link>
        </p>
      </div>
    </main>
  );

  if (page.isLoading) return shell(<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>);
  if (page.isError || !data) {
    const notFound = page.error instanceof IntakeApiError && page.error.code === 'not_found';
    return shell(
      <section className="rounded-2xl border bg-white p-6">
        <h1 className="text-lg font-semibold">{notFound ? 'Link inválido ou vencido' : 'Não foi possível abrir o formulário'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {notFound ? 'Confira se o link está completo ou peça um novo à recepção da clínica.' : (page.error as Error)?.message}
        </p>
        {!notFound && <Button className="mt-4" variant="outline" onClick={() => page.refetch()}>Tentar novamente</Button>}
      </section>,
    );
  }

  const header = (
    <header className="mb-5">
      <p className="text-sm font-medium text-primary">{data.clinicName || 'Clínica'}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0E2A33]">Pré-consulta</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Consulta {data.doctorName ? `com ${data.doctorName} ` : ''}em {when(data.start)}.
      </p>
    </header>
  );

  if (submit.isSuccess) {
    return shell(<>{header}
      <section className="rounded-2xl border bg-white p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold">Respostas enviadas</h2>
        <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{submit.data.thanks}</p>
      </section></>);
  }
  if (data.state === 'closed' || data.state === 'reviewed' || !form) {
    return shell(<>{header}
      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-lg font-semibold">{data.state === 'reviewed' ? 'Suas respostas já foram conferidas' : 'Este formulário foi encerrado'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.state === 'reviewed' ? 'Se precisar corrigir algo, fale com a recepção.' : 'A consulta já passou, foi cancelada ou o link foi trocado. Fale com a recepção se precisar.'}
        </p>
      </section></>);
  }

  return shell(<>
    {header}
    {data.state === 'answered' && data.answeredAt && (
      <p className="mb-4 rounded-lg border border-[#F2B23E]/60 bg-[#F2B23E]/10 p-3 text-sm">
        Você já enviou respostas em {when(data.answeredAt)}. Se enviar de novo, elas substituem as anteriores.
      </p>
    )}
    {form.intro && <p className="mb-5 text-[15px] leading-relaxed whitespace-pre-line">{form.intro}</p>}
    <form noValidate onSubmit={send} className="space-y-5">
      {errors.length > 0 && (
        <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive focus:outline-none">
          <p className="font-medium">Revise antes de enviar:</p>
          <ul className="mt-1 list-disc pl-5">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {form.sections.map((s) => (
        <fieldset key={s.id} className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6">
          <legend className="sr-only">{s.title}</legend>
          <div>
            <h2 className="text-base font-semibold" aria-hidden>{s.title}</h2>
            <p className="text-xs text-muted-foreground">
              {s.audience === 'health' ? 'Só o médico da consulta lê estas respostas.' : 'A recepção usa estes dados para o seu cadastro.'}
            </p>
          </div>
          {s.questions.filter((q) => isVisible(q, answers)).map((q) => (
            <QuestionField key={q.id} q={q} value={answers[q.id]} error={errorFor(q)} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
          ))}
        </fieldset>
      ))}
      <div className="space-y-3 rounded-2xl border bg-white p-4 sm:p-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox checked={whatsapp} onCheckedChange={(c) => setWhatsapp(c === true)} className="mt-0.5" aria-labelledby="consent-whatsapp" />
          <span id="consent-whatsapp">Aceito receber lembretes e avisos da clínica pelo WhatsApp, no número que está no meu cadastro. Posso cancelar quando quiser respondendo SAIR.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox checked={privacy} onCheckedChange={(c) => setPrivacy(c === true)} className="mt-0.5" aria-required aria-labelledby="consent-privacy" />
          <span id="consent-privacy">Li o <Link to="/aviso-de-privacidade" target="_blank" className="underline">aviso de privacidade</Link> e sei que as respostas sobre saúde são lidas só pelo médico, para o meu atendimento. <span className="text-destructive" aria-hidden>*</span></span>
        </label>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
        {submit.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</> : 'Enviar respostas'}
      </Button>
    </form>
  </>);
}
