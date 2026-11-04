# T05a — Retificação de vínculos administrativos

Data: 03/11/2026. Estado: especificação para implementação incremental; **sem migration, alteração de dados ou recurso publicado nesta entrega**. Complementa [T05](../../../tasks/clinic-crm/todo.md) e a [correção de nome/telefone](../../reviews/2026-11-03/contact-corrections/IMPLEMENTATION.md).

## Objetivo e premissas

Permitir à administração corrigir a relação de um contato com um beneficiário ou suspender um vínculo errado, preservando autoria, agenda histórica e prontuários privados. O vínculo é administrativo: não concede leitura de evolução, documentos, receitas ou conversa clínica.

Premissas de implementação derivadas da estrutura atual: correção pela administração ativa da clínica; secretárias mantêm confirmação de novos vínculos dentro de suas agendas; agendamentos já existentes mantêm seus IDs e beneficiário original. S2/identidade legal e importação do PersonalMed ficam separadas.

## Problema existente e acoplamentos

`patient_contact_links` tem chave `(contact_id, patient_id)` e proprietário médico, com relação `self`/`guardian`/`family`/`other`. Agendamentos CRM referenciam essa chave. Apagar ou trocar a chave destruiria referências históricas ou violaria a FK.

`reception_link_patient` hoje atualiza relação e confirmação em `ON CONFLICT`. `BookingDialog` o chama antes de reservar. Só adicionar um editor com revisão seria insuficiente: o escritor antigo poderia desfazer uma correção ou reativar um vínculo sem saber da revogação. Todos os caminhos de gravação precisam participar do novo contrato.

## Invariantes

| Regra | Resultado obrigatório |
|---|---|
| Identidade do vínculo | Clínica, contato, paciente e médico são imutáveis; corrigir relação não move prontuário |
| Histórico | Revogação é lógica; chave e referências anteriores da agenda permanecem |
| Beneficiário de reserva CRM | `appointments.patient_id` também é imutável em registros CRM; proteção entregue na fatia T05b/1, necessária antes de dispensar atividade do vínculo em manutenção histórica |
| Permissão de correção | Sessão humana, MFA quando exigido, conta disponível e admin ativo da mesma clínica, verificados no banco |
| Novo vínculo/reativação | Paciente disponível, proprietário médico correto e profissional ativo da clínica; confirmação explícita do beneficiário |
| Médico ou paciente indisponível | Admin pode suspender um vínculo existente dessa clínica e consultar sua identificação mínima; não pode reativá-lo nem criar reserva para esse profissional |
| Concorrência | Revisão mantida pelo servidor; versão antiga falha sem sobrescrita; nova tentativa não cria outro evento de correção |
| Confirmação antiga | Nunca reativa vínculo inativo nem sobrescreve relação divergente silenciosamente |
| Projeção administrativa | Só identificação mínima, relação, estado e revisão; sem dados clínicos ou campos legais S2 |
| Contato com vínculo suspenso | Não vira um contato novo visível a todas as filas pela regra de órfãos; existência histórica conta nessa regra |
| Compartilhamento clínico | Nenhum `patient_share` criado, removido ou ampliado por retificação administrativa |

Uma revogação neste módulo não representa uma proibição global de uma pessoa/número nem comprova situação jurídica de guarda. Telefones familiares continuam não únicos. Não deduzir identidade, parentesco ou autorização por coincidência de número.

## Modelo e contratos propostos

Adicionar `active`, `revision` e carimbo de atualização a `patient_contact_links`, preservando a chave/FKs. Histórico existente começa como ativo; não inventar um autor ou evento retroativo. Gravação direta por cliente continua proibida; trigger protege identidade e revisão também contra escritores privilegiados.

Editor administrativo separado dos RPCs atuais, para preservar formatos estritos:

- Leitura paginada, até 50 vínculos por contato, com cursor estável. Projeta contato/paciente/médico por ID, nome e nascimento mínimos para conferência, relação, estado, revisão e disponibilidade do paciente/médico. Mostrar indisponibilidade sem liberar o prontuário.
- Comando de correção recebe chave imutável, revisão esperada, ação `relationship`, `revoke` ou `reactivate`; a relação é obrigatória quando aplicável. Servidor deriva clínica, ator e proprietário, trava permissões e vínculo, e reautoriza depois do lock.
- `40001` para revisão antiga; `42501` para ausência de permissão; `22023` para ação/estado inválido. Mensagens não devem revelar prontuário fora da clínica.
- Auditoria registra ator real, IDs, ação, revisão e enumeração da relação antes/depois. Não copia nome, telefone, texto clínico ou justificativa livre para telemetria.

Para um beneficiário errado: suspender o vínculo incorreto e confirmar o correto por ação separada. A interface informa o resultado de cada operação e não promete substituição atômica. Falha na segunda etapa preserva o vínculo antigo suspenso e o histórico; admin pode continuar a confirmação ou reativar, quando permitido. Não reatribuir compromissos antigos automaticamente.

## Compatibilidade de todos os leitores e escritores

