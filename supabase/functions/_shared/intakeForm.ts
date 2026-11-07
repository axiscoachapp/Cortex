/**
 * Pre-consultation form ("pré-consulta"): definition, starter form and answer validation.
 * Pure module, shared by the Edge Functions and the app (editor preview and the public page),
 * so what the patient sees and what the server accepts follow the same rules.
 * Contract: docs/product/pre-consulta/CONTRATO.md.
 */

export type QuestionType = 'text' | 'textarea' | 'date' | 'choice' | 'multi' | 'yesno' | 'cpf' | 'email' | 'phone' | 'cep' | 'number';

/** Registration answers that map to a known field (reception review, insurance in billing). */
export type RegistrationField =
  | 'name' | 'social_name' | 'birth_date' | 'cpf' | 'email' | 'phone'
  | 'cep' | 'street' | 'complement' | 'district' | 'city' | 'state'
  | 'insurance_type' | 'insurance_payer' | 'insurance_plan' | 'insurance_card' | 'insurance_card_valid_until'
  | 'emergency_contact';

export interface IntakeQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  options?: string[];
  help?: string;
  field?: RegistrationField;
  /** Shown (and validated) only when another question of the form has this exact answer. */
  showIf?: { question: string; equals: string };
}

/** `registration`: seen by the reception. `health`: seen only by the appointment's doctor. */
export interface IntakeSection { id: string; title: string; audience: 'registration' | 'health'; questions: IntakeQuestion[] }

export interface IntakeForm { intro: string; thanks: string; sections: IntakeSection[] }

export interface AnswerItem { id: string; label: string; value: string | string[] | boolean | number; field?: RegistrationField }

export const TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Texto curto', textarea: 'Texto longo', date: 'Data', choice: 'Uma opção', multi: 'Várias opções', yesno: 'Sim ou não',
  cpf: 'CPF', email: 'E-mail', phone: 'Telefone', cep: 'CEP', number: 'Número',
};

export const FIELD_LABELS: Record<RegistrationField, string> = {
  name: 'Nome completo', social_name: 'Nome social', birth_date: 'Data de nascimento', cpf: 'CPF', email: 'E-mail', phone: 'Telefone',
  cep: 'CEP', street: 'Endereço', complement: 'Complemento', district: 'Bairro', city: 'Cidade', state: 'UF',
  insurance_type: 'Particular ou convênio', insurance_payer: 'Convênio (operadora)', insurance_plan: 'Plano',
  insurance_card: 'Número da carteirinha', insurance_card_valid_until: 'Validade da carteirinha', emergency_contact: 'Contato de emergência',
};

