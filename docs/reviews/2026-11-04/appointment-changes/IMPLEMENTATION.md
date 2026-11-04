# T29 — Alterações da agenda sem inversão de locks

04/11/2026, Codex. Migration `20261104006000_reception_appointment_changes.sql`, reservada antes da implementação. Correção M3/L4, sem alterar escopos, DTO, conclusão clínica ou migração PersonalMed.

## Comportamento

A RPC valida sessão/MFA antes de consultar disponibilidade. ID nulo/ausente ou reserva de outra clínica resulta em `42501`/`Agendamento indisponível`, antes de chamar o calendário com médico nulo. O cliente converte somente essa combinação exata de operação/código/mensagem em orientação para atualizar a agenda. Outros erros de permissão permanecem genéricos; nenhum texto interno foi liberado.

Depois da leitura inicial e autorização, a RPC bloqueia a linha do compromisso e revalida existência/clínica, escopo e revisão. Uma revisão antiga recusa antes de escrever no contador do calendário. A RPC então tenta o advisory lock da conta **sem espera**, retornando `40001` se ocupado; com ele adquirido, conserva o helper de versão do calendário e todas as regras anteriores de ação/auditoria.

Isso compatibiliza os dois caminhos já existentes: edição direta toma linha → conta, enquanto conclusão manual/assistida ainda toma conta → linha. A RPC não aguarda a conta segurando a linha, evitando um novo impasse com a conclusão. A tentativa pode recusar uma edição ainda atual durante outra escrita do mesmo médico; a pessoa atualiza a agenda e decide novamente. Não há retry automático ou substituição silenciosa do rascunho.

## Provas de falha anteriores à correção

- **L4/RED:** teste SQL com ID nulo expôs `23502` e a tabela `reception_calendar_versions`.
- **M3/RED:** `node scripts/test-reception-appointment-concurrency.mjs --before-appointment-changes`, em PostgreSQL novo e descartável, produziu `40P01` no médico; a recepção segurava o calendário enquanto esperava a linha.
- **Desenho bloqueante rejeitado:** `--blocking-calendar-prototype` aplica a migration atual e remove somente a tentativa não bloqueante em memória no banco descartável. Os seis casos de edição passaram, mas a conclusão manual contra a recepção produziu `40P01`. Esse modo não modifica arquivos de produção nem o banco hospedado.
- **Cliente/RED:** o novo teste de disponibilidade falhou com a mensagem antiga de perda de permissão; quatro casos de segurança/concorrência já passaram. Depois do mapeamento específico, os cinco casos e a suíte da recepção passaram sem expor erros internos.

## Verificações

`npm run test:db` final aprovado: **57 migrations/35 suítes SQL**, dez provas da agenda, 20 provas de permissões/reingresso, concorrência anterior da recepção, corridas S3/R1 e oito ordens de exclusão, todas sem estado inseguro. O teste SQL cobre ID nulo/ausente, clínica incorreta, ator sem delegação, revisão antiga, horário ocupado e ação inválida, com nenhuma alteração parcial de compromisso, contador ou auditoria. MFA AAL1 com fator verificado é recusado para IDs presentes/ausentes/nulos/externos; AAL2 permite confirmação humana. [Evidência estruturada](verification.json).

`npx vitest run src/features/reception`: **48 testes/10 arquivos** aprovados. Build/typecheck aprovados com variáveis sintéticas de loopback, sem mudar `.env`. Lint geral sem erros/oito avisos anteriores e lint dos caminhos novos/alterados aprovado.

O harness usa instrumentos somente no banco descartável, removidos no `finally`. Observa `pg_stat_activity`/`pg_blocking_pids` e usa um gate antes do gatilho clínico para pausar o médico depois do lock da linha. Seis casos cobrem médico primeiro, recepção primeiro e duas recepções, variando o isolamento do escritor que espera (READ COMMITTED/REPEATABLE READ). Outros quatro exercitam as duas funções reais de conclusão, com ambos os atores nos dois isolamentos; a recepção recusa sem aguardar a conta e a conclusão salva um único encontro. Confere revisão, horário, autor, beneficiário e evento único do vencedor.

## Revisão

Revisão adversarial local encontrou dois problemas no desenho inicial: retorno de disponibilidade antes de MFA e nova inversão contra `finalize_manual_encounter`/`complete_consultation_metadata` se a RPC apenas trocasse a ordem dos locks bloqueantes. Ambos foram classificados como válidos e corrigidos antes da entrega. O protótipo descartável comprova o segundo. A leitura da migration corrigida não encontrou outro defeito concreto; encontrou que o isolamento da recepção nos casos de conclusão precisava acompanhar o do clínico, e o ensaio final foi ajustado/repetido.

Revisão externa dispensada pelo usuário/contexto não interativo. A mensagem de erro foi testada no limite da API; nenhum componente/layout foi alterado e não houve novo ensaio visual. M2/D18 e as demais decisões pendentes seguem separadas. Somente dados sintéticos; sem IA externa, banco hospedado, carga, emissão, push ou deploy.
