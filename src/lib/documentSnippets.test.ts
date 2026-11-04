import { describe, expect, it } from 'vitest';
import { parseSnippetItems, snippetErrorMessage, snippetItemsFrom } from './documentSnippets';

describe('prescription template helpers', () => {
  it('reads only named items from the stored json', () => {
    expect(
      parseSnippetItems([
        { name: ' Medicamento sintético ', dosage: '1 cápsula' },
        { name: '' },
        { dosage: 'sem nome' },
        'texto',
        null,
        { name: 'Outro', instructions: 'de 8 em 8 horas', dosage: 5 },
      ]),
    ).toEqual([
      { name: 'Medicamento sintético', dosage: '1 cápsula', instructions: '' },
      { name: 'Outro', dosage: '', instructions: 'de 8 em 8 horas' },
    ]);
    expect(parseSnippetItems({ name: 'objeto' })).toEqual([]);
  });

  it('builds items from 1 to 15 named medications only', () => {
    expect(snippetItemsFrom([{ name: ' A ', dosage: ' 1 ', instructions: ' x ' }])).toEqual([
      { name: 'A', dosage: '1', instructions: 'x' },
    ]);
    expect(snippetItemsFrom([])).toBeNull();
    expect(snippetItemsFrom([{ name: 'A' }, { name: '  ' }])).toBeNull();
    expect(snippetItemsFrom(Array.from({ length: 16 }, (_, i) => ({ name: `Item ${i}` })))).toBeNull();
  });

  it('maps refusals to messages a doctor can act on', () => {
    expect(snippetErrorMessage({ code: '22023', message: 'Informe um nome de até 120 caracteres para o modelo' })).toBe(
      'Informe um nome de até 120 caracteres para o modelo',
    );
    expect(snippetErrorMessage({ code: '40001', message: 'O modelo foi alterado em outra sessão; abra de novo' })).toMatch(/outra sessão/);
    expect(snippetErrorMessage({ code: '40001', message: 'Custody changed concurrently; retry the transaction' })).toBe(
      'Outra operação estava em andamento. Tente de novo.',
    );
    expect(snippetErrorMessage({ code: '42501', message: 'Verifique o segundo fator da sessão' })).toMatch(/segundo fator/);
    expect(snippetErrorMessage({ code: 'XX000', message: 'internal detail' })).toBe('Não foi possível salvar o modelo. Tente novamente.');
  });
});

describe('compounded formulas in templates', () => {
  const formula = { components: [{ substance: 'Substância sintética', amount: '100 mg' }], form: 'cápsula', quantity: '30 cápsulas' };
  it('keeps a valid formula when reading and saving, and drops an invalid one when reading', () => {
    expect(parseSnippetItems([{ name: 'Fórmula', dosage: '1 cápsula', instructions: 'à noite', formula }])).toEqual([
      { name: 'Fórmula', dosage: '1 cápsula', instructions: 'à noite', formula },
    ]);
    expect(parseSnippetItems([{ name: 'Fórmula', formula: { ...formula, quantity: 'muitas' } }])).toEqual([{ name: 'Fórmula', dosage: '', instructions: '' }]);
    expect(snippetItemsFrom([{ name: 'Fórmula', dosage: '1 cápsula', instructions: 'à noite', formula }])).toEqual([
      { name: 'Fórmula', dosage: '1 cápsula', instructions: 'à noite', formula },
    ]);
    expect(snippetItemsFrom([{ name: 'Fórmula', formula: { ...formula, components: [] } }])).toBeNull();
  });
});
