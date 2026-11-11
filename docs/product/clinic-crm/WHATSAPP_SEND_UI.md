# Resposta pela caixa de conversas, atualização automática e não lidas

A recepção responde o paciente pela própria caixa de conversas. O cliente usa a ação `send` e a operação `act mark_read` do `whatsapp-api` exatamente como o servidor define ([CONTRATO.md](../whatsapp/CONTRATO.md)); o servidor continua dono da janela de 24 horas, da recusa por "SAIR", da aprovação do modelo e da idempotência por `requestId`. Adaptador: `src/features/reception/whatsappSend.ts`. Tela: `WhatsAppComposer.tsx` no fim de `WhatsAppMessages.tsx`.

## Quem vê o campo de resposta

O campo aparece no fim de uma conversa **em aberto** cujo responsável é a própria pessoa, com a leitura do detalhe bem-sucedida.

| Situação (leitura do detalhe) | O que aparece |
|---|---|
| Em aberto, com você, janela aberta (`windowOpenUntil` no futuro) | Caixa de texto e **Enviar**. Enter envia; Shift+Enter quebra a linha. Até 4.096 caracteres. |
| Em aberto, com você, janela fechada | Uma frase ("Passaram mais de 24 horas… envie um modelo aprovado"), a lista dos modelos com status `APPROVED` (leitura `templates` já existente), um campo por parâmetro (`paramCount`), a prévia do texto final e **Enviar modelo**. Sem modelo aprovado: "A clínica ainda não tem modelos aprovados. Avise o administrador da clínica." |
| Em aberto, sem responsável | "Assuma a conversa para responder.", ao lado de **Assumir conversa**. |
| Em aberto, com outra pessoa | Nada; a linha de situação diz "Com <nome>". |
| O contato pediu para sair (`optedOut`) | "Este contato pediu para não receber mensagens. Não é possível enviar mensagens nesta conversa." (para qualquer pessoa). |
| Encerrada | Nada; a reabertura continua sendo a ação de reabrir. |
| A última atualização automática falhou | O campo continua com o texto, mas o envio fica desligado até uma leitura bem-sucedida. |

A janela é conferida de novo no clique. Os parâmetros do modelo não aceitam quebra de linha, tabulação nem cinco espaços seguidos (a mesma regra do servidor) e são enviados sem espaços nas pontas.

## Envio, resultado e texto digitado

- Pedido: `{ action: 'send', conversationId, requestId, text }` ou `{ …, template: { name, language, params } }`. O `requestId` vem de `useRequestId`, guardado na caixa de conversas (sobrevive a atualizações e à remontagem do detalhe): o mesmo conteúdo reaproveita o mesmo id.
- Durante o envio: botão "Enviando…", e as outras ações da conversa, as atualizações manuais e a atualização automática ficam pausadas.
- O texto digitado fica guardado por conversa enquanto a caixa estiver aberta para a mesma pessoa e clínica. Ele só é apagado depois de um envio aceito ou não confirmado (a mensagem já está no histórico).
- Depois de qualquer resultado, as mensagens são relidas em segundo plano, sem esvaziar a tela: a mensagem nova aparece sem clicar em atualizar.

| Resposta | Classe | Texto mostrado | Texto digitado | `requestId` |
|---|---|---|---|---|
| 200 `sent`/`delivered`/`read`/`unrecorded` | enviada | "Mensagem enviada." (repetição: "Esta mensagem já tinha sido enviada.") | apagado | novo |
| 202 `unknown` (ou repetição em `pending`/`unknown`) | não confirmada | "O WhatsApp não confirmou o envio. Confira na conversa e, se preciso, com o paciente antes de mandar de novo." | apagado | novo |
| `window_closed` | recusa | "Passaram mais de 24 horas… Agora só é possível enviar um modelo aprovado." A releitura troca o campo pelo modelo. | mantido | novo |
| `opted_out` | recusa | "Este contato pediu para não receber mensagens. Nada foi enviado." | mantido | novo |
| `template` | recusa | "Este modelo não está aprovado para envio ou mudou. Peça ao administrador da clínica para atualizar os modelos." | mantido | novo |
| `send_failed` (ou repetição em `failed`) | recusa | "O WhatsApp recusou a mensagem e nada foi enviado. Confira o texto e tente de novo." | mantido | novo |
| `forbidden` | recusa | "Você não tem permissão para responder nesta conversa." | mantido | novo |
| `not_found` | recusa | "Esta conversa não está mais disponível. Atualize a lista." | mantido | novo |
| `not_connected` | recusa | "O WhatsApp da clínica não está conectado. Avise o administrador da clínica." | mantido | novo |
| `server_not_ready`, `token_unreadable` | recusa | "O envio pelo WhatsApp está indisponível no momento. Avise o administrador da clínica." | mantido | novo |
| `invalid` | recusa | "Não foi possível enviar. Confira a mensagem ou os campos do modelo e tente de novo." | mantido | novo |
| Sem resposta, 5xx sem código conhecido, resposta que não valida | resultado desconhecido | "Não foi possível confirmar o envio. Confira a conversa: se a mensagem não aparecer, tente de novo. A nova tentativa não duplica o envio." | mantido | **o mesmo** |

