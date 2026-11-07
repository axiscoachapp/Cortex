# K1/4g — adaptador de reabertura da conversa

Usar act/reopen do contrato WhatsApp v1.2 sem mudar produtor/SQL. Entrada local estrita: conversationId, revisão PostgreSQL incrementável, status closed e assignedTo explicitamente UUID ou null. Aceitar proprietário atual igual ao ator esperado ou ausência de responsável; rejeitar outro responsável. Ator esperado, proprietário e status local não entram no transporte. Corpo exato: action act, operation reopen, conversationId e revision.

Recibo estrito: status open, revisão anterior+1 e assignedTo idêntico ao snapshot validado, inclusive null. Reabrir não assume nem transfere conversa. Ator/proprietário em UUID são normalizados para comparar. Ausente não vira null. Uma invocação sem retry; erro iniciado, recibo inválido ou abort tardio exigem releitura antes de outro comando. Preservar snapshot validado durante await, sem adotar mutação posterior do objeto do chamador.

O produtor preserva atribuição, fila/vínculos/consentimento/não lidas; redefine opened_at, limpa first_response_at/closed_at/closed_by quando status closed. Esses quatro campos não constam do recibo act e não são afirmados como conferidos. Não chamar assign/unassign/close/mark_read/send ou alterar caso/clínico/agenda/identidade. Conversa sem responsável permanece sem responsável até clique humano separado de Assumir.

A elegibilidade local não é autorização de servidor: o produtor amplo de recepção/admin não exige proprietário anterior, e sua política fica intacta. Não provar CAS/RLS/concorrência/idempotência/reabertura real com mock. Reabertura sobre estado open não serve como sucesso sem incremento de revisão; pré-condição local exige closed.

UI fora deste incremento. Próximo K1/4h: reabrir apenas detalhe fresco encerrado próprio/sem responsável, escopo atual, confirmação humana e conferência/gerações/readVersion existentes. Explicar retorno a Em aberto e responsável preservado; não assumir automaticamente nem reutilizar confirmação anterior após releitura.

Provas sintéticas, SDK instalado com fetch em memória e nenhuma rede/servidor/navegador/banco/Meta/hosted/PersonalMed. Contrato de UI e integração do botão separados.
