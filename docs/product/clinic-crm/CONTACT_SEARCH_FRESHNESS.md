# Busca fresca de contatos administrativos

Novo atendimento reutiliza ContactSearch, já usado na agenda. A busca exige papel administrativo/recepção ativo, ator da sessão igual ao acesso, clínica e pelo menos dois caracteres úteis; não consulta prontuários. Query por ator, clínica e texto, sem retry nem refetch de foco/reconexão. Trocar texto, modo ou contexto e desmontar cancela a leitura. Buscar não cria contato, atendimento, identidade ou reserva.

Resultados só aparecem após sucesso fresco e fetchStatus idle. Durante leitura, pausa, erro ou busca curta, não há botão de contato nem estados de vazio/paginação vindos do cache anterior. Na seleção, conferir também o estado atual do cache e a identidade do snapshot renderizado para bloquear clique antes da notificação do React. Escolha explícita de ID; telefone/nome não confirmam pessoa ou paciente.

Erro usa texto local, retry explícito e limitado à busca válida atual. Campo mantém foco e texto, estados vazios/cursor são só da resposta fresca; nomes/telefones quebram linhas e alvos têm pelo menos44px. Mudança de modo reinicia o rascunho de busca, preservando os demais campos do formulário. Contato previamente selecionado e regras de submissão/identidade do formulário não são redesenhados nesta fatia.

receptionApi.contacts recebe AbortSignal opcional após cursor. Combina cancelamento com o prazo existente de20s, recusa pré-abort sem RPC e descarta retorno tardio. Corpo RPC e demais métodos permanecem iguais. Cancelamento não promete rollback de escrita; não há escrita neste leitor. Somente testes sintéticos/SDK instalado/fetch em memória e navegador isolado loopback; sem banco, Meta, hosted, importação, campos legais ou push.
