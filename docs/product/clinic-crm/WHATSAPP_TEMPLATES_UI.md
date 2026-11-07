# K1/5b — consulta dos modelos na recepção

Entrada recolhida em Conversas, dentro do acesso à caixa. Abrir consulta não altera seleção ou comandos da conversa. Toda abertura e atualização verifica novamente estado/conexão/acesso, em chave própria por ator e clínica; somente depois lê o catálogo armazenado. Sem retry automático, refetch de foco/reconexão ou uso de catálogo antigo durante leitura/erro. Fechar ou mudar contexto aborta observação; resultado tardio não é adotado.

A consulta mantém atualização explícita e estados de verificação, leitura, erro, indisponível e vazio. Atualizar invalida a seleção, inclusive com resposta idêntica/coalescida. Cache anterior não aparece antes de leitura fresca. Retirada de acesso ou mudança de clínica/ator desmonta o painel.

A pessoa escolhe uma tupla nome+idioma; nenhuma escolha automática. Nome completo e idioma identificam o detalhe. Categoria, status e quantidade de parâmetros são apenas metadados recebidos; vazios aparecem como Não informado. Corpo literal com quebras e palavras longas, sem HTML, autolinks, interpolação ou dados de paciente. APPROVED não libera ações. Não há campo de parâmetros nem controle de sincronizar/enviar/conceder autorização.

A interface informa que consulta os modelos armazenados e que a lista pode estar incompleta. Zero itens não comprova conexão nem ausência definitiva na Meta. Botões com alvos de pelo menos44px, labels e foco de abertura/fechamento; uma coluna no celular e detalhe largo em desktop. Testes sintéticos, SDK real e browser isolado/loopback, sem banco/Meta/hosted/push. Produtor/schema/C5 e decisões pendentes preservados.
