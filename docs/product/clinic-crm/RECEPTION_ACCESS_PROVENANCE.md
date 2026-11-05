# Origem dos acessos atuais da recepção

T28/2b/3b,05/11/2026. Leitura administrativa, sem reconciliar ou conceder acesso.

`reception_staff_permissions(p_clinic,p_staff,p_after uuid default null,p_limit integer default50)` exige JWT e administrador ativo da clínica, conta de recepção da mesma clínica e sessão válida. Nega recepção/médico sem gestão/outra clínica/anon/service. Usa a mesma autoridade privada dos pedidos; flags/membership mudados não podem manter leitura de snapshot antigo. Sem expor ledger ou conteúdo clínico.

Retorna `{items,nextCursor}` com no máximo100 registros, ordenação crescente/cursor por UUID do médico. Cada item tem exatamente `{doctorId,doctorName,source,requestId,effective}`. `source=physician_approval` só com pedido aprovado, capacidade `clinic_reception_v1` e identidade clínica/recepção/médico exatas; `legacy` só com referência nula; `unverified` com referência não validada. `requestId` só aparece na classificação comprovada, nulo nos outros casos. `effective` usa o predicado operacional canônico atual, separado da prova de anuência. Um legado pode estar operacionalmente ativo e ainda não ter aprovação comprovada.

UI carrega os detalhes sob demanda por conta; cache por ator/clínica/recepção, refresh negado oculta linhas antigas. Explica claramente a distinção entre acesso e aprovação. Link para a página de pedidos/revogações da clínica, que revalida revisão/autoridade antes de qualquer retirada. Não muda setters, não aprova automaticamente e não apresenta esta lista como corte/reconciliação do legado. Tipos/DTO estritos; testes SQL com papéis distintos, grant legado e aprovação, paginação, privacidade e ausência de escrita.
