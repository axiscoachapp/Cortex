# T28/2b/2b — anuência médica para delegação à recepção

04/11/2026. Contrato da integração completa. A fundação privada `04230000` e a [ponte de decisão/concessão `04240000`](../../reviews/2026-11-04/delegation-decisions/IMPLEMENTATION.md) implementam parte do banco localmente; **corte geral dos grants legados, RPCs autenticadas e interface continuam pendentes, M2 aberta**. Nenhuma publicação. D18 limita a operação à clínica; prontuários continuam privados. [Contexto e correções anteriores](ADMINISTRATIVE_SCOPES.md), [agenda da clínica](CLINIC_CALENDAR_BOUNDARY.md) e [cadastro único](SINGLE_PATIENT_REGISTRATION_CONTRACT.md) permanecem válidos.

## 1. Limite e comportamento

No estado local, `05000000` corta o INSERT autenticado pelo setter antigo e `05010000` impede transferir a identidade de um escopo por UPDATE. O provisionamento de serviço ainda cria `staff_doctor_scopes` a partir da seleção do gestor, e os escopos existentes continuam eficazes até o corte/reconciliação. Saída e inativação removem concessões, mas não provam que o médico concordou. M2 continua aberta até a implementação, integração e prova deste contrato.

O gestor solicita acesso de uma conta dedicada de recepção a um médico da mesma clínica. **Somente esse médico aprova ou recusa.** Ele também pode revogar uma aprovação. O gestor pode retirar o pedido/acesso ou desativar a conta, mas não aprovar pelo médico. Mesmo sendo médico, um gestor só decide os pedidos em que ele é o médico de destino. A recepção não solicita/aprova a própria permissão. Nenhuma nova delegação a contas de administração/médico como se fossem secretárias.

A permissão aprovada é uma capacidade fixa e explícita `clinic_reception_v1`: operar os fluxos administrativos já autorizados de contatos, vínculos mínimos, fila e agenda **daquela clínica/médico**. Não abre consultas, notas, anexos, conversas, documentos ou agenda sem origem da clínica. A própria agenda do médico, a gestão da equipe e a fila sem médico preservam suas capacidades independentes. T34/intake não substitui anuência nem compartilhamento clínico.

## 2. Pedido e permissão efetiva

Um pedido tem UUID novo do servidor e identidade imutável `(clinicId, staffUserId, doctorUserId, capabilityVersion)`, `revision` inteira positiva, origem, solicitante, datas e decisão mínima. Uma mudança na identidade/capacidade exige outro pedido, nunca UPDATE do destinatário. No máximo um pedido `pending` ou `approved` por par clínica/recepção/médico. Nomes são projeções atuais, não chaves de identidade.

`staff_doctor_scopes` passa a representar apenas concessões efetivas e deve apontar para **o pedido exato aprovado**, com identidade coerente e referência não reapontável. Pedido pendente, auditoria, data de criação, `created_by`, papel admin ou permissão antiga não substituem aprovação. A leitura operacional exige simultaneamente pedido aprovado, concessão correspondente, clínica correta e membros/contas ativos e disponíveis. Nenhum cache ou JWT contém aprovação suficiente por si só.

| Estado atual | Ação humana autorizada | Resultado atômico |
|---|---|---|
| Ausente | Gestor solicita | Novo UUID, `pending`, revisão inicial; sem escopo |
| `pending` | Médico aprova | `approved`, revisão incrementada e escopo correspondente |
| `pending` | Médico recusa | `denied`, revisão incrementada; sem escopo |
| `pending` | Gestor retira | `cancelled`, revisão incrementada; sem escopo |
| `approved` | Médico revoga ou gestor retira | `revoked`, revisão incrementada e remoção do escopo |
| `pending`/`approved` | Saída/inativação/exclusão aplicável de membro | `cancelled`/`revoked` com causa de ciclo de conta; sem escopo |
| Terminal | Nova solicitação do gestor | Outro UUID em `pending`; o anterior permanece terminal |

