# K1/3a — caminho do robô e fila na conversa

[Contrato de leitura](../../../product/clinic-crm/WHATSAPP_BOT_READ.md). Cliente estrito para `botSession`, painel com opções escolhidas/status/hora e fila obtida da resposta fresca da conversa. Sem mudança do servidor ou dos DTOs existentes, sem comandos de escrita.

O caminho só monta depois das mensagens verificadas. Consulta por ator/clínica/conversa/geração, fresh após montagem, sem cache exposto em loading/erro, cancelamento e descarte de resposta antiga. Atualizar mensagens cria uma geração nova; retry do caminho relê somente o caminho. Nulo não é confundido com erro nem com percurso sem opções. Texto é escapado pelo React e não produz links ou HTML. A fila não é deduzida do rótulo escolhido.

## Provas

- 84Vitest em dois arquivos:53 do adaptador e31 da caixa. DTO/input/limites/cancelamento, null/cinco estados, fila de mensagens atual, retry, texto literal, cache/reabertura, troca de conta/clínica e respostas tardias. Testes anteriores da leitura permanecem verdes.
- 5Node da fixture, tipos globais, lint de nove arquivos, sintaxe de quatro scripts e três opções de CLI recusadas.
- Navegador Edge isolado em320/375/768/1024/1280/1440/1920px a135%,32estados. Snapshots da aplicação em0633323 com três overlays explícitos; nenhum componente novo pode ser carregado fora do snapshot.19hashes do executor e hashes de cada overlay, com cleanup positivo.
- Percurso de20 opções com24 caracteres sem espaços medido item a item no celular, sem corte horizontal. Nulo, recusa depois de caminho visível e retry no mesmo documento; mensagens atuais preservadas. Fila, status e hora São Paulo conferidos. Abertura por teclado, foco/devolução, filtros e aba Atendimentos mantidos.

Relatório final: [AUDIT.json](../../2026-11-05/reception-app-audit/whatsapp-bot-path-generation-final/AUDIT.json). [Validação consolidada](VALIDATION.json). Quatro403/console são recusas deliberadas das leituras; nenhum outro erro, recurso externo ou leitura/escrita clínica. Capturas do celular, percurso longo e desktop inspecionadas. Asserções anteriores foram preservadas; o heading de foco agora explicita nível2 porque o painel ganhou um h3 próprio.

## Correções durante a verificação

22RED iniciais demonstraram ausência do cliente/painel antes da implementação. A revisão adversarial exigiu começar a recusa com um caminho realmente visível; a prova foi ampliada, inclusive para o estado pendente e a geometria de todos os rótulos.

O teste de resposta imediata revelou que a montagem do filho não pode depender de um render transitório `isFetching`: React pode agrupar a resposta e conservar o filho. Outra regressão mostrou que reaproveitar uma requisição do bot em andamento adotava um snapshot anterior às novas mensagens. Ambos foram corrigidos com uma geração local nova por atualização, inclusive na chave da consulta. O teste exige cancelamento da requisição antiga e uma leitura posterior; sua resposta tardia não substitui o caminho novo. Nenhum contador é enviado ao servidor.

Foram três ciclos de revisão independente. O último achado foi reproduzido e corrigido com a regressão de requisição antiga mais respostas imediatas; a suíte e o navegador foram repetidos, sem iniciar um quarto ciclo. Cross-model skipped: non-interactive context.

Uma promessa de recusa da fixture foi criada antes de ser consumida e gerou rejeição não tratada; o teste agora a cria sob demanda e espera a chamada antes de rejeitar. Aumentar o timeout foi somente diagnóstico para localizar a falha, não uma mudança do limite dos testes finais. `whatsapp-bot-path-first` e `whatsapp-bot-path-final` são preliminares anteriores à correção por geração, excluídas da entrega; somente a rodada final corresponde ao código final.

## Continuidade

K1 de paginação e comandos continua separado; comandos dependem do próprio contrato/revisão e de confirmação humana. A leitura entregue não aprova bot/C5 e não altera achados2316/2330 do Claude. Paginação somente leitura e K7 pós-consulta/áudio local são candidatos independentes; M2/MFA/compartilhamento/piloto continuam abertos.

Sem SQL/migrations, hosted, Meta, chamadas pagas, push/deploy ou alteração em SaaS/PersonalMed/C4/C5. Commit local somente dos caminhos Codex, main/axiscoachapp.
