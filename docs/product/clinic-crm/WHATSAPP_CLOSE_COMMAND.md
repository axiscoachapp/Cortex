# K1/4e — adaptador de encerramento da conversa

Usar act/close do contrato WhatsApp v1.2 sem alterar produtor/SQL. Entrada local estrita: conversationId, revisão PostgreSQL incrementável, status open e assignedTo do detalhe fresco igual ao ator esperado. Proprietário, ator esperado e status local não entram no transporte. Corpo exato: action act, operation close, conversationId e revision.

Recibo estrito: status closed, revisão anterior+1 e assignedTo igual ao proprietário esperado (o produtor preserva a atribuição ao encerrar). Uma invocação, sem retry. Erro após início, recibo inválido ou cancelamento tardio exigem releitura antes de novo comando; nunca prometer rollback nem atualizar proprietário/estado otimisticamente. Erros locais seguros, sem texto bruto, e classe compatível com o reconciliador existente.

O SQL existente também define closed_at/closed_by e zera unread_count, sem enviar recibo externo. Esses campos não constam no recibo act: o adaptador não afirma tê-los conferido, e a futura UI deve reler detalhe/lista. Encerrar a conversa não encerra caso/ficha clínica/consulta, não agenda, não altera fila/vínculos/consentimento e não chama send/mark_read/reopen/unassign. Atribuição permanece.

Elegibilidade local não é autorização de servidor. O produtor atual autoriza recepção/admin e permite close sem conferir responsável anterior ou estado open; essa política ampla fica intacta e não é homologada por este recorte. Não alegar CAS/RLS/concorrência/idempotência reais com mocks.

UI fora deste incremento. Próximo K1/4f: somente conversa fresca aberta/própria, contexto/escopo atuais e confirmação humana explícita do encerramento, com a exclusão/conferência/gerações existentes. O texto deverá explicar a consequência administrativa e preservar ação de cancelar antes do envio. Sem encerramento automático ao abrir/ler/trocar filtro.

Provas apenas sintéticas com SDK instalado/fetch em memória; nenhuma rede/servidor/navegador/banco/Meta/hosted/PersonalMed. Contrato de UI e comando real seguem separados.
