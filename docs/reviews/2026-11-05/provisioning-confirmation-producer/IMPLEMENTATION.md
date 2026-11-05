# Produtor privado da confirmação humana

Incremento M2 de laboratório sobre as reservas concorrentes. [Contrato e fontes PostgreSQL16](../../../product/clinic-crm/PROVISIONING_CONFIRMATION_PRODUCER_CONTRACT.md). Não modifica schema/migration de produção, API, credencial, filiação, delegação ou prontuário.

## Problema e proteção

O RED usa um administrador Native AAL2 e uma clínica criada por Data API. A intenção existe, mas o UUID alvo não existe no Auth e não tem receipt. O procedimento correto recusa40001. Mesmo assim, UPDATE direto de proprietário e serviço com grants transacionais consegue confirmed. Cada tentativa faz rollback; nenhum usuário alvo é criado. [RED](RED-v2.197.0.json).

O papel privado `provision_confirm_writer_lab` passa a possuir somente `check_intent`. Seu corpo é comparado antes/depois da instalação e permanece idêntico: mantém contexto/sessão/fator/geração, receipt atual, chaves de reserva e relógio final. O papel recebe apenas leitura e UPDATE(phase) em intents e as permissões de execução necessárias. Um trigger INVOKER/ALWAYS identifica esse produtor por current_user e recusa mudanças de fase de outros escritores com P4107. O produtor só permite prepared→confirmed; regressão e NULL recebem P4108. No-op continua permitido sem renovar prazo ou trocar vínculos.

O instalador requer READ COMMITTED, ledgers vazios/quiescentes e locks de tabela NOWAIT. Funções auxiliares preservam seus donos anteriores; o novo produtor não recebe acesso às tabelas Auth, INSERT, DELETE/TRUNCATE, propriedade de tabela/schema, CREATE em schema, filiação de papéis ou BYPASSRLS. DDL/SET ROLE pelo DBA não estão na ameaça; não afirmar que um dono de função é incapaz de alterá-la.

## Provas e revisão

Os GREENs em [v2.197.0.json](v2.197.0.json) e [v2.189.0.json](v2.189.0.json), resumidos em [verification.json](verification.json), passaram **35 grupos por versão (70 no total)** com fontes finais idênticas e cleanup conferido. Combinam as27 regressões de composição/nascimento/ledger, cinco grupos de reservas e três novos grupos de confirmação por instalação:

1. Proprietário/serviço sem receipt são recusados; no-op preservado, replica/GUC não fazem o escritor virar produtor. NULL do produtor recebe P4108. O controle que recoloca somente a comparação `<>` demonstra23502 da tabela, sem commit inválido; rollback restaura a função e P4108.
2. Nascimento Auth legítimo é confirmado pelo procedimento com o contexto original. Replay conserva o prazo, e nem o produtor regride confirmed→prepared.
3. Owner/ACL mínimos verificados; EXECUTE efetivo nos três schemas deve corresponder a seis funções (check_intent + cinco helpers) e UPDATE a uma única coluna. Controles concedendo EXECUTE em begin_intent ou UPDATE em expires_at devem tornar a auditoria falsa; rollback a restaura. Desativar apenas o novo trigger permite a confirmação indevida; rollback restaura ALWAYS e a recusa.

A revisão adversarial encontrou uma lacuna na prova de ACL (não comparava a allowlist completa) e a semântica de NULL na comparação de fase. Ambas foram corrigidas, com controles causais. Terceira leitura do delta não encontrou questão substantiva pendente. Revisão externa dispensada pelo usuário. A matriz inicial sem o teste/correção de NULL não é o resultado final; a matriz foi repetida após esse ajuste, sem somar execuções intermediárias aos grupos finais.

Migrations congeladas em `6c29f1c2a3136054d456c1af7939f338b0338994` (69 por instalação), overlays próprios capturados e conferidos por hash. A mesma projeção Native de14 colunas/ACL/owners/enums/RLS continua protegida. Os testes finais impedem filiação, paciente/chart, consulta ou escopo para os alvos. As regressões incluem RC/RR, remoção/alteração Native do alvo, ABA de autoridade, logout, prazos e reservas concorrentes. Não alegar nova matriz de instalação/upgrade com histórico.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --confirmation-red --source=6c29f1c2a3136054d456c1af7939f338b0338994
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --all --source=6c29f1c2a3136054d456c1af7939f338b0338994
```

## Limites

Somente laboratório. Autoridade dos INSERTs de reservas/intents, custódia/retenção/instalação com histórico, credencial/MFA/recuperação histórica e interface autorizativa do servidor continuam pendentes, assim como filiação/pedidos, corte/reconciliação/gate e API/UI. O contexto é confiável somente após validação real do bearer pelo servidor; a função não é exposta ao cliente. M2 não está concluída.

Docker local verificado, imagens existentes sem pull, rede interna sem portas publicadas, recursos com labels próprios e remoção conferida. Nenhuma suíte SQL geral, teste global do aplicativo, build, navegador, D17 ou provedor real repetido nesta rodada. Fonte congelada não inclui as correções D17 que o Claude está preparando em paralelo. Sem dados reais, PersonalMed, banco hospedado, envio, chamadas pagas, deploy ou push. Arquivos Claude/SaaS preservados.
