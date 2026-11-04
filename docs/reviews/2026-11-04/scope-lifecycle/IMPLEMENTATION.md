# T28/2a — Delegações encerradas na saída do médico

04/11/2026, Codex. Migration `20261104004000_reception_scope_lifecycle.sql`, reservada antes da implementação. Escopo L5, independente da decisão D18/M2. Apenas execução local com dados sintéticos.

## Comportamento

Toda mudança de status do médico para um valor diferente de `active` remove suas delegações da recepção naquela clínica. A regra está no banco e cobre saída voluntária, desligamento pelo administrador e escritor privilegiado. Reconvite, recusa e aceite não recriam o acesso; uma nova concessão explícita pelas capacidades existentes funciona após o aceite.

O gatilho anterior de liberação de trabalho foi preservado. Atendimento aberto volta à entrada, sem médico/assignee; casos encerrados, notas, autorias, beneficiários, consultas e prontuários não são apagados ou transferidos. O novo evento `doctor_scopes_revoked` contém apenas identificador do médico e quantidade de escopos, sem nomes ou conteúdo pessoal.

Uma guarda AFTER INSERT/UPDATE recusa escopos para médico inativo/convidado, inclusive por `service_role`. Ela roda após `custody_reference`, cuja atualização real do epoch já ordena a operação. A transição para status não ativo também atualiza esse epoch antes da remoção. READ COMMITTED usa leitura atual; REPEATABLE READ com snapshot antigo ou escritor concorrente aborta com `40001`, sem efeitos parciais. Não foi acrescentado outro lock bloqueante.

A migration limpa delegações cujo médico está atualmente inativo/convidado, preservando escopos ativos e registrando quantidade. Não é possível classificar concessões de membros já reativados como antigas ou renovadas sem proveniência; revisar permissões preexistentes no piloto. Não inferir consentimento nem ampliar a política de M2.

## Provas

- **RED SQL:** antes da migration, `L5: leaving retained latent doctor scopes` após saída pública com duas secretárias.
- **RED concorrente:** `node scripts/test-reception-scope-lifecycle.mjs --before-scope-revocation` reproduziu `raw/read committed/grant-held: unsafe competing transaction committed`. O modo omite somente esta migration em banco novo e descartável.
- **GREEN isolado:** `node scripts/test-reception-scope-lifecycle.mjs` comprovou limpeza de escopo inativo, preservação do ativo e auditoria mínima, além de **20 interleavings**: 16 corridas no epoch e quatro esperas reais entre API pública/FK, nas duas ordens e em READ COMMITTED/REPEATABLE READ. Inclui concessão por RPC e escrita direta privilegiada, reconvite/aceite sem escopo e nova concessão funcionando.
- **SQL de ciclo de vida:** saída e offboarding, recusa/reconvite/aceite, duas secretárias, isolamento de outra clínica e outro médico; negativas de busca/agenda/escrita depois do reingresso; INSERT/UPDATE privilegiados negados; prontuário, reserva, vínculo, caso encerrado, nota e autoria preservados. Trabalho aberto retorna exatamente uma vez.

`npm run test:db` passou com **56 migrations/34 suítes SQL**, as 20 provas de concessão/saída, concorrência anterior da recepção, snapshot/custódia dos modelos S3 e oito ordens de exclusão, todas sem estado inseguro. O ensaio de concorrência integra o runner padrão; o backfill também roda no executável isolado. [Resultados estruturados](verification.json).

Build/typecheck aprovados com configuração sintética de loopback, sem alterar `.env`. Lint sem erros/oito avisos anteriores. A revisão paralela de S3/R2 executou **14 testes/2 componentes**, com R2 original atendido e novo R3 reproduzido/encaminhado ao Claude; esses testes não são contagem de testes de L5.

## Revisão e limites

Revisão adversarial local do contrato e da migration não encontrou novo defeito de produção. A primeira leitura do harness encontrou um erro real: `leave_clinic` usa `FOR UPDATE`, incompatível com o lock de FK de uma concessão, de modo que esperar o segundo terminar antes de liberar o primeiro produzia apenas timeout. A prova foi corrigida: casos de epoch usam transição direta de status; os quatro casos públicos observam `pg_stat_activity` e `pg_blocking_pids` antes de liberar o primeiro. O teste de UPDATE de escopo também foi ampliado. Segunda leitura do artefato corrigido sem novo achado concreto.

Revisão externa dispensada pelo usuário e pelo contexto não interativo. Sem mudança pública de API/DTO ou de interface; não há nova verificação visual nesta entrega. D18/M2 continua pendente. Sem migração de PersonalMed, banco hospedado, exclusão real, API paga, push ou deploy.