export const LIMITS = { sections: 12, questions: 60, label: 200, help: 300, options: 20, option: 80, text: 200, textarea: 2000, intro: 1500 };
const ID = /^[a-z0-9_]{1,40}$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Errors in plain Portuguese; empty when the form can be saved. */
export function validateForm(form: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(form)) return ['Formulário inválido.'];
  const f = form as unknown as IntakeForm;
  if (typeof f.intro !== 'string' || f.intro.length > LIMITS.intro) errors.push('A apresentação precisa ter até 1.500 caracteres.');
  if (typeof f.thanks !== 'string' || f.thanks.length > LIMITS.intro) errors.push('A mensagem final precisa ter até 1.500 caracteres.');
  if (!Array.isArray(f.sections) || f.sections.length === 0) return [...errors, 'Inclua pelo menos uma seção.'];
  if (f.sections.length > LIMITS.sections) errors.push(`Use até ${LIMITS.sections} seções.`);
  const ids = new Set<string>();
  const all: IntakeQuestion[] = [];
  const sectionIds = new Set<string>();
  for (const s of f.sections) {
    if (!isPlainObject(s) || typeof s.id !== 'string' || !ID.test(s.id) || sectionIds.has(s.id)) { errors.push('Seção com identificador inválido.'); continue; }
    sectionIds.add(s.id);
    if (typeof s.title !== 'string' || !s.title.trim() || s.title.length > 80) errors.push('Toda seção precisa de um título de até 80 caracteres.');
    if (s.audience !== 'registration' && s.audience !== 'health') errors.push(`A seção "${s.title}" precisa dizer quem vê as respostas.`);
    if (!Array.isArray(s.questions) || s.questions.length === 0) { errors.push(`A seção "${s.title}" está vazia.`); continue; }
    for (const q of s.questions) {
      if (!isPlainObject(q) || typeof q.id !== 'string' || !ID.test(q.id)) { errors.push(`Pergunta com identificador inválido em "${s.title}".`); continue; }
      if (ids.has(q.id)) errors.push(`A pergunta "${q.label}" repete um identificador.`);
      ids.add(q.id);
      all.push(q);
      if (typeof q.label !== 'string' || !q.label.trim() || q.label.length > LIMITS.label) errors.push('Toda pergunta precisa de um texto de até 200 caracteres.');
      if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, q.type)) errors.push(`A pergunta "${q.label}" tem um tipo desconhecido.`);
      if (q.help !== undefined && (typeof q.help !== 'string' || q.help.length > LIMITS.help)) errors.push(`A ajuda de "${q.label}" é longa demais.`);
      if (q.type === 'choice' || q.type === 'multi') {
        const opts = q.options;
        if (!Array.isArray(opts) || opts.length < 2 || opts.length > LIMITS.options
            || opts.some((o) => typeof o !== 'string' || !o.trim() || o.length > LIMITS.option) || new Set(opts).size !== opts.length) {
          errors.push(`"${q.label}" precisa de 2 a ${LIMITS.options} opções diferentes.`);
        }
      } else if (q.options !== undefined) errors.push(`"${q.label}" não usa opções.`);
      if (q.field !== undefined) {
        if (s.audience !== 'registration') errors.push(`"${q.label}" é um dado cadastral e precisa ficar numa seção da recepção.`);
        if (!Object.prototype.hasOwnProperty.call(FIELD_LABELS, q.field)) errors.push(`"${q.label}" usa um campo desconhecido.`);
      }
    }
  }
  if (all.length > LIMITS.questions) errors.push(`Use até ${LIMITS.questions} perguntas.`);
  const fields = all.filter((q) => q.field).map((q) => q.field);
  if (new Set(fields).size !== fields.length) errors.push('Cada campo cadastral só pode aparecer em uma pergunta.');
  const audienceOf = new Map<string, string>();
  for (const s of f.sections) for (const q of s.questions ?? []) audienceOf.set(q?.id, s.audience);
  for (const q of all) {
    if (!q.showIf) continue;
    const ref = all.find((r) => r.id === q.showIf!.question);
    if (!ref || ref.id === q.id) { errors.push(`"${q.label}" depende de uma pergunta que não existe.`); continue; }
    if ((ref.type === 'choice' || ref.type === 'multi') && !ref.options?.includes(q.showIf.equals))
      errors.push(`"${q.label}" depende de uma resposta que não está entre as opções de "${ref.label}".`);
    // Whether a reception question is shown would reveal a health answer to the reception.
    if (audienceOf.get(q.id) === 'registration' && audienceOf.get(ref.id) === 'health')
      errors.push(`"${q.label}" é vista pela recepção e não pode depender de uma resposta de saúde ("${ref.label}").`);
    const seen = new Set([q.id]);
    for (let cur: IntakeQuestion | undefined = ref; cur?.showIf; cur = all.find((r) => r.id === cur!.showIf!.question)) {
      if (seen.has(cur.id)) { errors.push(`"${q.label}" faz parte de uma cadeia de condições que volta a si mesma.`); break; }
      seen.add(cur.id);
    }
  }
  return errors;
}

function validCpf(value: string): boolean {
  const d = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let total = 0;
    for (let i = 0; i < n; i++) total += Number(d[i]) * (n + 1 - i);
    const digit = (total * 10) % 11 % 10;
    if (digit !== Number(d[n])) return false;
  }
  return true;
}

function validDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T12:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const year = Number(v.slice(0, 4));
  return new Date(t).toISOString().slice(0, 10) === v && year >= 1900 && year <= 2100;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Whether a question is shown, given the answers so far. A condition holds only if the question it
 * depends on is itself shown, so hiding a parent hides the whole chain (an answer left in a hidden
 * question never keeps its children on screen). Cycles are refused by validateForm; the depth limit
 * only guards a corrupted definition.
 */
