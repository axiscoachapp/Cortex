# K1/4m — retirar autorização de lembretes

Adaptador de act/revoke_opt_in, contrato WhatsApp v1.2 existente. Snapshot local estrito: conversationId UUID, revision PostgreSQL incrementável0..2147483646, status open, assignedTo igual ao ator esperado e consented literalmente true. A elegibilidade local é mais restrita que a política do produtor. Não aceitar concessão/false/ausência de consentimento como intenção de retirada, nem alterar os campos de contexto para enviar outra operação.

Wire exato: action act, operation revoke_opt_in, conversationId e revision. Ator/clínica/status/proprietário/consented são contexto, não autoridade enviada; nenhum telefone/target/queue/flag de consentimento entra no corpo. Snapshot validado imutável durante await, uma invocação, sem retry automático.

Recibo estrito open/revisão+1/proprietário preservado; não contém consented/optedOut. Retornar sempre {receipt,needsRefresh:true}, inclusive com recibo válido, sem sintetizar consented:false ou optedOut:true. Consumidor deverá reler lista/detalhe e mostrar somente flags frescas; falha mantém resultado inconclusivo e comandos bloqueados. Erros após início, recibo inválido e cancelamento tardio também exigem leitura; preflight inválido/pré-abort não enviam, sem promessa de rollback.

Escopo do produtor é o telefone e suas variantes na clínica, não identidade de paciente: revoga whatsapp_opt_ins ativos correspondentes e marca opted_out_at desta conversa, incrementando revisão. Pode afetar lembretes de outras conversas do mesmo telefone. Não fundir contatos, mover autorização entre identidades, alterar campos legais/PersonalMed, prontuário, vínculos ou permissão médica. Não prometer cancelamento de mensagens já reservadas/enviadas nem bloqueio de toda resposta humana; nenhuma chamada Meta/mark_read/send neste cliente.

UI4n fora deste incremento: contexto/detalhe frescos, confirmação humana explicando o efeito por telefone, sem concessão automática. Vincular confirmação a id/revisão/readVersion/owner/waId/consented/optedOut/contexto, descartá-la em qualquer mudança/refetch; usar exclusão/conferência/gerações existentes. Não digitar/inferir identidade nem escrever consentimento ao abrir. A mudança de número no produtor incrementa revisão por inspeção, não por novo ensaio SQL.

Provas sintéticas com SDK instalado/fetch em memória. Não prova autorização servidor, SQL/CAS/RLS/concorrência, retirada real ou automações futuras. Sem UI/navegador/banco/servidor/hosted/Meta/carga/push; C4/C5 e catálogo4j separados.