Nada é reenviado sozinho. Depois de uma resposta 202, reenviar é uma decisão da pessoa, depois do aviso: se ela digitar de novo, sai um pedido novo. Depois de um resultado desconhecido, a nova tentativa usa o mesmo `requestId`, e o servidor devolve o registro existente em vez de mandar de novo. O texto do servidor e da Meta nunca é mostrado.

As mensagens enviadas mostram o status: Enviando, Enviada, Entregue, Lida, **Falhou** ("Esta mensagem não foi entregue ao paciente.") e **Envio não confirmado** ("Confira com o paciente antes de mandar de novo.").

## Não lidas e mark_read

- Quando o responsável abre uma conversa em aberto com mensagens não lidas, o cliente chama `act mark_read` uma vez por mensagem recebida nova (`lastInboundAt`). É melhor esforço: uma falha não aparece e não é repetida. Depois de um sucesso, a lista é relida em segundo plano para apagar o contador.
- O botão "Conversas" de `/recepcao` mostra "Conversas (N)": conversas em aberto com mensagens não lidas, sem responsável ou com a própria pessoa. Uma leitura leve (`conversations`, filtro `open`, até 100; "N+" quando há mais páginas), a cada 30 s com a aba visível, só enquanto a pessoa está em Atendimentos. Qualquer falha esconde o número.

## Atualização automática

- A lista (só a primeira página) e a conversa aberta (só as mensagens recentes) se atualizam a cada 15 s com a aba visível, e logo ao voltar para a aba. Ficam paradas enquanto um comando ou um envio está em andamento, ou enquanto a conferência de um comando não terminou.
- Uma atualização automática mantém na tela a última leitura boa: não esvazia a lista, não fecha nem remonta a conversa, não mexe na rolagem e não apaga o texto digitado. As ações e confirmações abertas continuam montadas enquanto a leitura não muda a conversa; se a conversa mudar (revisão, responsável, situação, última mensagem), a confirmação aberta é descartada, como antes. Qualquer leitura que não seja automática (atualizar, conferência de comando, invalidação) continua descartando a confirmação aberta mesmo com dados idênticos.
- Se ela falhar: aviso discreto "Não foi possível atualizar. … podem estar desatualizadas." com "Tentar agora", os dados continuam na tela e as ações e o envio esperam a próxima leitura bem-sucedida.
- O botão de atualizar continua, menor (ícone). Uma atualização pedida pela pessoa, a conferência de um comando, a troca de filtro, de busca ou de página continuam com a regra rígida de antes: escondem os dados até a leitura nova e, se falharem, mostram o erro.

## A conversa aberta não depende da lista

A conversa aberta é identificada pelo id e mostra a própria leitura. Ela continua aberta quando sai do filtro: depois de **Assumir conversa** em "Sem responsável" (ela fica disponível para responder), de **Encerrar** em "Em aberto" ou de uma atualização da lista. Isto substitui, para esses casos, a regra de [WHATSAPP_CLOSE_UI.md](WHATSAPP_CLOSE_UI.md) que ocultava o detalhe quando a conversa saía do filtro. Trocar de filtro, de busca, de página, de pessoa ou de clínica continua fechando a conversa. Os comandos da conversa (assumir, transferir, encerrar…) usam só a leitura do detalhe, e não esperam mais a lista estar parada; a revisão continua conferida pelo servidor.

## Cabeçalho e textos

- Nome, telefone (`+<número>`) e uma linha: "Fila agenda · Em aberto · Com você · Lembretes autorizados". O responsável aparece pelo nome (leitura `assignees`, uma página de até 50, guardada por 5 minutos); sem nome conhecido, "Com outra pessoa".
- Descrição da página: "Acompanhe e responda as conversas do WhatsApp da clínica." WhatsApp não conectado: "O WhatsApp da clínica ainda não está conectado. Avise o administrador da clínica." (para o administrador: "A conexão é feita pela equipe Cortex."). Saíram "Até 50 conversas por página." e "Até 50 mensagens por página.".

## O que fica de fora de propósito

- Mídia (enviar ou baixar arquivos), vincular contato ou atendimento, registrar autorização (`record_opt_in`) e respostas rápidas.
- Resposta humana dentro da janela para quem pediu para sair: o servidor aceitaria, mas a tela não oferece; a decisão de produto foi não mandar nada para quem pediu para sair.
- Reenvio automático, envio otimista (a mensagem só aparece pela releitura) e Realtime.
- O texto digitado não é salvo no servidor nem no navegador: some ao sair da caixa de conversas ou trocar de pessoa ou clínica.
- Nenhuma mudança no servidor.

Testes: `whatsappSend.test.ts`, `WhatsAppSendUI.test.tsx`, `WhatsAppPolling.test.tsx`, `ReceptionQueueUnread.test.tsx`, e os testes existentes da caixa ajustados.
