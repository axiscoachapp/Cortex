# K6/5b — robô de fluxo: revisão independente

Fonte congelada: `f837c5769322579c145cb9c6f2588b5d00a77643`. Escopo: reserva atômica do bot, elegibilidade dos reinícios no handler e três interleavings PostgreSQL. Não é aceite integral C4/C5 nem ensaio de entrega na Meta.

Prova final: [SQL_REVIEW.json](bot-f837c57-confirmed/SQL_REVIEW.json). `accepted: false` é o resultado esperado das reproduções abaixo; a revisão não libera o robô para operação real.

Resultado: oito dos 12 controles SQL do bot passam e quatro reproduzem os dois defeitos. Duas das três corridas passam; a terceira reproduz a tomada humana ignorada. As 14 regressões da reserva e os sete probes de alcance do handler passam. A execução terminou sem falha de fixture e com remoção positiva do contêiner.

## Achados para Claude (C4)

### P1 — uma resposta humana não impede o início/reinício do robô

Em `whatsapp_bot_apply`, a consulta às saídas com `sent_by` só roda no ramo `p_new_cycle = false`. O primeiro ciclo, o reinício após revisão do fluxo e o reinício após inatividade passam pelo outro ramo. Assim, uma pessoa pode responder sem atribuir a conversa e o bot ainda cria sessão/mensagem pendente. O reinício também substitui `started_at`, perdendo a referência anterior para a próxima verificação.

Reproduções independentes: `bot_human_before_first_cycle`, `bot_human_before_flow_restart`, `bot_human_before_idle_restart`. Todos chamam o escritor humano real `whatsapp_begin_outbound`. O controle com ciclo ativo sem reinício recusa corretamente e termina a sessão como `human`.

A corrida `bot_waits_for_human_before_first_cycle` mantém a resposta humana não confirmada em uma sessão, observa o PID do bot bloqueado pelo PID humano e confirma a transação humana. Mesmo depois de esperar o lock e enxergar o commit, o bot aplica e reserva uma mensagem. Portanto, o lock da conversa funciona; falta a reconferência no ramo de início/reinício. Os controles concorrentes de CAS de dois inícios e de resposta humana durante ciclo ativo estão no mesmo relatório.

Correção pedida: conferir resposta humana sob o lock para todos os passos que reservam saída, com fronteira explícita para a abertura atual da conversa/ciclo. Reinício por revisão/inatividade não pode apagar a tomada humana; reabertura legítima não deve ser bloqueada por uma resposta do ciclo antigo. O controle `bot_reopened_old_human_allowed` preserva esse caso. Não atribuir a conversa nem fundir identidades por inferência para contornar a falha.

### P2 — bot reserva texto fora da janela de 24 horas

`bot_expired_window` ingere uma primeira mensagem com `provider_at` de 25 horas atrás. `last_inbound_at` fica efetivamente vencido. No mesmo estado, o escritor humano real recusa texto com `P0W01`, mas `whatsapp_bot_apply` cria sessão e saída pendente. O comando do bot não confere `last_inbound_at` sob o lock.

O handler congelado também encaminha esse caso à reserva: ele não filtra a data do provedor antes de chamar o comando. É uma mensagem atrasada gravada agora, não uma reentrega com `duplicate: true`.

Correção pedida: aplicar a janela no comando atômico antes de qualquer efeito de um passo com saída livre/interativa, sem consumir sessão, fila, encerramento ou mensagem quando recusado. O ensaio aceita tanto `P0W01` quanto `{applied:false}`, com ausência de efeitos. Não depender da eventual recusa externa da Meta.

## Método e limites

- Docker Desktop local verificado por endpoint, imagem existente por digest, contêiner próprio sem rede/portas; nenhuma carga real ou serviço pago.
- 79 migrations congeladas, bootstrap e duas suítes originais. Cada caso SQL independente usa seed sintético e rollback; as corridas usam apenas o banco descartável e sessões/PIDs próprios.
- 12 casos SQL do bot, mais 14 regressões anteriores de reserva. Probes separados executam `runBot` congelado em sete situações com dependências falsas e recusa de SQL; demonstram a chegada aos parâmetros de reserva, não envio nem integração HTTP com banco.
- Três corridas usam `pg_stat_activity`/`pg_blocking_pids`, confirmam a transação detentora antes de concluir o comando bloqueado e verificam recibos/estado. Não há alteração da definição do produtor nesses testes.
- 86 fontes congeladas (82 SQL e quatro módulos do handler) e seis módulos do executor têm hashes registrados; estabilidade do executor e remoção positiva do contêiner são verificadas no final.
- 14 testes Node (incluindo retenção dos resultados quando o handler falha), 49 Vitest existentes em dois arquivos, lint/sintaxe de cinco scripts e duas recusas de CLI. Flags de concorrência do contato/bot são exclusivas, pois cada grupo confirma seu seed próprio.

Revisão adversarial em três ciclos corrigiu a aceitação de `P0W01`, a classificação do controle positivo, a combinação inválida de flags e a perda dos demais resultados após falha de um probe. Último ciclo sem novo achado substantivo; o cast explícito do marcador SQL para texto foi corrigido depois como ajuste mecânico do ensaio. Cross-model skipped: non-interactive context; nenhuma CLI externa chamada.

Preliminares excluídas do commit: `bot-f837c57-contract-first` (barreira de hashes detectou edição da fixture durante a execução), `bot-f837c57-contract-final` (corrida inválida e fechamento de stdin incompleto) e `bot-f837c57-contract-reviewed` (marcador textual concatenado como JSONB). Os dois últimos são falhas do executor, não do produto. O contêiner próprio do ensaio que ficou à espera foi parado pelo ID completo; a remoção positiva foi registrada. Uma tentativa Vitest com `--minWorkers` foi recusada antes de executar testes; repetida com a flag suportada. A rodada final usa somente fontes estáveis e não contém `fixture_failure`.

## Continuidade

Claude corrige os dois achados no seu domínio e informa o SHA/contrato para reteste. C5 pode ser revisada independentemente; K1 de comandos continua condicionado ao respectivo contrato/revisão. K1 de leitura do caminho/fila do bot e K7 pós-consulta/áudio local são recortes próprios. Não reabrir como atuais os resíduos de reserva/contato já encerrados em K6/5a.

Somente testes/ferramentas e coordenação do Codex foram alterados. Sem push, deploy, banco hospedado, envio, alteração SaaS/PersonalMed ou edição dos arquivos de implementação do Claude.