export function isVisible(form: IntakeForm, q: IntakeQuestion, answers: Record<string, unknown>, depth = 0): boolean {
  if (!q.showIf) return true;
  if (depth > 12) return false;
  const parent = form.sections.flatMap((s) => s.questions).find((x) => x.id === q.showIf!.question);
  if (!parent || !isVisible(form, parent, answers, depth + 1)) return false;
  const a = answers[parent.id];
  return Array.isArray(a) ? a.includes(q.showIf.equals) : a === q.showIf.equals;
}

/** Normalizes one answer, or returns an error message. */
function checkAnswer(q: IntakeQuestion, raw: unknown): { value?: AnswerItem['value']; error?: string } {
  const bad = (msg: string) => ({ error: `${q.label}: ${msg}` });
  switch (q.type) {
    case 'text': case 'textarea': {
      if (typeof raw !== 'string') return bad('resposta inválida.');
      const v = raw.trim();
      const max = q.type === 'text' ? LIMITS.text : LIMITS.textarea;
      return v.length > max ? bad(`use até ${max} caracteres.`) : { value: v };
    }
    case 'date':
      return typeof raw === 'string' && validDate(raw) ? { value: raw } : bad('data inválida.');
    case 'choice':
      return typeof raw === 'string' && q.options?.includes(raw) ? { value: raw } : bad('escolha uma das opções.');
    case 'multi':
      return Array.isArray(raw) && raw.every((x) => typeof x === 'string' && q.options?.includes(x)) && new Set(raw).size === raw.length
        ? { value: raw as string[] } : bad('escolha entre as opções.');
    case 'yesno':
      return typeof raw === 'boolean' ? { value: raw } : bad('responda sim ou não.');
    case 'cpf':
      return typeof raw === 'string' && validCpf(raw) ? { value: raw.replace(/\D/g, '') } : bad('CPF inválido.');
    case 'email':
      return typeof raw === 'string' && raw.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim()) ? { value: raw.trim().toLowerCase() } : bad('e-mail inválido.');
    case 'phone': {
      const d = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
      return d.length >= 10 && d.length <= 13 ? { value: d } : bad('telefone inválido.');
    }
    case 'cep': {
      const d = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
      return d.length === 8 ? { value: d } : bad('CEP inválido.');
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      return Number.isInteger(n) && n >= 0 && n <= 999 ? { value: n } : bad('número inválido.');
    }
  }
}

/**
 * Validates the patient's answers against the form snapshot. Unknown or hidden answers are
 * refused, required visible questions must be answered, and the answers are split by audience.
 */
export function validateAnswers(form: IntakeForm, answers: unknown): { registration: AnswerItem[]; health: AnswerItem[]; errors: string[] } {
  const out = { registration: [] as AnswerItem[], health: [] as AnswerItem[], errors: [] as string[] };
  if (!isPlainObject(answers)) return { ...out, errors: ['Respostas inválidas.'] };
  const questions = form.sections.flatMap((s) => s.questions.map((q) => ({ q, audience: s.audience })));
  const known = new Set(questions.map(({ q }) => q.id));
  for (const key of Object.keys(answers)) if (!known.has(key)) out.errors.push('Há uma resposta para uma pergunta que não existe.');
  for (const { q, audience } of questions) {
    const raw = answers[q.id];
    if (!isVisible(form, q, answers)) {
      if (!empty(raw)) out.errors.push(`${q.label}: esta pergunta não se aplica.`);
      continue;
    }
    if (empty(raw)) {
      if (q.required) out.errors.push(`${q.label}: resposta obrigatória.`);
      continue;
    }
    const r = checkAnswer(q, raw);
    if (r.error) { out.errors.push(r.error); continue; }
    if (q.type === 'text' || q.type === 'textarea') {
      if (r.value === '') { if (q.required) out.errors.push(`${q.label}: resposta obrigatória.`); continue; }
    }
    const item: AnswerItem = { id: q.id, label: q.label, value: r.value!, ...(q.field ? { field: q.field } : {}) };
    (audience === 'registration' ? out.registration : out.health).push(item);
  }
  return out;
}

