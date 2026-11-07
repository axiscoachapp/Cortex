# K1 — leitura do caminho no robô

Consome o contrato1.2 de `docs/product/whatsapp/CONTRATO.md`, sem alterar o servidor ou os DTOs de conversa/mensagem.

`whatsappApi.botSession({ conversationId }, signal?)` chama somente `botSession`. O SDK fornece a sessão autenticada; ator, clínica, papel e identificadores clínicos não entram no corpo. A entrada é estrita e exige UUID válido. A resposta estrita é `{session:null}` ou sessão com:

- `status`: `active`, `handed_off`, `closed`, `human` ou `error`;
- `path`: até20 rótulos, cada um com1–24 caracteres;
- `outcome`: nulo ou texto de até80 caracteres, validado sem exibição do valor de protocolo;
- `startedAt`/`updatedAt`: timestamps válidos, limitados a40 caracteres e sem normalização de precisão.

No painel da conversa, a fila vem da resposta atual de mensagens, já vinculada ao ID solicitado. O caminho só é consultado após essa resposta fresca. A consulta é isolada por ator/clínica/conversa e geração local de atualização. Atualizar mensagens inicia uma geração nova: a leitura do robô só monta após a confirmação das mensagens e não adota pedidos anteriores, mesmo se a resposta das mensagens for imediata. Fechar ou trocar o contexto cancela a leitura e impede a exibição tardia. Cache anterior não aparece durante releitura/erro; não há retry automático.

Ausência de sessão, percurso sem opções, leitura pendente e falha de acesso têm estados diferentes. A falha do caminho preserva mensagens atuais e permite repetir somente essa leitura. Rótulos são texto simples, sem HTML ou links ativos. Status e hora da atualização são apresentados em português e no fuso da clínica.

Fila e percurso são snapshots de duas leituras, não uma transação conjunta nem acompanhamento em tempo real. Atualizar mensagens reconfere ambos. Um rótulo de médico é uma opção do fluxo: não confirma identidade, vínculo, disponibilidade nem agendamento.

Não há envio, mark_read, consentimento, vínculo, mudança de fila/responsável, reserva ou escrita clínica. A origem pessoa/automação/robô das mensagens continua fora do DTO até contrato explícito. Esta leitura não homologa o comando do bot ou C5; correções K6 continuam com Claude.
