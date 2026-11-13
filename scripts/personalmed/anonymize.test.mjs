import { describe, expect, it } from 'vitest';
import { buildNameDictionary, coarseBirthDate, createScrubber, foldSameLength } from './anonymize.mjs';

// Invented people only.
const dictionary = buildNameDictionary([
  ...Array(3).fill('Joana Pereira Lemos'), ...Array(3).fill('Carlos Antunes Lemos'), ...Array(3).fill('Marta Antunes Pereira'),
  ...Array(3).fill('Rosa Lemos Antunes'), ...Array(3).fill('Joana Leite Pinto Costa'), ...Array(3).fill('Yasmin Pereira Lemos'), ...Array(3).fill('Flora Antunes'), ...Array(3).fill('Ana Lemos'),
]);
const scrubber = createScrubber({
  label: 'Paciente 1',
  name: 'Beatriz Sintética de Almeida Exemplo',
  relatives: ['Marta Sintética Exemplo', 'Carlos Exemplo de Almeida'],
  digits: ['529.982.247-25', '12.345.678-9', '0 123 456789012 3'],
  phones: ['(41) 99876-5432', '3222-1100'],
  emails: ['bia.exemplo@correio.test'],
  streets: ['Rua das Araucárias Inventadas, 120'],
  birthDate: '1988-03-07',
  doctors: [{ label: 'Médica A', names: ['Helena Fictícia Exemplo'] }],
  protectedTokens: ['exemplo', 'helena', 'ficticia'],
  dictionary,
  clinicalTokens: new Set(['yasmin']),
});

describe('offsets survive folding', () => {
  it('keeps one character per character', () => {
    for (const s of ['Ação é útil', 'ÁÉÍÓÚ àèìòù ç Ç ñ', 'sem acento', 'İstanbul ß 😀 fim']) expect(foldSameLength(s)).toHaveLength(s.length);
    expect(foldSameLength('AÇÃO É')).toBe('acao e');
  });
});

describe('the person, relatives and doctors', () => {
  it('replaces the full name however it is typed, and partial runs of it', () => {
    const counter = {};
    expect(scrubber.scrub('Para: BEATRIZ SINTETICA DE ALMEIDA EXEMPLO.', counter)).toBe('Para: Paciente 1.');
    expect(scrubber.scrub('Sra. Beatriz   Sintética Almeida compareceu', counter)).toBe('Sra. Paciente 1 compareceu');
    expect(scrubber.scrub('Atesto que Beatriz Exemplo esteve', counter)).toContain('Paciente 1');
    expect(counter.name).toBeGreaterThanOrEqual(2);
  });
  it('replaces the first name alone and a surname no doctor shares, but not a shared surname alone', () => {
    expect(scrubber.scrub('Beatriz refere dor.')).toBe('Paciente 1 refere dor.');
    expect(scrubber.scrub('família Sintética')).toBe('família Paciente 1');
    // A surname shared with a clinic doctor never becomes the patient; after a title it is someone's name.
    expect(scrubber.scrub('consulta da família Exemplo')).toBe('consulta da família Exemplo');
    expect(scrubber.scrub('Encaminho ao Dr. Exemplo')).toBe('Encaminho ao Dr. [nome]');
  });
  it('turns a clinic doctor into the doctor label, title included', () => {
    expect(scrubber.scrub('Dra. Helena Fictícia Exemplo CRM 0000')).toBe('Médica A CRM 0000');
    expect(scrubber.scrub('conforme Dra Helena')).toBe('conforme Médica A');
  });
  it('replaces relatives by full or partial name', () => {
    expect(scrubber.scrub('Mãe: Marta Sintética Exemplo')).toBe('Mãe: [familiar]');
    expect(scrubber.scrub('acompanhada de Carlos Exemplo')).toBe('acompanhada de [familiar]');
  });
});

describe('identifiers', () => {
  it('removes documents, phones, e-mail, street and birth date in any punctuation', () => {
    const out = scrubber.scrub('CPF 52998224725, RG 12345678-9, carteira 0123.4567.8901.23, tel 41 99876 5432 ou 32221100, bia.exemplo@correio.test, nasc. 07/03/1988 (7/3/88)\nRua das Araucárias Inventadas, 120');
    for (const leak of ['52998224725', '12345678', '0123', '99876', '3222', 'correio.test', 'Araucárias', '1988', '7/3/88']) expect(out).not.toContain(leak);
    expect(out).toContain('[data de nascimento]');
  });
  it('removes identifier shapes of anyone, but keeps a year range and clinical numbers', () => {
    expect(scrubber.scrub('contato do marido (41) 98888-7777, CPF 111.444.777-35, CEP 80000-123, outro@dominio.test')).toBe('contato do marido [telefone], CPF [CPF], CEP [CEP], [e-mail]');
    expect(scrubber.scrub('exames de 2019-2020: plaquetas 250000, PA 120/80, glicemia 92')).toBe('exames de 2019-2020: plaquetas 250000, PA 120/80, glicemia 92');
    expect(scrubber.scrub('ligar 3344-5566')).toBe('ligar [telefone]');
  });
});

