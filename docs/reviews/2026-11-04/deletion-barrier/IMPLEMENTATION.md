# T27/2b — Barreira de custódia implementada

04/11/2026, Codex. Migration reservada `20261104002000_reception_deletion_barrier.sql`. **H2/T27 concluída no código local**, sem aplicação hospedada. Próxima prioridade: H1/T28, escopos administrativos.

## Comportamento

Uma versão privada compartilhada pelas fontes de custódia serializa a intenção e a introdução de referências. O lock é `FOR UPDATE NOWAIT` com atualização real da versão: contenção aborta com `40001`, e snapshots antigos não podem confirmar omissões. Os triggers da intenção executam depois do advisory existente e antes do pré-check autoritativo. Guardas AFTER usam autores finais, incluindo referências indiretas de reserva/auditoria à agenda e seus pacientes.

O inventário explícito cobre recepção, agenda, clínicas/compartilhamentos e tabelas clínicas envolvidas no pré-check legado. O pré-check inclui agora `shared_chart_entries.actor_user_id`, independentemente de autor/proprietário. Prontuários continuam privados e o mecanismo não concede permissões. O fluxo existente de limpeza de arquivos/provedor mantém seu protocolo; esta mudança trata a custódia administrativa e as relações verificadas pelo pré-check.

Intenção de conta ativa não pode ser removida, retargetada ou truncada por cliente. Upsert preserva o instante original. A exclusão real do usuário permite a cascata do marcador. A intenção do paciente mantém a guarda existente contra limpeza/transferência; novos vínculos recusam paciente marcado. A ausência efetiva do usuário dentro de sua cascata permite SET NULL legítimo, sem usar profundidade de trigger como autorização na guarda nova.

## Provas executadas

- Novo teste SQL reproduziu **oito falhas** antes da migration: ator do histórico compartilhado, remoção/troca do marcador, contato por ator em exclusão, auditoria/reserva indireta e vínculo de paciente marcado. Todas foram corrigidas.
- `node scripts/test-reception-deletion-concurrency.mjs --before-barrier`: sete pares inseguros entre oito ordens. O link público com snapshot antigo já era recusado pela alteração da linha do paciente; essa proteção foi preservada.
- `npm run test:db`: **53 migrations/32 suítes SQL**, concorrência anterior da recepção e **oito ordens dirigidas de exclusão**, tudo aprovado com as migrations reais. Inclui a S3 do Claude (`2e5b844`) disponível durante a execução.
- As oito ordens cobrem ator service-role, caso não confirmado, marcador antigo, RPC antiga, reserva indireta antiga, intenção de paciente antiga, vínculo público antigo e auditoria criada antes de existir o futuro agendamento. A asserção exige código/mensagem específicos e verifica qual transação permaneceu; permissão negada, FK inválida e no-op não contam como prova.
- Observer temporário no SQL comprova ordenação real dos triggers e incremento antes de ambos os pré-checks de INSERT/UPDATE no upsert. Outro teste fornece autor em exclusão no INSERT e confirma que o carimbo do ator autenticado substitui esse valor antes da guarda AFTER.
- Cascata real de conta sintética com paciente e agenda particular, exclusão de paciente marcado, data original do marcador, repetição/retomada, preservação do histórico alheio e ACL privada aprovadas.
- `npx vitest run src/lib/securityHandlers.test.ts`: **26 testes aprovados**, incluindo recusa anterior à limpeza e retomada em falha de Storage.
- `node --check` dos três runners alterados: aprovado.

O ensaio agora integra `npm run test:db` por um wrapper que sempre cria seu próprio banco descartável, sem receber alvo de banco externo. `--before-barrier` é diagnóstico intencionalmente vermelho para a versão anterior; o modo padrão precisa passar. O protótipo de T27/2a é evidência histórica, não a correção aplicada pelo teste padrão.

## Revisão e ajuste de contrato

Revisão adversarial local encontrou duas lacunas de prova: corridas indiretas e ordem/upsert/carimbo final. Ambas foram tratadas com os testes acima; segunda leitura sem achado substantivo. Revisão externa dispensada conforme preferência do usuário.

A barreira pode recusar uma reserva com `40001` antes do conflito de horário `23P01`. O teste anterior foi ajustado para aceitar esses dois resultados no concurso e, depois do commit vencedor, fazer retry fresco que obrigatoriamente recebe `23P01`. As contagens de agendamentos/pacientes continuam protegendo contra órfãos e duplicação.

## Limite operacional

A linha é global e pode recusar escritas concorrentes de escopos distintos. Capacidade e experiência de retentativa precisam ser ensaiadas no piloto (T25); não foi feita medição de carga nem ativação. Nenhuma transação permanece aberta durante chamada externa. Testes usaram apenas dados sintéticos, sem Storage real, exclusão real, API paga, push ou deploy. Não houve alteração de tela ou novo ensaio de navegador nesta etapa.
