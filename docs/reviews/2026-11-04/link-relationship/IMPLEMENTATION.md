# T05b/3 — base da correção administrativa de relação

04/11/2026. Entrega de banco/API local, sem editor visual, publicação, dados reais ou mudança de IA. Revogação/reativação permanecem pendentes.

## Comportamento

A migration `20261103003800_reception_link_corrections.sql` fornece uma leitura mínima de um vínculo identificado por contato/paciente e correção de relação por revisão esperada. Só a administração ativa da mesma clínica pode usar o editor; sessão/MFA, disponibilidade da conta, paciente e médico são verificadas no servidor. Médico comum, secretária, admin externo e serviço não recebem esse poder.

Clínica, contato, paciente, médico e confirmação original ficam imutáveis também em escrita direta. A revisão, data e ator da correção são mantidos pelo banco. No-op preserva a revisão; versão antiga falha com `40001`. Auditoria registra IDs, revisão e enums da relação anterior/nova, sem copiar nomes ou conteúdo clínico. Exclusão física e TRUNCATE pelo serviço são recusados.

O backfill de metadata usa a confirmação já conhecida, sem inventar correções históricas. O snapshot separado mantém intactos os DTOs anteriores. `active: true` descreve o estado implícito atual; a coluna de atividade e o fluxo de suspensão ainda não existem. Admin pode consultar o snapshot de paciente arquivado/médico inativo, mas a correção é recusada nesses estados.

## Evidências

- Antes da guarda, o teste conseguiu mover um vínculo para outro contato e falhou com `Existing link identity moved to another contact`.
- **49 migrations e 28 suítes SQL passaram** em PostgreSQL 16 descartável. Casos incluem identidade/autoria forjada, exclusão, TRUNCATE, metadata falsa, MFA, atores sem permissão, paciente arquivado, médico desativado, no-op, versão antiga e prontuário privado preservado.
- Duas conexões reais: correção contra confirmação antiga e duas correções com a mesma revisão. Relação vencedora/revisão ficam preservadas; tentativas recusadas não criam eventos extras nem alteram a confirmação original.
- **35 testes da recepção em sete arquivos passaram**, incluindo seis testes novos da API: contrato mínimo, rejeição de campos clínicos, revisão inválida, conflito e permissão. Tipos regenerados de todas as migrations locais; lint sem erros (oito avisos anteriores), typecheck e build aprovados com configuração pública sintética.
- Não houve alteração de tela nesta fatia; não foi executado um novo ensaio de navegador. A suíte geral de 449 testes pertence ao incremento anterior `36b50ef`; não é apresentada como uma nova execução desta entrega.

Revisão adversarial local pediu cobertura do médico desativado. O caso foi acrescentado, incluindo snapshot permitido ao admin, correção RPC/direta recusada, revisão e auditoria intactas. Segunda leitura sem achados remanescentes. **Cross-model skipped: non-interactive context.**

O teste anterior de confirmação passou a capturar a data original em vez de alterá-la na preparação: a nova guarda justamente impede essa alteração. Continuam as asserções de preservação de data/autor e auditoria única. Nenhum limite de timeout ou expectativa de permissão foi relaxado.

## Próximos passos e limites

O editor, listagem paginada e suspensão/reativação de vínculos continuam no T05b. Antes de ampliar a interface, a [revisão cruzada](../claude-reception-review/REVIEW.md) colocou custódia de exclusão (H2) e escopos de agenda (H1) como prioridades T27/T28. Este incremento não resolve esses achados nem autoriza piloto ou carga real. Migrations/Edge/frontend não foram aplicados a serviço hospedado.
