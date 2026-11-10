import { describe, expect, it } from 'vitest';
import { managedDocumentMessage, managedWhatsAppReason } from './managedSetupMessages';
describe('managed setup directions for existing document validation', () => {
  it.each([
    ['Informe o telefone profissional em Configurações (ícone de engrenagem): ele é obrigatório na receita de antimicrobiano.', 'telefone'],
    ['Anabolizante (lista C5): informe o seu CPF em Configurações (Lei 9.965/2000).', 'CPF'],
    ['Anabolizante (lista C5): informe o telefone profissional em Configurações (Lei 9.965/2000).', 'telefone'],
  ])('routes the legacy producer refusal %s to implementation', (message, field) => {
    const result = managedDocumentMessage(message);
    expect(result).toContain(field); expect(result).toContain('equipe de implantação'); expect(result).not.toContain('em Configurações');
  });
  it.each(['Informe o CPF do paciente no cadastro.', 'O certificado está vencido.', 'Informe o CID.', 'Sem conexão.'])('preserves unrelated validation: %s', message => {
    expect(managedDocumentMessage(message)).toBe(message);
  });
});

describe('WhatsApp delivery reasons respect technical ownership', () => {
  it.each([
    'O token do WhatsApp expirou ou foi revogado. Reconecte o número em Configurações.',
    'O token não tem permissão para este número. Confira as permissões whatsapp_business_messaging e whatsapp_business_management.',
    'O WhatsApp recusou os dados enviados. Confira o ID do número e da conta.',
    'O número ainda não está registrado na Cloud API.',
  ])('routes connection refusal to implementation: %s', reason => {
    const result = managedWhatsAppReason(reason);
    expect(result).toContain('equipe de implantação'); expect(result).toContain('não foi concluído'); expect(result).not.toContain('Configurações');
  });
  it.each(['Passaram mais de 24 horas desde a última mensagem do paciente. Use um modelo aprovado.', 'O número não pode receber mensagens pelo WhatsApp.', 'Limite de envio do WhatsApp atingido. Tente de novo em instantes.', 'Sem consentimento para contato.'])('keeps operational information: %s', reason => {
    expect(managedWhatsAppReason(reason)).toBe(reason);
  });
});
