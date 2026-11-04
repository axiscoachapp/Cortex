# T05b/1 — beneficiário da reserva CRM preservado

03/11/2026. Implementação local com dados sintéticos; sem push, implantação, alteração de banco hospedado ou importação PersonalMed.

## Problema e mudança

Uma reserva CRM podia receber outro `patient_id` se esse paciente pertencesse ao mesmo médico e estivesse vinculado ao mesmo contato. As FKs e a guarda de autoria eram satisfeitas, mas o registro histórico passava a representar outra pessoa.

A migration reservada `20261103003600_reception_appointment_identity.sql` acrescenta uma guarda de linha: quando o compromisso original tem clínica, seu beneficiário não pode ser alterado nem removido. Vale para atualização direta e escritor privilegiado, incluindo uma reserva cancelada. Demais regras de identidade, propriedade, horário e autoria continuam nas guardas existentes. O trigger novo não consulta tabelas nem amplia privilégios.

O calendário médico projeta internamente a origem CRM. O modal fixa o paciente, orienta cancelar e criar nova reserva na recepção e grava o paciente original ao salvar. Nenhum campo foi acrescentado aos DTOs de recepção. Compromissos sem contexto CRM mantêm seu fluxo anterior de edição.

O ensaio visual revelou overflow horizontal no modal a 390 px e escala 150%: a largura mínima do fieldset e os controles em duas colunas excediam o espaço disponível. A correção permite encolher formulário/fieldset, empilha campos e lembretes em telas estreitas e quebra data/ações conforme necessário.

## Evidências

- Reprodução SQL antes da migration: `Existing CRM booking was reassigned to another linked patient`. A primeira tentativa do teste encontrou falta de permissão para ler auditoria; essa asserção foi movida para o contexto de teste privilegiado, sem conceder acesso ao usuário.
- Reprodução do componente antes da alteração: seletor de paciente habilitado em reserva CRM. Após a alteração, os sete testes do modal passaram; notas foram gravadas para o paciente original e o seletor clínico permaneceu habilitado.
- Banco descartável PostgreSQL 16: **47 migrations e 26 suítes SQL aprovadas**, incluindo tentativa com dois pacientes do mesmo contato/médico, remoção do beneficiário, reserva cancelada, escritor privilegiado, edição/encerramento do original, auditoria sem eventos de tentativas recusadas e edição clínica sem contexto CRM. O harness existente de duas conexões também passou.
- Navegador Chromium/Edge isolado, API somente loopback e rede externa bloqueada: **sete verificações aprovadas**, incluindo o caminho real linha do banco → calendário → modal para CRM e clínico, edição de nota e cancelamento. Telas 390/768/1280/1920 px a 150%, sem overflow horizontal no modal e sem erros de página. [Resultados](browser/verification.json), [390 px](browser/crm-390.png) e [1280 px](browser/crm-1280.png). A autorização foi provada no PostgreSQL; o transporte sintético não simula essa prova.
- Suíte geral serial aprovada: **442 testes em 66 arquivos**. Lint sem erros (oito avisos preexistentes), tipos e build aprovados com URL/chave públicas sintéticas explícitas. A execução geral durou cerca de 6,5 minutos, sobretudo pela inicialização isolada do jsdom; não houve falha nem alteração de timeout/configuração.

Revisão adversarial local identificou falta de cobertura da projeção de origem no calendário; o ensaio de navegador resolveu o ponto. Segunda leitura sem problemas remanescentes de contrato. **Cross-model skipped: non-interactive context.**

## Limites e próxima fatia

T05b permanece aberta: estados/revisão de vínculos, revogação/reativação, todos os leitores/escritores e editor administrativo ainda não foram implementados. A presente proteção histórica funciona de forma independente e não expõe um editor incompleto. Nenhuma fusão de identidades, mudança de prontuário, concessão clínica ou campo legal S2 foi realizada.

Não há dados a reverter nesta entrega. O banco de ensaio é descartado automaticamente. Em uma eventual implantação futura, manter esta guarda enquanto a interface é revertida preserva a integridade; qualquer retirada da proteção exige uma decisão específica e ensaio de migração. Nenhum rollback de produção foi executado.
