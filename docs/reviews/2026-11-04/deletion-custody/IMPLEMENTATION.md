# T27/1 — Pré-check de custódia administrativa

04/11/2026, Codex. Migration reservada `20261104001000`. Escopo local, com dados sintéticos e PostgreSQL 16 descartável. **T27/H2 continua aberta:** esta etapa não resolve escritores em andamento nem corridas entre o pré-check e a limpeza externa.

## Correções verificadas

`assert_deletion_scope` agora distingue a agenda privada que pode desaparecer junto com seu proprietário de referências administrativas impeditivas. Os carimbos `created_by`/`updated_by` da própria agenda não bloqueiam essa cascata. Uma reserva com clínica, auditoria ou referência de `reception_booking_requests.appointment_id` continua impedindo exclusão.

O pré-check passou a incluir médico/secretária nas delegações, médico de casos de qualquer status, médico de bloqueios e autoria original/atualização de vínculos. Permanecem as verificações de contatos, notas, rascunhos, auditoria, pedidos de reserva e autoria em agenda de terceiros, além das proteções clínicas/compartilhamento anteriores. A intenção de exclusão existente já executa esse pré-check novamente em seu trigger; nenhuma mudança de Edge foi necessária.

`reception_actor_allowed` recusa o médico cujo pedido de exclusão já está visível. A gestão de equipe entra sem médico individual; por isso `set_reception_scopes` verifica também todos os médicos selecionados antes de alterar delegações. Não há mudança de papéis, delegação administrativa, acesso a prontuários ou confirmação humana de agendamento.

## Reprodução e evidências

O primeiro teste falhou antes da correção com cinco resultados: agenda própria bloqueada; delegação, caso encerrado, bloqueio e autor de confirmação indevidamente permitidos. Uma fixture inicial sem `kind` foi corrigida antes dessa reprodução comportamental.

A leitura adversarial encontrou dois casos adicionais, ambos reproduzidos juntos antes da correção: `booking-reference-allowed` e `deleting-doctor-delegation-allowed`. Foram corrigidos e a segunda leitura do patch não encontrou outro problema substantivo no escopo T27/1.

- `npm run test:db`: **51 migrations, 30 suítes SQL**, mais o ensaio existente de concorrência da recepção, todos aprovados após a última alteração do banco. Esse ensaio existente não prova concorrência da exclusão.
- Reexecução focal do teste de custódia em outro banco descartável, após tornar explícita a asserção de recusa da delegação: aprovada.
- O teste novo recusa intenções inseguras sem persistir o marcador, exige recusa de busca/criação de caso/delegação após marcador visível e executa a exclusão completa de uma conta sintética com agenda privada criada/editada autenticadamente. A cascata real foi aprovada; o histórico administrativo alheio permanece. A transação inteira é revertida.
- `npx vitest run src/lib/securityHandlers.test.ts`: **26 testes aprovados**, incluindo a recusa por custódia antes de Storage/metadados/exclusão de conta e falha de limpeza.
- Revisão local independente concluída. Revisão externa não executada, conforme preferência anterior do usuário e execução não interativa.

Não houve alteração de tela, novo ensaio de navegador, exclusão real, acesso a pacientes reais, publicação ou aplicação em banco hospedado.

## T27/2 — Próximo incremento obrigatório

Definir e testar uma barreira comum entre intenção de exclusão e criação de referências, incluindo todas as referências de **ator e médico**, escritores públicos e caminhos privilegiados. Provar duas conexões, retomada e snapshots antigos em `REPEATABLE READ`, antes de encerrar H2 ou avançar para H1/editor.

Foi rejeitada uma proposta que adicionava locks de associação antes do advisory lock do usuário. A revisão identificou inversão com compartilhamento/convites (que começam pelo advisory), referências de ator não protegidas e snapshots antigos que locks sem atualização não invalidam. Esses achados foram classificados como válidos e a proposta não entrou no código. A próxima solução deve ter ordem comum de locks e versão/barreira verificável, sem supor que bloquear somente quatro tabelas por médico resolve o ciclo inteiro.

Referência primária para o desenho de locks: [PostgreSQL 16 — Explicit Locking](https://www.postgresql.org/docs/16/explicit-locking.html). O mecanismo ainda precisa ser escolhido e provado em testes; este relatório não declara esse desenho implementado.
