# K6/5c2 — reteste das correções do bot em be5b794

Os dois achados2316 estão encerrados neste recorte: resposta humana na abertura atual impede saída do primeiro ciclo/reinícios/ciclo ativo; janela nula, vencida ou exatamente24h recusa sem alterar conversa, sessão ou mensagens. O controle imediatamente dentro24h continua aplicando fila, encerramento e uma saída. Uma resposta anterior à reabertura não impede um ciclo novo legítimo. Fonte congelada: `be5b794dcdf6aea51cde7cc896c5a44204e6cfee`. Nenhum produtor foi editado.

## Resultados reproduzíveis

[GREEN](../../2026-11-06/whatsapp-k6/bot-be5b794-window-reviewed/SQL_REVIEW.json) executou79 migrations e as duas suítes originais em banco Docker local descartável, sem rede/portas. Passaram14 regressões de reserva,17 casos SQL do bot,um controle da própria fixture, três corridas reais e dez probes do handler congelado.86 fontes congeladas e seis módulos do executor têm hashes conferidos; cleanup positivo, zero fixture_failure.

[Controle RED](../../2026-11-06/whatsapp-k6/bot-f837c57-window-reviewed-control/SQL_REVIEW.json), com o mesmo executor e `f837c5769322579c145cb9c6f2588b5d00a77643`: oito falhas de contrato SQL, uma corrida e três probes de janela falham como esperado. Os14 controles de reserva, controle da fixture, reabertura legítima, CAS e demais controles permanecem verdes; duas suítes originais passam, cleanup positivo. Isso distingue regressão do produto de falha do ensaio.

As três corridas observam PID próprio bloqueado por PID próprio com pg_stat_activity/pg_blocking_pids: (1) humano confirma antes de terminar o primeiro bot, que retorna taken sem sessão/saída; (2) dois inícios iguais reservam uma vez e o perdedor retorna revision; (3) humano durante ciclo ativo impede nova saída e deixa sessão human. São interleavings específicos, sem prova de todas as escalas/interleavings possíveis.

O novo `--bot-window-guard` exige `--bot` e seleciona o contrato do handler que recusa janela antes do RPC. O modo histórico de sete situações permanece reproduzível; o modo novo testa dez, incluindo null, limite24h e controle1ms dentro. Três testes novos do executor ficaram RED (7≠10) antes da implementação; [17 testes Node](NODE_TESTS.tap) finais, lint/sintaxe dos cinco scripts e [duas recusas CLI](CLI.json) passam. [Validação](VALIDATION.json). Nenhuma mudança de TS/app nesta entrega; typecheck de produto não se aplica.

## Revisão e limites

A revisão encontrou P2 na prova: comparar somente count de mensagens não garantia ausência de mudanças. Corrigido para snapshot JSONB ordenado das linhas completas, incluindo conversa/sessão. Um comando falso em pg_temp muda o corpo da mensagem mantendo a quantidade e retorna window; o ensaio exige detectar exatamente K6_BOT_WINDOW_CHANGED_MESSAGES, com rollback. Se esse controle falha, é fixture_failure, nunca defeito do produtor. Segunda revisão sem novo achado acionável. Cross-model skipped: non-interactive context.

As primeiras rodadas SQL (bot-be5b794-window-final e bot-f837c57-window-control) foram concluídas/limpas, mas ficam excluídas do manifesto porque ainda comparavam só a quantidade de mensagens. Os relatórios finais acima incluem a correção e o controle mutante. Na conferência posterior dos hashes, uma tentativa usou trim indevidamente; a conferência correta foi repetida com os bytes completos de git show, sem repetir os ensaios SQL.

O handler é código de produção congelado executado com dependências falsas e RPC recusado, sem entrega/HTTP/Auth real. Os comandos SQL e as corridas são reais somente no banco sintético com bootstrap de teste. Nenhum Meta, segredo, provedor, dado real, banco hospedado, deploy ou push; não é homologação integral C4/C5, seletor4j, painel K2 ou P4. Edições paralelas Claude/SaaS em App, Settings, scripts/app-audit-browser, whatsappApi/handlers/deps/config e arquivos raiz foram preservadas. K2 continua prioritário após confirmação do contrato/fonte C4; não foi enviado pedido repetido.
