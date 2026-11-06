# K1/1 — cliente de leitura da caixa de conversas

06/11/2026, Codex. Primeiro incremento do K1 sobre o [contrato C4](../../../product/whatsapp/CONTRATO.md), versão `ebb866a`.

`src/features/reception/whatsappApi.ts` fornece somente estado do canal, página de conversas e página de mensagens. Usa o SDK existente em `whatsapp-api`, propaga AbortSignal e não aceita ator/clínica no corpo. Valida DTOs estritos, tamanho de páginas/textos, IDs únicos e correspondência da conversa pedida. IDs são canônicos; timestamps/cursor mantêm precisão recebida, limitados a40 caracteres. Dados extras administrativos do estado são descartados após validação; mídia não admite URL desconhecida. Erros de servidor/transporte têm mensagens fixas, sem repassar detalhes brutos.

`whatsappApi.test.ts`: 29 testes passaram. Incluem filtros/defaults, entrada com autoridade injetada recusada antes da chamada, resposta inválida/duplicada, mídia extra, troca de conversa, cancelamento encaminhado, erros seguros e preservação de microssegundos. Três RED adicionais reproduziram timestamps com fração ilimitada; max40 corrigiu entrada e respostas. A passagem conjunta com25 testes C4 terminou54/54. Tipos globais da aplicação e lint do cliente/teste passaram; lint Node e sintaxe do harness também. A revisão independente final não apontou pendência acionável no cliente/helper.

O cliente ainda não é importado pela tela de recepção. Não há componente visual, cache, polling, escrita, assumir/transferir, marcar leitura, envio ou confirmação de agenda neste recorte. Testes substituem `functions.invoke`; não são navegador nem HTTP/SQL/RLS integrado. A paginação por timestamp do C4 ainda perde empates e aguarda mudança de contrato; preservar o cursor não resolve a perda no servidor. Não prometer histórico completo.

Próximo K1/2: lista/painel de leitura com fixture HTTP, isolamento por ator/clínica, estados vazio/negado/erro e recuperação explícita, antes de comandos. K2/K3 e integração de envio aguardam a [revisão C4](REVIEW.md). K4/1 já está entregue emc7722d9; C5 e os quatro caminhos do lease seguem com Claude. Sem migration, alteração C4/C5/SaaS/PersonalMed, Meta, hosted ou push.
