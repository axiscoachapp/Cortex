import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBatchXml, checkBatch, crc32, latin1, md5, tissText, zipOne, type TissBatch } from '../../supabase/functions/_shared/tiss';

// Synthetic identifiers only (registro ANS 999999, prestador 123456, carteirinha de zeros).
const base = (over: Partial<TissBatch> = {}): TissBatch => ({
  version: '4.03.00', ansRegistry: '999999', batchNumber: 1, guideType: 'consulta', date: '2026-11-07', time: '10:30:00', hashEncoding: 'latin1',
  provider: { providerCode: '123456', cnes: '9999999', legalName: 'CLINICA FICTICIA LTDA' },
  guides: [{
    guideNumber: '1', cardNumber: '00000000000000000', newborn: false, serviceDate: '2026-11-06',
    professional: { name: 'MEDICA FICTICIA', council: '06', councilNumber: '00000', uf: '41', cbo: '225250' },
    tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório', quantity: 1, unitAmount: 150, consultationType: '1',
  }],
  ...over,
});

// The consultation batch built by the research and validated against the official XSD 4.03.00
// (docs/product/faturamento/pesquisa/TISS_PESQUISA.md), byte for byte.
const SAMPLE = '<?xml version="1.0" encoding="ISO-8859-1"?>\n<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao><ans:sequencialTransacao>1</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-11-07</ans:dataRegistroTransacao><ans:horaRegistroTransacao>10:30:00</ans:horaRegistroTransacao></ans:identificacaoTransacao><ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>123456</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>999999</ans:registroANS></ans:destino><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho><ans:prestadorParaOperadora><ans:loteGuias><ans:numeroLote>1</ans:numeroLote><ans:guiasTISS><ans:guiaConsulta><ans:cabecalhoConsulta><ans:registroANS>999999</ans:registroANS><ans:numeroGuiaPrestador>1</ans:numeroGuiaPrestador></ans:cabecalhoConsulta><ans:dadosBeneficiario><ans:numeroCarteira>00000000000000000</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario><ans:contratadoExecutante><ans:codigoPrestadorNaOperadora>123456</ans:codigoPrestadorNaOperadora><ans:CNES>9999999</ans:CNES></ans:contratadoExecutante><ans:profissionalExecutante><ans:nomeProfissional>MEDICA FICTICIA</ans:nomeProfissional><ans:conselhoProfissional>06</ans:conselhoProfissional><ans:numeroConselhoProfissional>00000</ans:numeroConselhoProfissional><ans:UF>41</ans:UF><ans:CBOS>225250</ans:CBOS></ans:profissionalExecutante><ans:indicacaoAcidente>9</ans:indicacaoAcidente><ans:dadosAtendimento><ans:regimeAtendimento>01</ans:regimeAtendimento><ans:dataAtendimento>2026-11-06</ans:dataAtendimento><ans:tipoConsulta>1</ans:tipoConsulta><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>10101012</ans:codigoProcedimento><ans:valorProcedimento>150.00</ans:valorProcedimento></ans:procedimento></ans:dadosAtendimento></ans:guiaConsulta></ans:guiasTISS></ans:loteGuias></ans:prestadorParaOperadora><ans:epilogo><ans:hash>0fce16173a551ed979ad09b71f710627</ans:hash></ans:epilogo></ans:mensagemTISS>';

describe('TISS batch', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(md5(new Uint8Array())).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(new TextEncoder().encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('rebuilds the XSD-validated consultation sample exactly, hash included', () => {
    const r = buildBatchXml(base());
    expect(r.xml).toBe(SAMPLE);
    expect(r.hash).toBe('0fce16173a551ed979ad09b71f710627');
    expect(r.fileName).toBe('00000000000000000001_0fce16173a551ed979ad09b71f710627.xml');
  });

  it('hashes accented text in ISO-8859-1 by default, and in UTF-8 when the payer asks', () => {
    const sadt = base({ guideType: 'sadt', guides: [{ ...base().guides[0], procedureCode: '41301102', description: 'Colposcopia (cérvice uterina e vagina)', consultationType: undefined, unitAmount: 80 }] });
    const l = buildBatchXml(sadt);
    const u = buildBatchXml({ ...sadt, hashEncoding: 'utf8' });
    expect(l.hash).not.toBe(u.hash);
    expect(l.bytes[l.xml.indexOf('é')]).toBe(0xe9);
    expect(l.xml).toContain('<ans:guiaSP-SADT>');
    expect(l.xml).toContain('<ans:valorTotalGeral>80.00</ans:valorTotalGeral>');
    expect(l.xml).not.toContain('nomeBeneficiario');
  });

  it('refuses batches the portal would reject', () => {
    const g = base().guides[0];
    expect(checkBatch(base({ ansRegistry: '12345' }))).toContain('Registro ANS do convênio precisa ter 6 dígitos.');
    expect(checkBatch(base({ guides: [g, g] }))).toEqual(expect.arrayContaining([expect.stringContaining('repetido')]));
    expect(checkBatch(base({ guides: [{ ...g, consultationType: undefined }] }))).toEqual(['Guia 1: informe o tipo de consulta.']);
    expect(checkBatch(base({ guides: Array.from({ length: 101 }, (_, i) => ({ ...g, guideNumber: String(i + 1) })) }))).toContain('Um lote tem de 1 a 100 guias.');
    expect(checkBatch(base({ guides: [{ ...g, professional: { ...g.professional, uf: 'PR' } }] }))).toEqual([expect.stringContaining('UF (código IBGE)')]);
    expect(() => buildBatchXml(base({ provider: { ...base().provider, cnes: '' } }))).toThrow('CNES');
  });

  it('escapes XML and keeps only Latin-1 text', () => {
    expect(tissText('  Dra.\tAna  & <Exemplo> 😀 ', 70)).toBe('Dra. Ana & <Exemplo>');
    const r = buildBatchXml(base({ guides: [{ ...base().guides[0], professional: { ...base().guides[0].professional, name: 'Dra. Ana & Filhos <SA>' } }] }));
    expect(r.xml).toContain('<ans:nomeProfissional>Dra. Ana &amp; Filhos &lt;SA&gt;</ans:nomeProfissional>');
    expect([...latin1('ç€')]).toEqual([0xe7, 0x3f]);
  });

  it('zips one stored file with the right CRC', () => {
    const data = new TextEncoder().encode('conteudo sintetico');
    const z = zipOne('lote.xml', data, new Date(2026, 10, 7, 10, 30, 0));
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(data));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });

  // Writes generated batches for the external XSD check (scripts in the session scratchpad).
  it('writes generated samples when TISS_SAMPLES_DIR is set', () => {
    const dir = process.env.TISS_SAMPLES_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const g = base().guides[0];
    const consulta = buildBatchXml(base({ batchNumber: 7, guides: [g, { ...g, guideNumber: '2', consultationType: '3', newborn: true, authorization: { number: 'AUT123' } }] }));
    const sadt = buildBatchXml(base({ batchNumber: 8, guideType: 'sadt', guides: [
      { ...g, procedureCode: '41301102', description: 'Colposcopia (cérvice uterina e vagina)', consultationType: undefined, unitAmount: 80,
        authorization: { number: '987654', password: 'ABC123', date: '2026-11-05', validUntil: '2026-12-05' } },
      { ...g, guideNumber: '3', procedureCode: '40901300', description: 'US transvaginal', consultationType: undefined, quantity: 2, unitAmount: 95.5 }] }));
    writeFileSync(join(dir, 'gerado_consulta.xml'), consulta.bytes);
    writeFileSync(join(dir, 'gerado_sadt.xml'), sadt.bytes);
  });
});
