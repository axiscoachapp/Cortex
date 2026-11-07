# K1 — páginas de mensagens anteriores

Usa a ação `messages` já existente no contrato WhatsApp v1.1. O corpo contém somente o ID da conversa e o cursor `before` opcional; sessão, ator e clínica continuam sob autoridade do servidor. Nenhum endpoint ou DTO novo.

O painel mantém uma página de até50 mensagens, sem concatenar páginas. “Mensagens anteriores” envia exatamente o `nextBefore` recebido, preservando microssegundos, offset e UUID. O adaptador recusa a repetição literal do cursor solicitado; fim de histórico é `nextBefore:null`.

“Mensagens mais recentes” permanece disponível durante loading/erro de uma página anterior. “Atualizar mensagens” volta às recentes. “Tentar carregar mensagens” repete a página que falhou, com o mesmo cursor. Uma página vazia anterior tem aviso diferente de uma conversa sem mensagens.

Ator/clínica/conversa/cursor compõem a chave da consulta. Página anterior é retirada durante releitura/recusa e a requisição é cancelada ao sair dela; resposta tardia não substitui a página atual. Fechar e reabrir começa pelas recentes. A troca também cria uma geração nova para o caminho do robô, preservando as proteções de [WHATSAPP_BOT_READ.md](WHATSAPP_BOT_READ.md).

As mensagens continuam em ordem cronológica dentro da página. A fila e o percurso do robô são metadados atuais de suas leituras, não uma reconstrução histórica daquele ponto da conversa. São snapshots separados, sem atomicidade conjunta ou atualização em tempo real.

O foco vai ao título “Mensagens da conversa” na navegação/retry. Controles quebram texto em telas estreitas e conservam alvos de pelo menos44px. Não há envio, mark_read, mudança de fila/responsável, consentimento, vínculo, agendamento ou leitura de prontuário.
