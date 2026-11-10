/** Presentation adapter for existing producers that still name self-service
 * setup fields. Validation and server ownership rules remain authoritative. */
export function managedDocumentMessage(message: string): string {
  if (message.startsWith('Informe o telefone profissional em Configurações'))
    return 'Solicite à equipe de implantação a inclusão do telefone profissional no cadastro do prescritor antes de gerar a receita.';
  if (message.startsWith('Anabolizante (lista C5): informe o seu CPF em Configurações'))
    return 'Anabolizante (lista C5): solicite à equipe de implantação a inclusão do CPF no cadastro do prescritor antes de gerar.';
  if (message.startsWith('Anabolizante (lista C5): informe o telefone profissional em Configurações'))
    return 'Anabolizante (lista C5): solicite à equipe de implantação a inclusão do telefone no cadastro do prescritor antes de gerar.';
  return message;
}

/** Keep operational delivery refusals useful without asking clinic staff to
 * repair credentials owned by implementation. */
export function managedWhatsAppReason(reason: string): string {
  if (reason.startsWith('O token do WhatsApp expirou') || reason.startsWith('O token não tem') || reason.startsWith('O WhatsApp recusou os dados enviados. Confira o ID') || reason.startsWith('O número ainda não está registrado na Cloud API'))
    return 'A conexão do WhatsApp precisa de revisão pela equipe de implantação. O envio não foi concluído.';
  return reason;
}
