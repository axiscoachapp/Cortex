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
    // The licence number points at the doctor as surely as the name: it goes too.
    expect(scrubber.scrub('Dra. Helena Fictícia Exemplo CRM 0000')).toBe('Médica A CRM [documento]');
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
  describe('names typed in lower case, as old notes often are', () => {
    const clean = (text) => scrubber.scrub(text);
    it('takes a name of the registration after a title, with the names that follow', () => {
      expect(clean('colonoscopia : dr carlos, 2016')).toBe('colonoscopia : dr [nome], 2016');
      expect(clean('pre op com dra joana lemos no cardio')).toBe('pre op com dra [nome] no cardio');
      expect(clean('foi no dr antunes : cardio, com oscilações')).toBe('foi no dr [nome] : cardio, com oscilações');
      // A specialty or a verb after the title is not a name.
      expect(clean('enc dr cardio e dra pediu exames')).toBe('enc dr cardio e dra pediu exames');
    });
    it('takes a first name after "com", "para" or a kinship word, and a signature at the end of a line', () => {
      expect(clean('repetir eco tv com joana, em 15/7')).toBe('repetir eco tv com [nome], em 15/7');
      expect(clean('HTC com o carlos AP = leiomioma')).toBe('HTC com o [nome] AP = leiomioma');
      expect(clean('ex de imagem enc para marta')).toBe('ex de imagem enc para [nome]');
      expect(clean('O POSITIVO!!! pai carlos 62000')).toBe('O POSITIVO!!! pai [nome] 62000');
      expect(clean('exs lab para dst : ok. marta\nretorno em 6 meses')).toBe('exs lab para dst : ok. [nome]\nretorno em 6 meses');
      expect(clean('cvo : neg malignidade, joana')).toBe('cvo : neg malignidade, [nome]');
    });
    it('takes a first name with a surname, and first names listed together', () => {
      expect(clean('massa óssea - joana antunes : fibromialgia')).toBe('massa óssea - [nome] : fibromialgia');
      expect(clean('era carlos / marta O POSITIVO')).toBe('era [nome] / [nome] O POSITIVO');
    });
    it('leaves a lower-case word alone when nothing says it is a person', () => {
      // "joana" with no cue, a surname that is an ordinary word, a medicine, a word after "com".
      expect(clean('utero joana vf')).toBe('utero joana vf');
      expect(clean('julia leite materno exclusivo')).toBe('julia leite materno exclusivo');
      expect(clean('anticoncepção com yasmin há 2 anos')).toBe('anticoncepção com yasmin há 2 anos');
      expect(clean('com dores e com pontos ok')).toBe('com dores e com pontos ok');
      expect(clean('usa flora intestinal, rosa mosqueta')).toBe('usa flora intestinal, rosa mosqueta');
    });
    it('takes a name the registration never saw after a title, but not a specialty or a verb', () => {
      expect(clean('trissomia 21, dr lucar cardio exame')).toBe('trissomia 21, dr [nome] cardio exame');
      expect(clean('DR. YASMIN ROSA DE LEMOS : cardio')).toBe('DR. [nome] : cardio');
      expect(clean('dra explicou o exame; dr pediatra liberou; dra dentista')).toBe('dra explicou o exame; dr pediatra liberou; dra dentista');
    });
    it('takes whoever is said to be someone\'s, or is followed by the kinship', () => {
      expect(clean('veio com mulher do antunes')).toBe('veio com mulher do [nome]');
      expect(clean('espermograma para o pereira esposo')).toBe('espermograma para o [nome] esposo');
      expect(clean('disse que o carlos prescreve manipulada')).toBe('disse que o [nome] prescreve manipulada');
      expect(clean('repetiu eco com a Cris e ela só escreveu')).toBe('repetiu eco com a [nome] e ela só escreveu');
      expect(clean('hidrossalpinge =eco tv carlos=ovarios')).toBe('hidrossalpinge =eco tv [nome]=ovarios');
      // A title in Title Case is not a person; neither is a common word after the article.
      expect(clean('Retorno com Exames e para Controle')).toBe('Retorno com Exames e para Controle');
      expect(clean('encaminho para o hospital e para a rotina')).toBe('encaminho para o hospital e para a rotina');
    });
    it('removes a licence number, a stamp with initials, a mobile without separators and names beside a telephone', () => {
      expect(clean('H.F.Exemplo CRM 16544')).toBe('Médica A CRM [documento]');
      expect(clean('CRM-PR 12.345 e CRM: 9876')).toBe('CRM [documento] e CRM [documento]');
      expect(clean('IVANA HUBBE : 991839523 SYLVIA BRANDT : 3242 - 4749 ( BAIRRO )')).toBe('[nome] : [telefone] [nome] : [telefone] ( BAIRRO )');
      // Not a telephone: two years, an exam number with nine digits that does not start like a mobile.
      expect(clean('de 2019 - 2021; protocolo 223344556')).toBe('de 2019 - 2021; protocolo 223344556');
    });
    it('removes the name of the place where someone works or studies, and keeps the kind of work', () => {
      expect(clean('Trabalha na Empresa Inventada. Faz administração na FAE.')).toBe('Trabalha na [local]. Faz administração na [local].');
      expect(clean('estuda no Colégio Inventado de Curitiba, 2º ano')).toBe('estuda no [local] de Curitiba, 2º ano');
      expect(clean('trabalha na área da saúde e estuda em casa')).toBe('trabalha na área da saúde e estuda em casa');
    });
    it('keeps two people apart when a title stands between them', () => {
      expect(clean('DRA. JOANA LEMOS DRA. MARTA ANTUNES 3222 - 9999')).toBe('DRA. [nome] DRA. [nome] [telefone]');
    });
    it('keeps a name that is also an ordinary word inside a run of names', () => {
      expect(clean('o Sr Carlos ROSA ANTUNES está neste dia')).toBe('o Sr [nome] está neste dia');
      // Alone after a name, the ordinary word stays.
      expect(clean('Joana ROSA mosqueta')).toBe('[nome] ROSA mosqueta');
    });
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