`denied`, `cancelled` e `revoked` não são reabertos. Remover/recriar um escopo para o mesmo par não permite reutilizar um pedido aprovado anteriormente: DELETE encerra a concessão/pedido atomicamente; nova concessão requer novo pedido e nova aprovação. Saída/reingresso do médico e inativação/reativação da recepção invalidam **também pedidos pendentes**, ainda que não exista escopo para remover. Exclusão/reinserção privilegiada de uma filiação não recupera pedidos antigos. Integridade e guardas de ciclo devem cobrir esses escritores, sem depender só das RPCs.

## 3. Operações propostas

As interfaces públicas abaixo são propostas; helpers privados de pedido/decisão/cancelamento/revogação já existem, sem EXECUTE para clientes/service role. Toda entrada é validada e a sessão humana/MFA, identidade clínica ou administrativa, clínica ativa aplicável e conta disponível são verificadas **antes** de retornar recurso, revisão ou resultado anterior. `actorId`, médico decisor, datas, origem e estado autorizado são derivados pelo servidor; cliente não os escolhe.

| Operação | Entrada | Resultado e autorização |
|---|---|---|
| `request_reception_delegation` | `clinicId`, `staffUserId`, `doctorUserId`, `operationId` UUID | Gestor ativo cria ou obtém pedido corrente idêntico; nunca concede. Ambos os destinatários ativos na mesma clínica |
| `decide_reception_delegation` | `requestId`, `expectedRevision`, `decision: approve\|deny`, `operationId` | Médico do próprio pedido decide somente `pending`; aprovar grava pedido+escopo+evento juntos |
| `withdraw_reception_delegation` | `requestId`, `expectedRevision`, `operationId` | Gestor retira `pending` ou `approved`; médico do pedido revoga `approved`. Nunca outro médico/recepção |
| `list_reception_delegations` | `clinicId`, `cursor?`, `limit?` | Gestor vê gestão da própria clínica; médico vê somente pedidos dirigidos a ele. Não pressupõe acesso à agenda para poder aprovar |

DTO estrito por item: `{id, clinicId, staffUserId, staffName, doctorUserId, doctorName, capabilityVersion, state, revision, requestedAt, decidedAt, endedAt, endReason}`. Sem pacientes, credenciais, e-mail de login, texto clínico ou anotação livre. A confirmação mostra conta e médico concretos; homônimos são diferenciados pelo identificador da conta. Metadados internos de idempotência não são expostos. Lista tem limite padrão 25/máximo 100 e cursor opaco por `(requestedAt,id)`; sem truncamento silencioso ou total de outra clínica. Filtros de autorização precedem paginação e agregados.

UUID identifica a instância; revisão é CAS. Cada transição valida a revisão após adquirir a linha e revalidar a autorização atual. Não resolver apenas pelo par de pessoas, nem aprovar a linha nova por um clique destinado à antiga (ABA). Revisão não reinicia nem faz wrap dentro de um pedido. Perda de resposta não exige repetir uma concessão: servidor registra `operationId` único por ator/operação, hash dos parâmetros e resultado junto com o efeito. Repetição exata não duplica evento; mesmo ID com parâmetros distintos falha. Histórico de idempotência não é permissão: após revogação/inativação, não devolver resultado antigo como acesso vigente. Repetição de aprovação com outro ID só pode ser um no-op se o mesmo pedido ainda estiver aprovado e a autorização atual for válida; não restaura escopo apagado.

Erros seguem a camada atual de RPC/API, com códigos dedicados mapeados estritamente: falta de sessão/permissão `42501`, parâmetros `22023`, revisão/estado concorrentemente alterados `40001`. Recurso inexistente/externo retorna a mesma indisponibilidade sem revelar dono/estado. A UI preserva rascunho, atualiza a lista e pede nova revisão humana em conflito; não reexecuta automaticamente uma aprovação contra outra revisão/UUID.

## 4. Concorrência, custódia e liberação de trabalho

