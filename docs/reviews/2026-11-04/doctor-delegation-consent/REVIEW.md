# Revisão local do contrato de anuência médica

04/11/2026. Artefato: [DOCTOR_DELEGATION_CONSENT.md](../../../product/clinic-crm/DOCTOR_DELEGATION_CONSENT.md). **Somente contrato; não é implementação ou aprovação de produção.**

Hipótese avaliada: separar pedido e concessão, com decisão do médico e identidade/revisão por instância, define um caminho de implementação que não reaproveita permissão antiga após revogação ou ciclo de conta. Importa porque o setter atual concede por seleção do gestor e a chave composta do escopo, sozinha, não identifica uma aprovação humana específica.

Leitura do Codex conferiu `set_reception_scopes`, provisionamento, guardas de autorização, FK/ACL das tabelas, lifecycle do médico/recepção e barreiras de custódia T33. O contrato inclui substituição dos writers antigos, requests pendentes na custódia, invalidação mesmo sem escopo, reconciliação sem consentimento inferido e proteção contra retorno de resultado idempotente revogado.

Um revisor local em contexto independente recebeu o artefato e invariantes externos, sem esta hipótese ou raciocínio. Não encontrou achado concreto após procurar bypass de administração, ABA, idempotência, reingresso, writer antigo e custódia de pendentes. Revisão encerrada em uma leitura, sem elevar ausência de achados a prova de correção. Nenhuma edição ou execução de banco pelo revisor. Revisão externa dispensada pelo usuário.

O §6 define provas exigidas antes de implementação/integração: banco real descartável, duas conexões RC/RR, espera observada, corte com transações antigas, rollback/retentativa, fila/agenda/história e negativa de autorização dedicada. **Nenhuma nova suíte SQL, migration, RPC, modelo de paciente ou UI foi implementada/testada nesta rodada.** Os 49 testes de documentos reexecutados nesta rodada verificam a correção do Claude, não este contrato; evidência separada em [revisão da RCE](../controlled-prescription-cross-review/REVIEW.md).

Próxima fatia T28/2b/2b/2: prova dirigida e backend, reservando migration antes de criar. M2 permanece aberta. Sem importação, dados reais, banco hospedado, envio ou publicação.

Verificação documental: 116 links locais em oito documentos conferidos, sem destino ausente; `git diff --check` aprovado. Nenhuma repetição de build/typecheck/suítes de banco para esta mudança documental.
