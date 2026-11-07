import { describe, expect, it } from 'vitest';
import { answerText, isVisible, starterForm, validateAnswers, validateForm, type IntakeForm } from '../../supabase/functions/_shared/intakeForm';

const base = (): IntakeForm => starterForm('Clínica Exemplo');

const goodAnswers = {
  nome: 'Maria Exemplo', nascimento: '1990-05-20', cpf: '529.982.247-25', tipo_atendimento: 'Convênio', operadora: 'Operadora Exemplo',
  carteirinha: '0001 2345 6789', motivo: 'Consulta de rotina', condicoes: ['Asma'], gestacoes: '2',
};

describe('pre-consultation form', () => {
  it('ships a valid starter form with registration and health sections', () => {
    const f = base();
    expect(validateForm(f)).toEqual([]);
    expect(f.sections.map((s) => s.audience)).toEqual(['registration', 'registration', 'health']);
  });

  it('refuses broken forms: duplicated ids, a health question with a registration field, dangling conditions', () => {
    const f = base();
    f.sections[0].questions.push({ id: 'nome', label: 'Outro nome', type: 'text' });
    f.sections[2].questions.push({ id: 'cpf2', label: 'CPF de novo', type: 'cpf', field: 'cpf' });
    f.sections[1].questions[1].showIf = { question: 'tipo_atendimento', equals: 'SUS' };
    const errors = validateForm(f);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('repete um identificador'),
      expect.stringContaining('precisa ficar numa seção da recepção'),
      expect.stringContaining('Cada campo cadastral'),
      expect.stringContaining('não está entre as opções'),
    ]));
    expect(validateForm({ intro: '', thanks: '', sections: [] })).toEqual(['Inclua pelo menos uma seção.']);
  });

  it('splits valid answers by audience and normalizes values', () => {
    const r = validateAnswers(base(), goodAnswers);
    expect(r.errors).toEqual([]);
    expect(r.registration.find((a) => a.id === 'cpf')).toEqual({ id: 'cpf', label: 'CPF', value: '52998224725', field: 'cpf' });
    expect(r.registration.map((a) => a.id)).toContain('carteirinha');
    expect(r.health.map((a) => a.id)).toEqual(['motivo', 'condicoes', 'gestacoes']);
    expect(r.health.find((a) => a.id === 'gestacoes')?.value).toBe(2);
    expect(r.health.every((a) => a.field === undefined)).toBe(true);
  });

  it('requires visible questions only, and refuses answers to hidden or unknown questions', () => {
    const particular = { ...goodAnswers, tipo_atendimento: 'Particular' };
    const r = validateAnswers(base(), particular);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining('esta pergunta não se aplica')]));
    const { operadora: _o, carteirinha: _c, ...rest } = particular;
    expect(validateAnswers(base(), rest).errors).toEqual([]);
    expect(validateAnswers(base(), { ...goodAnswers, carteirinha: '' }).errors).toEqual([expect.stringContaining('Número da carteirinha: resposta obrigatória')]);
    expect(validateAnswers(base(), { ...goodAnswers, extra: 'x' }).errors).toEqual(['Há uma resposta para uma pergunta que não existe.']);
  });

  it('checks each type', () => {
    const bad = { ...goodAnswers, cpf: '111.111.111-11', nascimento: '2026-02-30', email: 'sem-arroba', cep: '123', condicoes: ['Outra'], gestacoes: '-1' };
    const errors = validateAnswers(base(), bad).errors.join(' | ');
    for (const part of ['CPF inválido', 'data inválida', 'e-mail inválido', 'CEP inválido', 'escolha entre as opções', 'número inválido']) expect(errors).toContain(part);
    expect(validateAnswers(base(), { ...goodAnswers, motivo: 'x'.repeat(2001) }).errors).toEqual([expect.stringContaining('até 2000 caracteres')]);
  });

  it('hides a whole chain when a parent hides, so a stale answer never blocks sending (review 07/11)', () => {
    const f = base();
    f.sections[1].questions.push({ id: 'qual_operadora', label: 'Qual operadora?', type: 'choice', options: ['Regional', 'Nacional'],
      showIf: { question: 'tipo_atendimento', equals: 'Convênio' } });
    f.sections[1].questions.push({ id: 'regional_qual', label: 'Qual regional?', type: 'text', required: true, showIf: { question: 'qual_operadora', equals: 'Regional' } });
    expect(validateForm(f)).toEqual([]);
    const answers = { ...goodAnswers, tipo_atendimento: 'Particular', qual_operadora: 'Regional' };
    const third = f.sections[1].questions.find((q) => q.id === 'regional_qual')!;
    expect(isVisible(f, third, answers)).toBe(false);
    const visible = Object.fromEntries(Object.entries(answers).filter(([id]) => {
      const q = f.sections.flatMap((s) => s.questions).find((x) => x.id === id);
      return q && isVisible(f, q, answers);
    }));
    const { operadora: _o, carteirinha: _c, ...rest } = visible as Record<string, unknown>;
    expect(validateAnswers(f, rest).errors).toEqual([]);
  });

  it('refuses a reception question that depends on a health answer, and condition cycles', () => {
    const f = base();
    f.sections[2].questions.push({ id: 'gravida', label: 'Está grávida?', type: 'choice', options: ['Sim', 'Não'] });
    f.sections[0].questions.push({ id: 'acompanhante', label: 'Acompanhante do pré-natal', type: 'text', showIf: { question: 'gravida', equals: 'Sim' } });
    expect(validateForm(f)).toEqual([expect.stringContaining('não pode depender de uma resposta de saúde')]);
    const g = base();
    g.sections[1].questions.push({ id: 'a1', label: 'A', type: 'choice', options: ['x', 'y'], showIf: { question: 'b1', equals: 'x' } });
    g.sections[1].questions.push({ id: 'b1', label: 'B', type: 'choice', options: ['x', 'y'], showIf: { question: 'a1', equals: 'x' } });
    expect(validateForm(g)).toEqual(expect.arrayContaining([expect.stringContaining('volta a si mesma')]));
  });

  it('formats answers for review', () => {
    expect(answerText('1990-05-20')).toBe('20/05/1990');
    expect(answerText(['A', 'B'])).toBe('A, B');
    expect(answerText(true)).toBe('Sim');
  });
});