Concessão e revogação são transações curtas, sem chamadas externas. Usar as barreiras privadas por conta/recurso de T33, cobrindo solicitante/decisor/recepção/médico e referências NEW/OLD; não introduzir um singleton global. A definição de locks deve ser provada em READ COMMITTED e REPEATABLE READ antes de escolher DDL. Depois da linha/CAS, aquisição de conta/recurso não pode aguardar outro escritor que esteja esperando essa linha; usar protocolo não bloqueante e abortar a transação inteira quando necessário. Advisory lock sozinho não atualiza snapshot.

Aprovação versus inativação/saída, retirada versus aprovação, uso operacional versus revogação e dois pedidos para o mesmo par têm que serializar ou recusar uma transação integralmente. Se a operação administrativa adquiriu autorização antes da revogação, pode terminar dentro da transação já serializada; após o commit da revogação nenhuma **nova** operação pode usar a permissão antiga. Não alegar cancelamento retroativo de uma ação concluída.

Remoção libera atribuições de trabalho aberto uma vez, usando os mecanismos existentes. Casos encerrados, beneficiário/autoria do compromisso, contato, prontuário e histórico clínico são preservados. Pedidos/decisões são novas referências administrativas compartilhadas: integrar o inventário/guardas de custódia e exclusão de conta, inclusive pedido pendente sem escopo. Escrita service role também deve respeitar as guardas; não oferecer RPC que aceite um ator arbitrário para aprovar em seu nome. Política de retenção/anonimização de história segue T24/T32, sem cascata clínica automática nem dados pessoais nos eventos.

## 5. Compatibilidade e reconciliação

Não ativar só a nova UI mantendo o setter antigo capaz de conceder. No corte do backend, `update_reception_staff(...,p_active=true)` e o helper antigo não podem criar/restaurar permissões. O caminho antigo de desativação continua disponível. Operações novas por pedido substituem o setter de arrays; lista antiga/stale não pode retirar/recriar aprovações recentes. Ativação de conta fica separada da solicitação de agendas e não restaura pedidos.

`create-clinic-receptionist`/`provision_clinic_receptionist` passam a criar identidade e **solicitações pendentes**, não concessões. A resposta não pode chamar seleção de agendas de aprovação. O erro ambíguo de provisionamento não justifica apagar uma identidade já criada: reconciliar pelo registro da operação/filiação. O fluxo de credencial inicial continua bloqueado pela solução T31 correspondente; anuência não aprova a senha temporária atual.

No corte, escopos ativos atuais sem prova explícita de anuência **não ficam eficazes por exceção/grandfathering**. Gerar pedidos pendentes de revisão com origem de reconciliação/solicitante de sistema distinto de aprovação e retirar escopos correspondentes na mesma transação, liberando trabalho pelos mecanismos existentes. Não inferir consentimento de quem criou a conta nem escolher médico por dados do legado. Exibir o impacto agregado no piloto antes de aplicação hospedada. Nenhuma mudança hospedada ou revogação em massa é executada por este documento.

Instalação/retentativa deve ser atômica, usar snapshot apropriado e recusar contenção sem deixar meia migração. Provar compatibilidade de transações anteriores ao corte; reader/writer antigo não pode conceder ou usar escopo legado após o commit. Reverter UI não reabre as concessões antigas; rollback de dados/guardas exige plano específico e não pode restaurar acesso sem aprovação.

## 6. Aceite antes de integrar

