# K1/3c — páginas da lista de conversas

A recepção lê uma página de até 50 conversas por vez. “Conversas anteriores” usa `nextBefore` do contrato existente, sem reconstruir o timestamp ou UUID. A página substitui a anterior, sem acumulação de registros. “Conversas mais recentes” permanece disponível durante leitura pendente ou recusada de uma página anterior. Não há número total nem promessa de snapshot estável: mensagens novas podem mudar a ordenação entre leituras.

Trocar página fecha a conversa selecionada e cancela seus leitores de mensagens/caminho. Trocar filtro, enviar uma busca ou mudar ator/clínica reinicia na página recente. Rascunhar busca não envia. “Atualizar conversas” volta às recentes quando estiver numa página anterior; na recente relê e mantém a seleção se ainda constar da resposta fresca. “Tentar carregar conversas” repete a leitura da página que falhou. Navegação/retry devolvem foco ao título estável da lista.

Chave da consulta inclui ator, clínica, filtro, busca e cursor. Cada leitura recebe AbortSignal; não há placeholders ou linhas antigas em pending/erro, nem abertura automática de detalhes após navegação. Respostas atrasadas de consultas abandonadas não reaparecem. O adaptador mantém limites/DTO estritos e recusa `nextBefore` literalmente igual ao cursor solicitado; isso não é um comparador completo de tuplas.

Somente leitura das ações `state`, `conversations`, `messages`, `botSession` já contratadas. Nenhum comando, marcação de lida, envio, consentimento, associação de identidade, dado clínico ou agendamento. Sem mudança de API, migrations ou arquivos C4/C5 do Claude.
