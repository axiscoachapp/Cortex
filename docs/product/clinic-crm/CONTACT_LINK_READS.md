# T48 — consulta verificada de vínculos administrativos

Somente administração clínica ativa, ator autenticado correspondente e sessão visível podem montar o leitor. Perda/troca de contexto/alvo desmonta consulta e seleção; recuperação inicia nova montagem/primeira página. Cada leitor tem chave própria para não cancelar outra janela ou herdar páginas ainda no cache.

Nomes, nascimento, contato, ausência, contagens, cursor e ações aparecem apenas após sucesso nesta montagem com fetchStatus idle. Pending/paused/erro retiram os dados; erro público é genérico. Atualizar/retry/mais páginas só consultam, sem abrir editor ou alterar vínculo. Cada transição para corrigir/suspender/reativar confere o snapshot ainda atual no QueryClient, além dos guardas existentes de disponibilidade/estado.

O leitor passa AbortSignal ao RPC já existente, preservando corpo, DTO, limite50, ordenação/cursor, deadline20s e compatibilidade sem sinal. Desmontagem/perda de contexto cancela só o leitor. Ações continuam usando os mesmos identificadores explícitos e os editores atuais.

Recorte: consulta e entrada dos editores. Não redesenha os efeitos assíncronos de uma correção/suspensão/reativação já enviada pelos editores; nenhuma promessa de aborto/rollback de escrita. Vínculo administrativo não compartilha prontuário nem funde identidades. Sem campos/projeções/permissões/RPC/SQL novos ou inferência. Ensaios sintéticos/isolados, sem hosted/Meta/carga/push. Guardas de UI não provam autorização/transação do servidor.

11/11/2026 — renovação do token na mesma sessão e falha de transporte do clinic_access por até 45 s não ocultam mais a sessão; a janela de vínculos permanece montada (revisão 2026-11-10, recepção 3). Ocultação efetiva (troca de ator/sessão, recusa definitiva, 45 s sem verificação) continua desmontando o leitor.
