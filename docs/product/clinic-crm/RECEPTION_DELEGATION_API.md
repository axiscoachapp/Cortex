# Pedidos de acesso para contas existentes

05/11/2026. Incremento de T28/2b/3 sobre [anuência médica](DOCTOR_DELEGATION_CONSENT.md). Não encerra o corte/reconciliação do provisionamento antigo.

As novas RPCs são chamadas com o JWT autenticado do usuário. Não recebem actorId, papel, origem ou concessão no corpo. Sessão, clínica, vínculo e médico são validados pelos helpers privados existentes. Somente o médico de destino decide; o gestor solicita/retira/revoga, inclusive quando também é médico, sem decidir por outro.

| RPC | Entrada | Saída |
|---|---|---|
| `reception_delegation_requests` | clínica opcional, par cursor createdAt/id opcional, limite1–100 (50 padrão) | página `{canManage,items,nextCursor}`; sem clínica lista apenas pedidos do médico atual em clínicas com filiação ativa; clínica explícita exige gestor ativo |
| `reception_request_delegation` | clínica, recepção existente, médico, UUID da operação | snapshot `{id,state,revision,capabilityVersion}` |
| `reception_decide_delegation` | pedido, revisão, approve/deny, UUID da operação | mesmo snapshot |
| `reception_cancel_delegation` | pedido, revisão, UUID da operação | mesmo snapshot |
| `reception_revoke_delegation` | pedido, revisão, UUID da operação | mesmo snapshot |

Cada item da página contém apenas identificação administrativa: pedido/clínica/nomes atuais da clínica, recepção e médico, estado, revisão, capacidade fixa, data, permissão efetiva e ações disponíveis. Não contém paciente, CPF, telefone, prontuário, texto clínico, sessão, fatores ou credenciais. Ordenação por createdAt/id decrescentes e cursor composto; sem offset ou leitura ilimitada.

`effective` exige pedido aprovado e escopo vinculado àquele pedido/identidade, com membros disponíveis. Flags de ação são orientações para a tela; as ações revalidam tudo no servidor. Nenhum SELECT/DML direto nos ledgers é concedido ao cliente, e anon/recepção/service não ganham acesso às RPCs.

Repetições mantêm a mesma operação e entrada; edição de alvo/ação/revisão usa nova operação. Conflito40001 pede atualização/revisão humana, sem reaplicar aprovação automaticamente. Falha de transporte mantém a operação enquanto se verifica o resultado. Nenhuma aprovação é inferida de grants legados, do cadastro da conta ou de um resultado de idempotência antigo.

Interface: gestão abre o fluxo a partir de Equipe e permissões e solicita para contas existentes; médico tem página própria para decidir/revogar. Explicar que a capacidade abrange contatos/vínculos mínimos/fila/agenda da clínica e mantém conteúdo clínico privado. Cache por ator/escopo; negativas bloqueiam a leitura anterior. Escala135% preservada.

Rota `/permissoes-recepcao`: médico vê os próprios pedidos; `?clinica=<uuid>` abre gestão validada no servidor, com seleção de contas existentes ativas da clínica atual. Aprovar/revogar exige confirmação explícita com recepção, clínica e médico. Atualização40001 fecha a confirmação antiga e pede nova revisão; transporte preserva UUID. Paginação conserva o timestamp original com microssegundos. Conta/escopo novos remontam a tela; polling15s e foco atualizam os pedidos, sem executar decisões automaticamente. A tela diferencia aprovação de acesso efetivo e explica que acessos anteriores continuam na equipe.

Aceite: testes de SQL/ACL/RLS com médico correto, gestor, outro médico, outra clínica, recepção, anon e serviço; pending sem grant, aprovação/recusa/revogação atômicas, replay/CAS, paginação e negação de prontuários. Testes da API/DTO e interface com confirmação explícita da pessoa, UUID estável, falha e troca de conta. Somente dados sintéticos e ambiente descartável/isolado. Migration reservada no ESTADO antes da criação; nenhuma aplicação hospedada.
