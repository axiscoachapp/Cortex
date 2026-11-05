# Sessões/MFA: fixture tipada e compatibilidade Native

05/11/2026. Incremento local do Codex para liberar as provas SQL de D17, sem migration de produção ou handler novo. [Contrato e fontes oficiais](../../../product/clinic-crm/AUTH_SESSION_FIXTURES.md).

## Mudança

O bootstrap SQL agora inclui sessões e fatores com a projeção acordada de 14 colunas, enums e nulabilidade nativos. O teste prova campos obrigatórios/valores inválidos, campos opcionais NULL, DELETE do usuário em cascata e ausência de FK de factor_id: um UUID de fator removido continua na sessão e precisa de join vivo no autorizador.

O adaptador Native aceita os perfis antigo e atual e omite seus mocks, preservando o serviço Auth real. Compara projeção, colunas/donos/ACL de tabela e coluna/flags RLS, enums/donos/ACL e definições/donos dos helpers. Há concessão explícita de EXECUTE nos três helpers usuais; não é uma prova de ACL de função, defaults, constraints, policies ou schema Auth integral preservados. A fixture tem defaults convenientes e enum factor_type reduzido; não reproduz segredos/desafios/JWT nem recovery_code.

## Verificação final

| Prova | Resultado | Evidência |
|---|---|---|
| Native Auth v2.197.0 | 23 grupos e projeção de 14 colunas; controles ACL; cleanup | [v2.197.0.json](v2.197.0.json) |
| Native Auth v2.189.0 | 23 grupos e mesma projeção; controles ACL; cleanup | [v2.189.0.json](v2.189.0.json) |
| Fixture SQL | 69 migrations, todas as 48 suítes SQL raiz (47 do baseline + uma nova), controle negativo de coluna, ensaio D17 | [sql-verification.json](sql-verification.json) |
| Correção Deno do Claude `5905e6d` | 27 entrypoints offline/cache-only; 62 testes aprovados e um ignorado em quatro arquivos | [edge-verification.json](edge-verification.json) |

Nos dois Native, TOTP/AAL2 e criação da clínica pela Data API são reais. Os 23 grupos por versão repetem as regressões de identidade removida, sessão/prazo/filiação e vínculos do ledger; o controle ACL de preparação é adicional, não um 24º grupo. Uma concessão temporária SELECT(id) mantém has_table_privilege falso, permite contagem sob service_role e é detectada por has_any_column_privilege e fingerprint de attacl. Rollback restaura a ausência de acesso antes das chamadas Auth.

O ensaio D17 inclui contenção real/controle sem NOWAIT, fim/revogação nas duas ordens, upload/fim nas duas ordens e regressões existentes. A falha antiga sobre ambiguous com tentativa maior recebe P4094, preservando tentativa 2 e estado; sobre stored recebe 22023 sem limpeza. O baseline já contém o controle de replay terminal de `26a9272`. Essas provas não implementam a nova cerca de sessões de D17.

Sintaxe e ESLint dos três runners aprovados; diff sem whitespace inválido. Sem alteração de frontend nesta fatia, não repetidos build/typecheck frontend/navegador. O resultado de unidade é **62 aprovados + um ignorado**, não 63 aprovados.

## Fontes congeladas e execução

Baseline final: `26a927292865a93d1cdd2f958aaf9854d5d98d3e`. As 69 migrations e suítes existentes vêm desse snapshot Git. Bootstrap, probe novo e runners próprios são overlays capturados com hashes; o Native também captura os SQL de protótipos do laboratório com hashes, em vez de alegar que vêm todos do Git. Fontes próprias foram conferidas ao fim das execuções. Os modos novos escrevem somente nesta pasta, preservando relatórios históricos.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --all --source=26a927292865a93d1cdd2f958aaf9854d5d98d3e
node scripts/test-signature-delta-review.mjs --auth-fixture --source=26a927292865a93d1cdd2f958aaf9854d5d98d3e
```

Todos os recursos Docker foram próprios, em rede interna sem portas publicadas, com imagens locais/sem pull e cleanup verificado. O runner SQL usa statement_timeout de 45s neste modo, lock_timeout de 3s; os limites internos dos ensaios concorrentes permanecem próprios. Não é medição de performance. `allSqlSuitesRun=true` significa as 48 suítes SQL raiz; `fullSqlMatrixRun=false` preserva a distinção das outras famílias concorrentes/upgrade não repetidas.

## Revisão e limites

A adaptação antiga recusou a fixture nova antes do Docker, com a asserção de perfil inesperado. Controles estáticos cobrem os dois perfis e recusam declaração obrigatória ausente/duplicada. A revisão local adversarial encontrou três fragilidades das provas, corrigidas antes da execução final:

- a cascade de fatores era vacuosa depois de remover o único fator: agora há segundo fator comprovadamente vivo antes do DELETE do usuário;
- checar somente grants de tabela ignorava SELECT(id): fingerprint e controles agora cobrem ACLs de coluna;
- GRANT/REVOKE de controle podia apagar um grant indevido anterior: savepoint preserva o estado inicial, e uma cópia com grant anterior injetado deve falhar P0004 e fazer rollback. O runner confirma a recusa exata e ausência de resíduo.

Após os ajustes, nova leitura local não encontrou defeito concreto; reexecução final SQL com o controle envenenado e as duas versões Native aprovadas. Ensaios intermediários não contam como evidência final do probe corrigido. Revisão externa dispensada pelo usuário.

Esta entrega remove a dependência das fixtures para o trabalho SQL do Claude. O contexto Edge `7b02644` e a fixture não substituem cerca de sessão/fator/conta/recursos, relógio final, CAS/tentativa, replay terminal e recuperação. Nenhum handler, cron, fornecedor/certificado real, autorização nova, migração de paciente, hosted, envio, deploy ou push. M2 continua com autoridade dos produtores INSERT/phase, reservas concorrentes, custódia/retenção/upgrade e corte/reconciliação/legado/gate pendentes. Prontuários privados, compartilhamento explícito e agenda humana preservados.
