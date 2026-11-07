# K1/4i — adaptador de transferência explícita

Usar act/assign do contrato WhatsApp v1.2 com targetUserId explícito, separado de Assumir. Entrada local estrita: conversationId, revisão PostgreSQL incrementável, status open, assignedTo igual ao ator esperado e targetUserId UUID diferente do ator/dono atual. Não aceitar alvo ausente/nulo nem reabrir conversa encerrada. Corpo exato: action act, operation assign, conversationId, revision, targetUserId; ator/clínica/estado/proprietário locais não entram no transporte.

Recibo estrito open/revisão anterior+1/assignedTo igual ao targetUserId validado, normalizando UUID. Recibo com ator chamador ou terceiro não confirma transferência. Uma invocação sem retry; falhas após início/abort tardio/recibo inválido exigem releitura antes de outro comando e não prometem rollback. Snapshot do alvo é imutável durante await, sem adotar mudança do objeto do chamador.

Produtor preservado: valida destinatário como recepção ativa ou admin ativo da clínica; assign também pode abrir conversa encerrada e trocar responsável. O cliente de transferência é mais restrito (aberta/própria/outro alvo) e não prova autorização do servidor, disponibilidade do destinatário, CAS/RLS/concorrência/idempotência reais. Não chamar send/mark_read/close/reopen/unassign/vínculo/agenda/consentimento nem mover caso/clínico/identidade.

UI fora deste incremento. K1/4j deverá escolher pessoa por nome num catálogo fresco e autorizado, confirmar destinatário + conversa e vincular confirmação a alvo/owner/revisão/readVersion/contexto; exclusão/conferência/gerações existentes, sem atribuição automática. Não expor campo de UUID à secretária nem derivar alvo de doctors/IDs anteriores/cache antigo.

O catálogo ainda precisa de contrato de leitura: clinic_access.staff só é retornado para admin e não inclui todos os admins elegíveis no SQL WhatsApp; doctors não é a lista de destinatários. Proposta [WHATSAPP_ASSIGNEES_PROPOSAL.md](WHATSAPP_ASSIGNEES_PROPOSAL.md) para alinhamento com o dono C4. Não implementar UI/picker com fonte incompleta por inferência.

Provas sintéticas, SDK instalado/fetch em memória, nenhuma rede/servidor/navegador/banco/Meta/hosted/PersonalMed. Implementação só do adaptador; catálogo/UI seguem recortes próprios.
