// Public pre-consultation page (no login). The link token is the only credential; nothing stored is
// shown back. Contract: docs/product/pre-consulta/CONTRATO.md.
import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  formSize, humanError, maskCpf, questionError, questionsOf, splitMessage, summaryText, type FieldError,
} from '@/features/intake/patientMessages';

const TZ = 'America/Sao_Paulo';
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
});
/** "sexta, 13/11, às 09:00" */
const whenShort = (iso: string) => {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long' }).replace(/-feira$/, '');
  const day = d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${weekday}, ${day}, às ${time}`;
};

// The clinic's name, remembered on this phone, so a link that stops working still says whose it was.
// The key is a hash of the token; only the clinic name is stored.
const memoryKey = (token: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 0x01000193);
  return `cortex:pre-consulta:clinica:${(h >>> 0).toString(36)}`;
};
const rememberedClinic = (token: string) => { try { return localStorage.getItem(memoryKey(token)) ?? ''; } catch { return ''; } };
const rememberClinic = (token: string, name: string) => { try { if (name) localStorage.setItem(memoryKey(token), name); } catch { /* private mode */ } };

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
        <div id={id} tabIndex={-1} role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} aria-invalid={!!error}
          className="grid gap-2 focus:outline-none sm:grid-cols-2">
          {options.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={current === o}
              onClick={() => onChange(q.type === 'yesno' ? o === 'Sim' : o)}
              className={cn('min-h-11 rounded-lg border px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current === o ? 'border-primary bg-primary/10 font-medium text-foreground' : 'bg-white hover:border-primary/40',
                error && current !== o && 'border-destructive/50')}>
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
        <div id={id} tabIndex={-1} role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="grid gap-2 focus:outline-none sm:grid-cols-2">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2 text-base">
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
      control = <Input {...common} type={type} inputMode={inputMode} autoComplete={autoComplete}
        maxLength={q.type === 'cpf' ? 14 : q.type === 'text' ? 200 : 80} placeholder={q.type === 'cpf' ? '000.000.000-00' : undefined}
        value={text} onChange={(e) => onChange(q.type === 'cpf' ? maskCpf(e.target.value) : e.target.value)} />;
    }
  }
  return (
    <div className="space-y-2">
      <Label id={`${id}-label`} htmlFor={q.type === 'choice' || q.type === 'yesno' || q.type === 'multi' ? undefined : id} className="text-base font-medium leading-snug">
        {q.label}{q.required && <span className="text-destructive" aria-hidden> *</span>}
        {q.required && <span className="sr-only"> (obrigatória)</span>}
      </Label>
      {q.help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{q.help}</p>}
      {control}
      {error && <p id={`${id}-error`} className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

const PRIVACY_ERROR = 'Confirme que leu o aviso de privacidade para enviar.';

export default function PreConsultaPage() {
  const { token = '' } = useParams();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [whatsapp, setWhatsapp] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldError>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [privacyError, setPrivacyError] = useState('');
  const errorBox = useRef<HTMLDivElement>(null);

  const page = useQuery({
    queryKey: ['pre-consulta', token],
    queryFn: () => intakePublicCall<PublicIntake>('open', { token }),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const data = page.data;
  const form = data?.form ?? null;
  useEffect(() => { if (data?.clinicName) rememberClinic(token, data.clinicName); }, [token, data?.clinicName]);
  const clinicName = data?.clinicName || rememberedClinic(token);

  // Only visible answers are sent; a CPF goes as digits.
  const visible = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (!form) return out;
    for (const q of questionsOf(form)) {
      if (!isVisible(form, q, answers) || answers[q.id] === undefined) continue;
      out[q.id] = q.type === 'cpf' && typeof answers[q.id] === 'string' ? (answers[q.id] as string).replace(/\D/g, '') : answers[q.id];
    }
    return out;
  }, [form, answers]);

  const focusSummary = () => requestAnimationFrame(() => errorBox.current?.focus());
  const submit = useMutation({
    mutationFn: () => intakePublicCall<{ answeredAt: string; thanks: string }>('submit', {
      token, formRevision: data?.formRevision, answers: visible, whatsappConsent: whatsapp, privacyAccepted: privacy,
    }),
    onError: (e: Error) => {
      const byQuestion: Record<string, FieldError> = {};
      const rest: string[] = [];
      if (e instanceof IntakeApiError && e.code === 'privacy') setPrivacyError(PRIVACY_ERROR);
      else if (e instanceof IntakeApiError && e.errors.length && form) {
        for (const m of e.errors) {
          const hit = splitMessage(form, m);
          if (hit) byQuestion[hit.q.id] ??= humanError(hit.q, hit.reason); else rest.push(m);
        }
      } else rest.push(e.message);
      setFieldErrors(byQuestion);
      setGeneral(rest);
      focusSummary();
    },
  });

  const send = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const errs: Record<string, FieldError> = {};
    for (const q of questionsOf(form)) {
      const err = questionError(form, q, visible);
      if (err) errs[q.id] = err;
    }
    const rest = Object.keys(errs).length ? [] : validateAnswers(form, visible).errors.filter((m) => !splitMessage(form, m));
    setFieldErrors(errs);
    setGeneral(rest);
    setPrivacyError(privacy ? '' : PRIVACY_ERROR);
    if (Object.keys(errs).length || rest.length || !privacy) { focusSummary(); return; }
    submit.mutate();
  };

  const change = (q: IntakeQuestion, v: unknown) => {
    setAnswers((a) => ({ ...a, [q.id]: v }));
    // A corrected field stops being red at once; the rest waits for the next "Enviar".
    setFieldErrors((e) => { if (!(q.id in e)) return e; const { [q.id]: _gone, ...rest } = e; return rest; });
  };

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-[#F6F8F7] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">{children}
        <footer className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
          <p className="flex items-center justify-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden /> Suas respostas vão direto para a clínica.</p>
          <p><Link to="/aviso-de-privacidade" className="underline">Aviso de privacidade</Link></p>
        </footer>
      </div>
    </main>
  );
  const header = (
    <header className="mb-5">
      {clinicName && <p className="text-base font-semibold text-primary">{clinicName}</p>}
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0E2A33]">Pré-consulta</h1>
      {data && (
        <p className="mt-1 text-base text-muted-foreground">
          Consulta {data.doctorName ? `com ${data.doctorName} ` : ''}em {when(data.start)}.
        </p>
      )}
    </header>
  );

  if (page.isLoading) return shell(<>{header}<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p></>);
  if (page.isError || !data) {
    const notFound = page.error instanceof IntakeApiError && page.error.code === 'not_found';
    return shell(<>{header}
      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-lg font-semibold">{notFound ? 'Link inválido ou vencido' : 'Não foi possível abrir o formulário'}</h2>
        <p className="mt-2 text-base text-muted-foreground">
          {notFound ? `Confira se o link está completo ou peça um novo à recepção ${clinicName ? `da ${clinicName}` : 'da clínica'}.` : (page.error as Error)?.message}
        </p>
        {!notFound && <Button className="mt-4" variant="outline" onClick={() => page.refetch()}>Tentar novamente</Button>}
      </section></>);
  }

  if (submit.isSuccess) {
    const who = data.doctorName || 'A clínica';
    return shell(<>{header}
      <section className="space-y-3 rounded-2xl border bg-white p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
        <h2 className="text-lg font-semibold">Pronto! Respostas enviadas</h2>
        <p className="text-base">{who} recebe suas respostas antes da consulta de {whenShort(data.start)}.</p>
        <p className="text-base text-muted-foreground">
          A recepção {clinicName ? `da ${clinicName} ` : ''}confere seus dados. As respostas sobre saúde são lidas só {data.doctorName ? `por ${data.doctorName}` : 'pelo médico da consulta'}.
        </p>
        {submit.data.thanks && <p className="text-sm text-muted-foreground whitespace-pre-line">{submit.data.thanks}</p>}
        <p className="border-t pt-3 text-base">Pode fechar esta página. Para corrigir algo, abra o mesmo link e envie de novo.</p>
      </section></>);
  }
  if (data.state === 'closed' || data.state === 'reviewed' || !form) {
    return shell(<>{header}
      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-lg font-semibold">{data.state === 'reviewed' ? 'Suas respostas já foram conferidas' : 'Este formulário foi encerrado'}</h2>
        <p className="mt-2 text-base text-muted-foreground">
          {data.state === 'reviewed' ? 'Se precisar corrigir algo, fale com a recepção.' : `A consulta já passou, foi cancelada ou o link foi trocado. Fale com a recepção ${clinicName ? `da ${clinicName}` : 'da clínica'} se precisar.`}
        </p>
      </section></>);
  }

  const summary = [
    ...questionsOf(form).filter((q) => fieldErrors[q.id]).map((q) => ({ key: q.id, text: summaryText(q, fieldErrors[q.id]), target: `q-${q.id}` })),
    ...general.map((m) => ({ key: m, text: m, target: '' })),
    ...(privacyError ? [{ key: 'privacy', text: privacyError, target: 'consent-privacy-box' }] : []),
  ];

  return shell(<>
    {header}
    {data.state === 'answered' && data.answeredAt && (
      <p className="mb-4 rounded-lg border border-[#F2B23E]/60 bg-[#F2B23E]/10 p-3 text-base">
        Você já enviou respostas em {when(data.answeredAt)}. Para corrigir algo, responda de novo e envie: a clínica recebe a versão nova.
      </p>
    )}
    {form.intro && <p className="text-base leading-relaxed whitespace-pre-line">{form.intro}</p>}
    <p className="mb-5 mt-1 text-sm text-muted-foreground">{formSize(form)}</p>
    <form noValidate onSubmit={send} className="space-y-5">
      {summary.length > 0 && (
        <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-base text-destructive focus:outline-none">
          <p className="font-medium">Revise antes de enviar:</p>
          <ul className="mt-1 space-y-1.5">
            {summary.slice(0, 8).map((s) => (
              <li key={s.key}>
                {s.target ? <button type="button" className="text-left underline underline-offset-2" onClick={() => document.getElementById(s.target)?.focus()}>{s.text}</button> : s.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {form.sections.map((s) => (
        <fieldset key={s.id} className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6">
          <legend className="sr-only">{s.title}</legend>
          <div>
            <h2 className="text-lg font-semibold" aria-hidden>{s.title}</h2>
            <p className="text-sm text-muted-foreground">
              {s.audience === 'health' ? 'Só o médico da consulta lê estas respostas.' : 'A recepção usa estes dados para o seu cadastro.'}
            </p>
          </div>
          {s.questions.filter((q) => isVisible(form, q, answers)).map((q) => (
            <QuestionField key={q.id} q={q} value={answers[q.id]} error={fieldErrors[q.id]?.message} onChange={(v) => change(q, v)} />
          ))}
        </fieldset>
      ))}
      <div className="space-y-3 rounded-2xl border bg-white p-4 sm:p-6">
        <label className="flex cursor-pointer items-start gap-3 text-base">
          <Checkbox checked={whatsapp} onCheckedChange={(c) => setWhatsapp(c === true)} className="mt-1" aria-labelledby="consent-whatsapp" />
          <span id="consent-whatsapp">Aceito receber lembretes e avisos da clínica pelo WhatsApp, no número que está no meu cadastro. Posso cancelar quando quiser respondendo SAIR.</span>
        </label>
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-start gap-3 text-base">
            <Checkbox id="consent-privacy-box" checked={privacy} className="mt-1" aria-required aria-labelledby="consent-privacy"
              aria-invalid={!!privacyError} aria-describedby={privacyError ? 'consent-privacy-error' : undefined}
              onCheckedChange={(c) => { setPrivacy(c === true); if (c === true) setPrivacyError(''); }} />
            <span id="consent-privacy">Li o <Link to="/aviso-de-privacidade" target="_blank" className="underline">aviso de privacidade</Link> e sei que as respostas sobre saúde são lidas só pelo médico, para o meu atendimento. <span className="text-destructive" aria-hidden>*</span></span>
          </label>
          {privacyError && <p id="consent-privacy-error" className="pl-7 text-sm font-medium text-destructive">{privacyError}</p>}
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
        {submit.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</> : 'Enviar respostas'}
      </Button>
    </form>
  </>);
}
