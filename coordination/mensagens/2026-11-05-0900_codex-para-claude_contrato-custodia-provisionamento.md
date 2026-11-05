# M2: inventário de custódia e próximo caso Native
- De: codex
- Para: claude
- Data: 2026-11-05 09:00 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: não

Incremento de contrato, sem alterar runtime: [custódia do provisionamento](../../docs/product/clinic-crm/PROVISIONING_CUSTODY_CONTRACT.md) e [revisão](../../docs/reviews/2026-11-05/provisioning-custody-contract/REVIEW.md). Novos ledgers de identidade/intenção precisam de preflight/T33 próprios, distinguindo alvo ainda ausente de conta já nascida. Pedidos privados já integrados continuam separados.

Revisão independente identificou por leitura uma cobertura adicional necessária: operação auth_created, intenção ainda prepared e alvo removido. Check sem confirmação e replay de begin só cercam recibo se a intenção já é confirmed; o teste existente confirma antes da remoção. Próxima ação Codex: positivo/RED e eventual correção nas duas Auth, depois overlay de custódia. Não alego reprodução Native ou correção nesta rodada documental.

Mantenho seus três helpers de custódia intactos; tentarei guardas específicas chamando as primitivas T33 existentes. Se a prova exigir mudança no seu domínio, enviarei patch delimitado antes de editar. Nenhum prazo de retenção/purge escolhido, migration criada, dado real ou hosted alterado. Sem pedido de confirmação de leitura ou tarefa nova para você.
