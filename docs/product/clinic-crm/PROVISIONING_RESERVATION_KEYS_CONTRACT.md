# Reservas concorrentes do provisionamento — laboratório

Incremento M2 exclusivamente local, sobre os protótipos de intenção clínica, vínculos do ledger e produtor de nascimento. Não é migration de produção, fachada Auth nem autorização de INSERT/confirmar intenção.

## Contrato

Uma disputa pela mesma `operation_id` ou pelo mesmo `planned_user_id` não pode esperar num índice único depois da última conferência de prazo. O concorrente recebe `40001` enquanto a transação titular permanece aberta. Depois do término, o replay exato conserva identidade, ator, clínica, sessão, geração e prazo; outro ator não pode adotar a operação. Colisões já confirmadas continuam sujeitas às constraints existentes, sem renomear, reaproveitar identidade ou renovar prazo.

A proposta usa dois advisory locks de transação, adquiridos com `pg_try_advisory_xact_lock`: hash64 de uma chave com namespace de operação, seguido do namespace de identidade alvo. Colisão de hash pode causar recusa conservadora; não autoriza outra identidade. Não há singleton global. `40001` exige encerrar a transação antes de tentar novamente.

O produtor `begin_intent` adquire as duas chaves após validar contexto/geração e antes de ler a intenção e conferir o relógio final. `check_intent` as adquire após capturar/conferir a identidade da intenção e antes da conferência final. Triggers BEFORE INSERT OR UPDATE/ALWAYS nas duas tabelas também participam, inclusive no-op e atualizações nativas de fase/XID; em UPDATE usam as chaves OLD, que as guardas existentes proíbem trocar. Assim, um updater de linha já confirmada não deixa o INSERT duplicado esperar no índice. No caminho dos produtores, as aquisições do trigger são reentrantes. A exceção para colisões confirmadas permite erros de constraint depois do commit, não espera por updater ainda em andamento.

Os triggers se chamam `aa_reservation_keys`: precisam executar antes de `intent_binding`, cuja leitura do pai ainda invisível recusaria o concorrente com P4104 antes de tentar a chave. Cobrir DML direto de proprietário/serviço com grants temporários e replica. Guardas existentes mantêm vínculos, fases, XID e histórico; nenhuma guarda de nascimento é removida.

O instalador só aceita os dois ledgers vazios e quiescentes, em READ COMMITTED, com locks de tabela NOWAIT. Nenhum consumidor recebe USAGE/EXECUTE/CRUD novo. DDL, impersonação de papéis e superusuário capaz de remover guardas estão fora da ameaça, como nos protótipos anteriores. A instalação em base ocupada/histórica e sua custódia são tarefas posteriores.

## Provas requeridas

- RED nativo: dois administradores distintos, cada um com conta, TOTP/AAL2 e clínica reais no Auth/Data API descartáveis. A segura uma reserva; B disputa o alvo com outra operação. Observar `pg_blocking_pids` no índice, liberar A e observar `23505`. Assim, a barreira do mesmo ator não mascara a corrida.
- GREEN: mesmo alvo/outra operação e mesma operação/outro alvo recebem `40001` antes de liberar A; observador não pode aceitar lock_timeout como prova. Chaves independentes de B concluem com A ainda aberta.
- DML direto em ambos os ledgers, serviço com grants transacionais, replica e controle removendo somente o novo trigger; o controle deve voltar a esperar, com restauração conferida. Incluir INSERT de intenção cujo pai ainda está invisível e UPDATE no-op de reserva já confirmada.
- Commit conserva replay/recusa de adoção. Rollback libera as chaves; B consegue reservar e completar o nascimento/confirmar sob seu contexto genuíno. Nenhum vínculo de equipe, paciente, prontuário ou delegação é criado para os alvos.
- Repetir as regressões de composição/nascimento e os casos novos nas duas versões locais do Auth, congelar migrations do Git, conferir hashes e remover todos os recursos próprios.

## Limites

Não autentica todo INSERT de reservas/intents ou a fase de confirmação humana; não resolve a disputa externa por uma identidade no namespace do Auth, eleição de credencial, MFA/recuperação histórica, retenção/custódia/upgrade, cutover do serviço, reconciliação nem gate/API/UI. Não muda campos legais, importação PersonalMed ou compartilhamento clínico. Sem hosted, carga real, envio, provedor pago, deploy ou push.

## Fontes conferidas (PostgreSQL 16)

- [Advisory locks](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS): variante TRY retorna imediatamente; escopo de transação libera no término.
- [CREATE TRIGGER](https://www.postgresql.org/docs/16/sql-createtrigger.html): triggers do mesmo tipo executam em ordem alfabética.
- [Código oficial do índice único](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/access/nbtree/nbtinsert.c#L553): uma linha concorrente atualizada pode exigir espera pelo xmin/xmax. Não basta proteger apenas INSERT.