1. **Leituras atuais:** contatos/casos/beneficiários retornam somente vínculos ativos no formato anterior. A autorização por vínculo usa só ativos. Na exceção de contato ainda sem qualquer histórico, a verificação de órfão considera vínculos ativos **e inativos**. A permissão administrativa por um caso autorizado continua independente; não prometer que suspender um vínculo apaga o contato do histórico do caso.
2. **Confirmação existente:** criação de chave nova continua no escopo delegado. Confirmação de vínculo ativo com a mesma relação pode ser idempotente; vínculo inativo ou relação divergente exige fluxo explícito. O `ON CONFLICT DO UPDATE` antigo não pode continuar como escritor sem revisão.
3. **BookingDialog:** distinguir vínculo já confirmado de novo candidato, impedir alteração implícita de relação existente e encaminhar retificação à administração. A reserva exige conferir novamente um vínculo ativo no servidor, não confiar na seleção carregada antes.
4. **Reserva concorrente à revogação:** usar a mesma ordem de locks e o mesmo vínculo nas duas transações. Deve existir uma ordem observável: reserva confirmou antes da revogação, ou foi recusada depois; nunca inserir reserva nova com vínculo já revogado.
5. **Agenda histórica e novas reservas:** proteger também `patient_id` na identidade imutável de agendamentos CRM. Cancelamento, confirmação de presença, chegada/desfazer chegada e encerramento clínico do compromisso original continuam permitidos pelo escopo existente, mesmo com vínculo suspenso, preservando o beneficiário original. Criar reserva, reabrir `cancelado` para estado ativo **ou alterar início/término** exige vínculo ativo novamente, sob o mesmo lock. Não permitir que um UPDATE contorne essa regra. Corrigir beneficiário de reserva CRM exige cancelar e criar outra após conferência; nunca reaproveitar o ID para outra pessoa. Agendamentos clínicos sem contexto CRM continuam seguindo as guardas existentes; não afrouxar FKs clínicas. O modal médico antigo precisa receber a informação interna de origem CRM para desabilitar sua troca de paciente, em vez de oferecer uma edição que o servidor recusará.
6. **Aviso histórico:** mostrar a suspensão e a existência de compromissos anteriores no novo editor administrativo. `reception_appointments` e seu DTO estrito ficam intactos; não adicionar um campo de aviso a esse retorno. Uma apresentação futura na agenda exigirá contrato suplementar/versionado e escopo próprio.
7. **Lembretes/comunicação:** o lembrete médico atual usa o contato do próprio paciente e continua independente. Uma futura mensagem que dependa de contato/beneficiário deve validar vínculo ativo e revisão do destino antes de enviar; não aproveitar consentimento antigo. Este módulo não cria integração externa.

## Fluxo de interface

Admin abre os vínculos do contato, confere nome/nascimento/médico, escolhe a operação e confirma sua consequência. Suspender deixa explícito que o histórico permanece e que futuras reservas por esse vínculo serão recusadas. Reativar exige nova conferência. Erro de versão preserva o preenchimento e oferece recuperação explícita do servidor.

Seguir as guardas já verificadas no editor de contato: preservar estado em falha de refetch, congelar revisão-base, bloquear saída durante gravação/recuperação e renovar conferência ao mudar a seleção. Manter marca/escala 150% e testar 390/768/1280/1920 px.

## Verificação antes de publicar

| Cenário sintético | Evidência exigida |
|---|---|
| Admin próprio, admin externo, médico sem administração, secretária, inativo, MFA incompleto e service role | Permissões no SQL, incluindo tentativa direta ao RPC |
| Duas abas corrigindo e confirmação antiga disputando com revogação | Duas conexões PostgreSQL; uma revisão atual e nenhum retorno silencioso ao estado anterior |
| Reserva disputando com revogação | Transações simultâneas e resultado ordenado, sem depender de `pg_sleep` para a integridade |
| Telefone familiar, contato reciclado e dois prontuários por médicos distintos | Confirmação humana; nenhuma fusão de identidade ou acesso clínico |
| Vínculo usado por agendamento e finalização clínica | FK/histórico mantidos; criação, reabertura e remarcação recusadas após suspensão; cancelamento, chegada e encerramento existentes continuam funcionando |
| Médico troca `patient_id` de CRM para outro beneficiário do mesmo contato | Escrita direta recusada; modal informa cancelamento/novo cadastro de reserva; nenhuma associação clínica é remapeada |
| Único vínculo suspenso, sem casos; contato com caso autorizado; médico desativado | Sem promoção a fila geral por órfão; política de caso preservada; reativação inválida recusada |
| Sair/voltar, falha de rede, retorno tardio e retry | Preenchimento/revisão preservados e auditoria sem duplicação |

Comandos de verificação: `npm run test:db`, `npx vitest run src/features/reception`, `npm test`, `npm run lint`, `npm run build` com variáveis sintéticas explícitas, e `node scripts/reception-browser.mjs` com artefatos isolados. Migration só será criada após reserva no ESTADO; S1 `04000` permanece futura e independente.

## Fatias de execução

1. Provar SQL de estados, autorização e escritores antigos contra regressões de agenda clínica; manter o recurso de edição oculto até o contrato completo.
2. Provar corrida reserva/revogação e leitura mínima/paginação; atualizar tipos e adaptador sem quebrar projeções existentes.
3. Entregar editor administrativo e fluxo de conferência da reserva, com navegador/guardas; só então marcar a funcionalidade implementada. Especificação pronta não equivale a recurso disponível.

## Revisão do contrato

Primeira fatia implementada separadamente: [T05b/1 — beneficiário da reserva CRM](../../reviews/2026-11-03/appointment-identity/IMPLEMENTATION.md), migration `03600`. O ciclo completo de vínculo continua pendente e exigirá nova reserva; esta especificação não representa entrega do editor.

Revisão adversarial local concluída. Foram incorporadas três correções de desenho: proteger o beneficiário de reserva CRM, classificar reabertura/remarcação como novas reservas e limitar o aviso histórico a um contrato separado do DTO atual da agenda. Segunda leitura não identificou contradição remanescente no contrato revisado. **Cross-model skipped: non-interactive context.** Não há evidência de implementação ou testes de runtime de T05a nesta entrega de especificação.