/** Text shown for an answer in the review screens. */
export function answerText(v: AnswerItem['value']): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return String(v);
}

/** Starter form for a gynecology/obstetrics and urology clinic; the admin edits it before enabling. */
export function starterForm(clinicName: string): IntakeForm {
  const convenio = { question: 'tipo_atendimento', equals: 'Convênio' };
  return {
    intro: `Para agilizar o seu atendimento${clinicName ? ` na ${clinicName}` : ''}, responda estas perguntas antes da consulta. Leva cerca de 5 minutos.`,
    thanks: 'Obrigado! Recebemos suas respostas. A recepção confere seus dados e o médico lê o restante antes da consulta.',
    sections: [
      {
        id: 'dados', title: 'Seus dados', audience: 'registration', questions: [
          { id: 'nome', label: 'Nome completo', type: 'text', required: true, field: 'name' },
          { id: 'nome_social', label: 'Nome social (como prefere ser chamado)', type: 'text', field: 'social_name' },
          { id: 'nascimento', label: 'Data de nascimento', type: 'date', required: true, field: 'birth_date' },
          { id: 'cpf', label: 'CPF', type: 'cpf', required: true, field: 'cpf' },
          { id: 'email', label: 'E-mail', type: 'email', field: 'email' },
          { id: 'cep', label: 'CEP', type: 'cep', field: 'cep' },
          { id: 'endereco', label: 'Endereço (rua e número)', type: 'text', field: 'street' },
          { id: 'complemento', label: 'Complemento', type: 'text', field: 'complement' },
          { id: 'bairro', label: 'Bairro', type: 'text', field: 'district' },
          { id: 'cidade', label: 'Cidade', type: 'text', field: 'city' },
          { id: 'uf', label: 'UF', type: 'text', field: 'state' },
          { id: 'emergencia', label: 'Contato de emergência (nome e telefone)', type: 'text', field: 'emergency_contact' },
        ],
      },
      {
        id: 'convenio', title: 'Convênio', audience: 'registration', questions: [
          { id: 'tipo_atendimento', label: 'A consulta é particular ou pelo convênio?', type: 'choice', required: true, options: ['Particular', 'Convênio'], field: 'insurance_type' },
          { id: 'operadora', label: 'Nome do convênio', type: 'text', required: true, field: 'insurance_payer', showIf: convenio },
          { id: 'plano', label: 'Plano', type: 'text', field: 'insurance_plan', showIf: convenio },
          { id: 'carteirinha', label: 'Número da carteirinha', type: 'text', required: true, field: 'insurance_card', showIf: convenio },
          { id: 'validade', label: 'Validade da carteirinha', type: 'date', field: 'insurance_card_valid_until', showIf: convenio },
        ],
      },
      {
        id: 'saude', title: 'Sobre a consulta', audience: 'health', questions: [
          { id: 'motivo', label: 'Qual o motivo da consulta?', type: 'textarea', required: true },
          { id: 'medicamentos', label: 'Usa algum medicamento? Quais e em que dose?', type: 'textarea' },
          { id: 'alergias', label: 'Tem alergia a algum medicamento ou substância?', type: 'textarea' },
          { id: 'condicoes', label: 'Tem alguma destas condições?', type: 'multi',
            options: ['Pressão alta', 'Diabetes', 'Doença da tireoide', 'Asma', 'Depressão ou ansiedade', 'Nenhuma destas'] },
          { id: 'cirurgias', label: 'Já fez alguma cirurgia? Quais e quando?', type: 'textarea' },
          { id: 'dum', label: 'Data da última menstruação', type: 'date', help: 'Deixe em branco se não se aplica.' },
          { id: 'gestacoes', label: 'Quantas gestações já teve?', type: 'number', help: 'Deixe em branco se não se aplica.' },
          { id: 'observacoes', label: 'Quer contar mais alguma coisa ao médico?', type: 'textarea' },
        ],
      },
    ],
  };
}