| Prova sintética no banco real descartável | Critério |
|---|---|
| Admin A pede agenda B; secretário; médico C; outra clínica; MFA incompleto; service/anon | Só B decide; pedido não concede acesso nem revela carteira/notas. Negativas dedicadas, não qualquer erro |
| Aprovar/recusar/retirar/revogar e repetir após perda de resposta | Estado/escopo/evento consistentes; mesma operação sem duplicação; payload distinto recusado |
| Pedido A revogado e pedido B criado para o mesmo par | Aprovação antiga por UUID/revisão ou repetição da operação A não afeta B |
| Inativar/reativar recepção ou sair/reingressar médico | Pedido pendente e aprovado encerrados; flag-only não recupera nada; nova aprovação funciona |
| DELETE/UPDATE/INSERT privilegiados de escopo, pedido e filiação | Não muda identidade, reaponta aprovação, deixa pedido latente ou permite aprovação sem decisor legítimo |
| Duas conexões, ordens invertidas, RC/RR e espera realmente observada | Aprovação/saída, aprovação/retirada, dois pedidos e uso/revogação não deixam acesso residual ou deadlock não tratado |
| Revogação com fila/compromissos/rascunho/história | Trabalho aberto liberado uma vez, encerrado e identidade clínica preservados |
| Reconciliação/instalação com transação antiga, falha e retry | Nada parcial; nenhum escopo sem anuência eficaz após corte; custódia/guardas existentes passam |
| DTO/lista/cache por ator e interface antiga | Sem dados excessivos/fallback de lista; troca de ator limpa estado, erro bloqueia concessão e desativação segue possível |

SQLs de regressão em `supabase/tests/`, corridas em `scripts/`, RPC/DTO em `src/features/reception` e a entrada do médico em seu fluxo clínico próprio. Usar o runner protegido `npm run test:db` e acrescentar provas dirigidas com deadlines/cleanup, além de testes dos formulários e navegador isolado a 150% quando houver UI. Comandos concretos da nova prova serão definidos com o incremento executável, sem fingir que já existem.

Sequência pequena: **2b/1 contrato** → **2b/2 prova dirigida de protocolo/instalação e backend** (reservar migration antes) → **2b/3 API/UI de pedidos e decisão** → regressão integrada/piloto. T34, schema/carregador de importação, envio WhatsApp, fiscal, IA e publicação permanecem trabalhos separados. Este contrato não altera arquivos do Claude.

Progresso em 04/11 11:08: [protocolo ensaiado em laboratório](../../reviews/2026-11-04/consent-protocol/IMPLEMENTATION.md), com UUID/CAS/idempotência e lifecycle. É prova parcial da etapa 2b/2; nenhum gate/RPC/schema de produção implementado. Não copiar o predicado do snapshot nem promover o SQL de laboratório a migration sem as provas/integrações restantes.

Progresso em 04/11 11:54: [fundação privada implementada](../../reviews/2026-11-04/delegation-request-foundation/IMPLEMENTATION.md) em `20261104230000`, com pending/cancelled e operações/lifecycle/custódia, sem API autenticada ou aprovação. Aprovação, concessão eficaz, origem de reconciliação e corte do legado exigem a próxima migration; os estados/guardas atuais recusam aprovação. M2 permanece aberta.

Progresso em 04/11 16:00: depois da decisão médica privada `20261104240000` e da preservação de aprovações `20261104250000`, o [corte autenticado parcial](../../reviews/2026-11-04/authenticated-legacy-cut/IMPLEMENTATION.md) em `20261105000000` recusa INSERT efetivo sem pedido pelo escritor autenticado antigo. Preserva no-ops de arrays, remoções e desativação; duas ordens reais com cliente antigo RC/RR e instalação atômica verificadas. **Não é corte geral:** provisionamento de serviço, UPDATE privilegiado legado, reconciliação dos escopos eficazes e leitores sobre pedido+grant continuam pendentes, antes das APIs/UI de anuência. Não usar o legado como exceção de aprovação nem encerrar M2.

Progresso em 04/11 16:26: [identidade do escopo legado protegida](../../reviews/2026-11-04/legacy-scope-identity/IMPLEMENTATION.md) em `20261105010000`. UPDATE não transfere clínica/recepção/médico, inclusive serviço/escritor sem JWT; adoção do mesmo escopo por aprovação real preservada. RED real e duas ordens de instalação com backend/snapshots antigos RC/RR, 67/45 completos e 38 grupos de upgrade verificados. O UPDATE privilegiado de identidade deixa de ser uma exceção; serviço INSERT, reconciliação/eficácia do legado e gate operacional continuam pendentes.
