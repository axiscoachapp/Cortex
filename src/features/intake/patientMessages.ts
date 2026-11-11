// What the patient reads on the public pre-consultation page. The validator (shared with the server,
// supabase/functions/_shared/intakeForm.ts) speaks in short technical phrases; these replace them.
import { isVisible, validateAnswers, type IntakeForm, type IntakeQuestion } from '../../../supabase/functions/_shared/intakeForm';

/** 000.000.000-00 while typing; the server keeps digits only. */
export function maskCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const REQUIRED_BY_FIELD: Partial<Record<NonNullable<IntakeQuestion['field']>, string>> = {
  name: 'Informe seu nome completo', birth_date: 'Informe sua data de nascimento', cpf: 'Informe seu CPF',
  email: 'Informe seu e-mail', phone: 'Informe seu telefone com DDD', insurance_type: 'Escolha particular ou convênio',
  insurance_payer: 'Informe o nome do convênio', insurance_card: 'Informe o número da carteirinha',
};

/** `standalone`: the message already names the field, so the summary shows it without the question. */
export interface FieldError { message: string; standalone: boolean }

export function humanError(q: IntakeQuestion, raw: string): FieldError {
  const r = raw.trim().replace(/\.$/, '');
  if (r === 'resposta obrigatória') {
    const byField = q.field && REQUIRED_BY_FIELD[q.field];
    if (byField) return { message: byField, standalone: true };
    if (q.type === 'cpf') return { message: 'Informe seu CPF', standalone: true };
    if (q.type === 'choice' || q.type === 'yesno') return { message: 'Escolha uma opção', standalone: false };
    if (q.type === 'multi') return { message: 'Escolha pelo menos uma opção', standalone: false };
    return { message: 'Responda esta pergunta', standalone: false };
  }
  if (r === 'CPF inválido') return { message: 'CPF inválido — confira os 11 números', standalone: true };
  if (r === 'CEP inválido') return { message: 'CEP inválido — confira os 8 números', standalone: true };
  if (r === 'e-mail inválido') return { message: 'E-mail inválido — confira o endereço, por exemplo nome@email.com', standalone: true };
  if (r === 'telefone inválido') return { message: 'Telefone inválido — informe o DDD e o número', standalone: true };
  if (r === 'data inválida') return { message: 'Data inválida — confira dia, mês e ano', standalone: false };
  if (r === 'número inválido') return { message: 'Use um número inteiro, por exemplo 2', standalone: false };
  if (r === 'escolha uma das opções' || r === 'escolha entre as opções' || r === 'responda sim ou não') return { message: 'Escolha uma opção', standalone: false };
  if (r === 'esta pergunta não se aplica') return { message: 'Esta pergunta não se aplica: apague a resposta', standalone: false };
  return { message: r.charAt(0).toUpperCase() + r.slice(1), standalone: false };
}

/** Summary line: the message alone when it names the field, otherwise prefixed by the question. */
export const summaryText = (q: IntakeQuestion, e: FieldError) =>
  e.standalone ? e.message : `${q.label}: ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)}`;

export const questionsOf = (form: IntakeForm) => form.sections.flatMap((s) => s.questions);

/** The question a validator message ("<label>: <reason>") belongs to; the longest label wins. */
export function splitMessage(form: IntakeForm, message: string): { q: IntakeQuestion; reason: string } | null {
  const q = questionsOf(form).filter((x) => message.startsWith(`${x.label}:`)).sort((a, b) => b.label.length - a.label.length)[0];
  return q ? { q, reason: message.slice(q.label.length + 1) } : null;
}

/** The error of one visible question, validated alone by the same rules as the server. */
export function questionError(form: IntakeForm, q: IntakeQuestion, answers: Record<string, unknown>): FieldError | undefined {
  if (!isVisible(form, q, answers)) return undefined;
  const single: IntakeForm = { ...form, sections: [{ id: 'q', title: 'q', audience: 'registration', questions: [{ ...q, showIf: undefined }] }] };
  const first = validateAnswers(single, { [q.id]: answers[q.id] }).errors[0];
  return first ? humanError(q, first.slice(q.label.length + 1)) : undefined;
}

/** "3 partes · cerca de 5 minutos" */
export function formSize(form: IntakeForm): string {
  const parts = form.sections.length;
  const minutes = Math.max(2, Math.round(questionsOf(form).length / 5));
  return `${parts} ${parts === 1 ? 'parte' : 'partes'} · cerca de ${minutes} minutos`;
}