describe('other people in the text', () => {
  it('replaces a first name after a kinship word and two or more names in a row', () => {
    expect(scrubber.scrub('veio com a filha Joana')).toBe('veio com a filha [nome]');
    expect(scrubber.scrub('Indicada por Carlos Antunes Lemos ontem')).toBe('Indicada por [nome] ontem');
    expect(scrubber.scrub('MARTA DE ANTUNES PEREIRA ACOMPANHA')).toBe('[nome] ACOMPANHA');
  });
  it('replaces a given name standing alone, such as a newborn noted with the birth weight', () => {
    expect(scrubber.scrub('Cesárea sem intercorrências; JOANA 3085g')).toBe('Cesárea sem intercorrências; [nome] 3085g');
    expect(scrubber.scrub('Marta veio junto na consulta')).toBe('[nome] veio junto na consulta');
  });
  it('takes the surname with the name, and a professional named after a title even when the name is unknown', () => {
    expect(scrubber.scrub('Representante Joana Dalagnol (41) 3333-4444')).toBe('Representante [nome] [telefone]');
    expect(scrubber.scrub('REUMATOLOGIA DR. ZEFERINO CHIUCHETA: 3222-0000/3018-8072')).toBe('REUMATOLOGIA DR. [nome]: [telefone]/[telefone]');
    expect(scrubber.scrub('DRA. JOANA BECKHAUSER DE CAMPOS atende às terças')).toBe('DRA. [nome] atende às terças');
    expect(scrubber.scrub('Dra. solicitou exames e Dr. orientou repouso')).toBe('Dra. solicitou exames e Dr. orientou repouso');
  });
  it('removes a street with its number, whoever lives there', () => {
    const out = scrubber.scrub('Receita\nPaciente 1\nRUA SOLDADO FULANO DE TAL 270 CASA 10\nUso interno');
    expect(out).toBe('Receita\nPaciente 1\n[endereço]\nUso interno');
    expect(scrubber.scrub('Av. das Flores, 1500 ap 32 bloco B')).toBe('[endereço]');
    expect(scrubber.scrub('mora na rua Das Acácias 55, Vila Inventada, Curitiba\nRetorno em 30 dias')).toBe('mora na [endereço]\nRetorno em 30 dias');
    expect(scrubber.scrub('PRÉ NATAL. GIPO. Parto normal')).toBe('PRÉ NATAL. GIPO. Parto normal');
    expect(scrubber.scrub('dor na rua ao caminhar 2 quadras')).toBe('dor na rua ao caminhar 2 quadras');
  });
  it('keeps a medicine, a clinical word or a three-letter acronym that is also a given name', () => {
    for (const s of ['Em uso de Yasmin há 2 anos', 'YASMIN 1 cp ao dia', 'Flora bacilar normal', 'FLORA MISTA', 'ANA reagente 1:80']) expect(scrubber.scrub(s)).toBe(s);
  });
  it('keeps clinical words that are also surnames or names', () => {
    for (const s of ['Leite materno exclusivo.', 'Uso de Diane 35 há 2 anos', 'Rosa na vulva', 'Dor em mama direita', 'ALTA HOSPITALAR']) expect(scrubber.scrub(s)).toBe(s);
  });
});

describe('leak check and birth date', () => {
  it('counts what is still there and finds nothing after scrubbing', () => {
    const raw = 'Beatriz Sintética de Almeida Exemplo, CPF 529.982.247-25, fone 99876-5432, mãe Marta Sintética Exemplo';
    expect(Object.keys(scrubber.leaks(raw)).sort()).toEqual(['document', 'full_name', 'name_run', 'name_token', 'phone', 'relative']);
    expect(scrubber.leaks(scrubber.scrub(raw))).toEqual({});
  });
  it('keeps the month of birth only', () => {
    expect(coarseBirthDate('1988-03-07')).toBe('1988-03-01');
    expect(coarseBirthDate(null)).toBeNull();
  });
});
