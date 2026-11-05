# Revogação explícita pelo cartão da equipe

T28/2b/3c,05/11/2026. Somente aprovação vinculada; legado/unverified não ganham retirada inferida por este caminho.

Nova leitura `reception_delegation_withdrawal(p_request uuid)` exige sessão clínica autenticada e administrador ativo da clínica do pedido; conta Auth atual, autoridade e pedido são cercados por locks NOWAIT. Somente pedido aprovado/capacidadev1/identidade exata e escopo atual vinculado retornam. Indisponível ou sem permissão recebe42501, contenção40001. Sem EXECUTE anon/service ou acesso ao ledger. Não altera DTOs das listas existentes.

Retorna exatamente `{id,clinicId,clinicName,staffId,staffName,doctorId,doctorName,revision,state:'approved',capabilityVersion:'clinic_reception_v1'}`. O cartão consulta ao abrir, confere a identidade contra a linha escolhida e só então oferece confirmação com clínica/recepção/médico. Nenhuma escrita ao abrir/cancelar. Legado mantém orientação para gestão/reconciliação separada.

Confirmar chama o `reception_revoke_delegation` existente por `delegationApi.change`, com revisão lida e UUID estável por ator/pedido/revisão. Transporte ou resposta não validada conserva revisão/UUID para retry humano;40001/42501 fecham a revisão antiga e atualizam a lista, sem aplicar automaticamente outra revisão ou pedido. Sucesso exige retorno do mesmo pedido em revoked. Atualiza projeção/equipe/pedidos; contexto alterado/desmontado não recebe resultado anterior. Idempotência do escritor não pode retirar uma nova aprovação do mesmo par. Prontuário continua privado, sem conceder ou reconciliar grants.
