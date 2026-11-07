import { describe, expect, it } from 'vitest';
import { answerText, starterForm, validateAnswers, validateForm, type IntakeForm } from '../../supabase/functions/_shared/intakeForm';

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

  it('formats answers for review', () => {
    expect(answerText('1990-05-20')).toBe('20/05/1990');
    expect(answerText(['A', 'B'])).toBe('A, B');
    expect(answerText(true)).toBe('Sim');
  });
});
