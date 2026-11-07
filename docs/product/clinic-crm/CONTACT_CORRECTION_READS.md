# T47 — leitura verificada da correção de contato

Cada montagem tem um leitor próprio, limitado ao contexto/alvo de T46. A consulta passa AbortSignal pelo caminho existente do RPC, preservando corpo/DTO e deadline20s; pré-abort não inicia RPC e resposta tardia é recusada. Só o leitor é cancelado em desmontagem/perda de contexto, nunca uma gravação já enviada.

O formulário só nasce após leitura bem-sucedida nesta montagem, fetchStatus idle e id correto. Cache de outro leitor não abre campos. Durante releitura, pausa ou erro, campos e ações privadas saem do DOM; o componente conserva o rascunho em memória e a conferência é retirada. Erro público de leitura é genérico. Retry consulta, sem descartar rascunho, salvar ou fechar.

Ao recuperar a leitura, o rascunho e seu baseline/revisão congelados voltam, exigindo nova conferência. Cada resposta verificada recebe versão local de leitura; até uma releitura imediata coalescida pelo React retira a conferência anterior. Descobrir nova revisão em background não sobrescreve o rascunho nem adota essa revisão no salvamento; o servidor continua responsável por recusar revisão antiga. Só Recuperar cadastro, com confirmação humana quando há edição, substitui baseline/rascunho e limpa a conferência.

Salvar verifica a consulta atual diretamente no QueryClient, além de T46: success/idle e mesmo snapshot antes de iniciar a mutação. Clique antigo ou mutação enfileirada durante releitura não escreve. A trava salvar/recuperar e os efeitos tardios de T46 permanecem. Recibo de gravação já enviada continua sendo tratado pelo contrato T46, sem promessa de rollback pela invalidação do leitor.

Leituras têm chave própria por instância para que cancelamento não afete outro editor do mesmo contato. Preservar prefixo ator/contact-edit/clínica/alvo; nenhuma mudança SQL, permissão, identidade, normalização ou importação. Ensaios somente sintéticos/isolados. Sem servidor/Auth/SQL real, Meta/hosted/carga/push.
