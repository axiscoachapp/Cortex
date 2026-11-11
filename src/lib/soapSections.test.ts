import { describe, expect, it } from 'vitest';
import { markdownToPrintHtml, parseSoapBlocks, type SoapBlock } from './soapSections';

const sections = (blocks: SoapBlock[] | null) =>
  (blocks ?? []).map((block) => (block.kind === 'section' ? `${block.letter}:${block.content}` : `text:${block.content}`));

describe('parseSoapBlocks', () => {
  it('accepts the prompt format with the colon inside the bold', () => {
    const blocks = parseSoapBlocks(
      '**S (Subjetivo):** Dor pélvica há 3 dias.\n**O (Objetivo):** PA 120x80.\n**A (Avaliação):** Dismenorreia.\n**P (Plano):** Ibuprofeno 600 mg.',
    );
    expect(sections(blocks)).toEqual([
      'S:Dor pélvica há 3 dias.',
      'O:PA 120x80.',
      'A:Dismenorreia.',
      'P:Ibuprofeno 600 mg.',
    ]);
    expect(blocks?.[0]).toMatchObject({ title: 'S (Subjetivo)' });
  });

  it.each([
    ['colon outside the bold', '**S (Subjetivo)**: queixa\n**O (Objetivo)**: exame'],
    ['letter only', '**S:** queixa\n**O:** exame'],
    ['letter with dash', '**S — Subjetivo**\nqueixa\n**O — Objetivo**\nexame'],
    ['markdown headings', '## S (Subjetivo)\nqueixa\n\n## O — Objetivo\nexame'],
    ['full words', '**Subjetivo:** queixa\n**Objetivo:** exame'],
    ['manual consultation template', 'S — Queixa e história:\nqueixa\n\nO — Exame e resultados:\nexame'],
  ])('accepts %s', (_name, text) => {
    expect(sections(parseSoapBlocks(text))).toEqual(['S:queixa', 'O:exame']);
  });

  it('keeps preamble, labelled lines and trailing notes as their own blocks', () => {
    const blocks = parseSoapBlocks(
      'Consulta de retorno.\n\n**S (Subjetivo)**: Dor pélvica há 3 dias.\n**Alergias:** dipirona (relatada hoje).\n\n**O (Objetivo)**: PA 120x80.\n\n**A (Avaliação)**: Dismenorreia.\n\n**P (Plano)**: Ibuprofeno 600 mg.\n**Atenção:** suspender se dor epigástrica.\n**Retorno:** 30 dias.',
    );
    expect(sections(blocks)).toEqual([
      'text:Consulta de retorno.',
      'S:Dor pélvica há 3 dias.',
      'text:**Alergias:** dipirona (relatada hoje).',
      'O:PA 120x80.',
      'A:Dismenorreia.',
      'P:Ibuprofeno 600 mg.',
      'text:**Atenção:** suspender se dor epigástrica.',
      'text:**Retorno:** 30 dias.',
    ]);
  });

  it('keeps multi-line section content, including inline bold that is not a label', () => {
    const blocks = parseSoapBlocks('**S:** linha 1\n**importante** linha 2\n- item\n**O:** exame');
    expect(sections(blocks)).toEqual(['S:linha 1\n**importante** linha 2\n- item', 'O:exame']);
  });

  it('does not section a note with a single SOAP header or custom template headings only', () => {
    expect(parseSoapBlocks('**S (Subjetivo):** só isto.\n**Retorno:** 30 dias')).toBeNull();
    expect(parseSoapBlocks('## Queixa principal\ndor\n## Exame físico\nnormal')).toBeNull();
    expect(parseSoapBlocks('Texto livre sem seções.')).toBeNull();
  });

  it('accounts for every non-blank character of the input', () => {
    const text = 'Intro\n**S:** a\n\n## Exame físico\nb\n**O:** c\nfim';
    const blocks = parseSoapBlocks(text)!;
    const shown = blocks.map((block) => block.content).join('');
    expect(shown.replace(/\s/g, '')).toBe('Introa##Examefísicobcfim');
  });
});

describe('markdownToPrintHtml', () => {
  it('prints bold as strong text and never leaves literal asterisks', () => {
    const html = markdownToPrintHtml('**Alergias:** dipirona\n## Conduta\n- repouso <24h>');
    expect(html).toBe('<strong>Alergias:</strong> dipirona\n<strong>Conduta</strong>\n• repouso &lt;24h&gt;');
    expect(markdownToPrintHtml('texto com ** solto')).not.toContain('**');
  });
});
