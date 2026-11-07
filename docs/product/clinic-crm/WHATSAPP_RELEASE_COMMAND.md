# K1/4c — adaptador para devolver conversa à fila

Usar act/unassign do contrato WhatsApp v1.2. Entrada local: conversationId, revisão PostgreSQL incrementável e assignedTo do detalhe fresco. assignedTo deve corresponder ao ator esperado; nenhum desses dois campos de identidade entra no transporte. Corpo exato: action/operation/conversationId/revision, com operation unassign. A futura UI só oferece a ação em conversa aberta sob responsabilidade de quem chama.

Recibo estrito: revisão anterior+1, status open e assignedTo null. Uma invocação por clique, sem retry. Erros após início, corpo inválido ou cancelamento tardio exigem releitura antes de outro comando; nunca prometer rollback. Mensagens locais seguras, sem expor dados brutos ou credenciais. Compatibilidade com a classe de erro de atribuição existente permite reutilizar a conferência da UI depois.

A checagem local de proprietário não é autorização de servidor: o produtor atual permite unassign a recepção/admin autorizados e não devolve o proprietário anterior. Esta prova não amplia nem valida essa política. Não alterar produtor/SQL nem afirmar CAS/RLS/concorrência real com o mock. O botão ainda não integra este incremento; deverá usar escopo/detalhe frescos, clique explícito, conferência e gerações já implantados em K1/4b.

Fila, estado aberto, contato, caso, consentimento e agenda permanecem sob as operações existentes; não chamar close/reopen/mark_read/send/vínculos. Testes apenas sintéticos, SDK instalado com fetch em memória e nenhuma rede real. UI/operação real/Meta/hosted/PersonalMed ficam fora deste recorte.
