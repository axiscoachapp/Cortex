# K1/4j2 — transferência humana de conversa

Recorte local autorizado depois do K2/1. Catálogo C4 be5b794/b7f424d já entregue e retestado; consumir [WHATSAPP_ASSIGNEES_READ](WHATSAPP_ASSIGNEES_READ.md) e o adaptador [WHATSAPP_TRANSFER_COMMAND](WHATSAPP_TRANSFER_COMMAND.md), sem mudar produtores. As duas validações K2/1052 continuam separadas; cliente envia limite numérico10 e cursor validado.

Entrada somente em detalhe aberto, sob responsabilidade do ator ativo da clínica, revisão incrementável, sessão visível e conexão/lista/mensagens frescas. Abertura explícita de Transferir conversa inicia nova verificação do canal e uma página de atendentes. Não usar staff/doctors, cache antigo ou alvo previamente escolhido. Leitura por instância/contexto com AbortSignal, sem retry automático ou auto-paginação. Dez nomes por página, cursor do servidor; troca de página/atualização substitui snapshot e retira a escolha.

Nome literal e papel retornados; próprio ator e ambiguous:true ficam desabilitados com motivo. Não resolver colisão por papel, UUID, apelido ou identidade inferida. Não mostrar UUID/telefone/e-mail de atendente. Falha de diretório é indisponibilidade, nunca equipe vazia. A conferência do canal e catálogo é leitura; não prova disponibilidade ou autorização futura do destinatário.

Escolher uma pessoa abre conferência de conversa/número disponível e destinatário/papel. Somente Confirmar transferência envia act/assign com alvo explícito e revisão atual. Cancelar, Escape, escolher outra pessoa e paginação não enviam. Trava síncrona impede dupla confirmação. Guardas de cache/instância bloqueiam callbacks capturados antes da notificação React de invalidação da lista, mensagens ou catálogo. Nova leitura coalescida invalida a conferência por versão, mesmo se o DTO for igual.

Mudança de ator/clínica/papel/conversa/revisão/owner/readVersion, sessão oculta, pending/paused/erro ou outro comando retiram a janela e exigem nova escolha. Não conservar confirmação invisível para reconexão. Operação já iniciada tem snapshot próprio e usa exclusão/conferência existentes; cancelamento não promete rollback.

Após resposta, falha ou recibo inconclusivo: reler detalhe/lista antes de outro comando, sem repetir act. Não anunciar atribuição pelo recibo isolado. Falha de conferência bloqueia comandos; Conferir responsável repete somente leituras. Não alterar fila, vínculos, paciente, agenda, consentimento, prontuário, bot ou mensagens. Nenhuma chamada Meta, envio ou reserva.

Provas separadas: testes de UI/contexto/cache e transporte sintético em navegador isolado; adaptador/SDK/servidor/CAS têm verificações próprias. Manter escala135%, campos e alvos de44px+, modal largo/rolável, rodapé alcançável320–1920. Sem deploy, hosted, dados reais ou push.
