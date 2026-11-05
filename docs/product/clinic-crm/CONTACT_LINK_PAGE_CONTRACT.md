# Página administrativa de vínculos por contato

05/11/2026, T05b/3c. Complementa CONTACT_LINK_CORRECTIONS.md. Fatia somente de banco/API; a entrada visual será uma entrega posterior. Não cria compartilhamento clínico, suspensão/reativação, importação ou concessão de agenda.

`reception_contact_links(p_clinic uuid, p_contact uuid, p_after uuid = null, p_limit integer = 50)` retorna `{ items: LinkEdit[], nextCursor: uuid | null }`. Reutiliza a projeção estrita do editor existente: contato/paciente/médico por ID, nome e nascimento mínimos, relação, revisão, atividade implícita e disponibilidade. Sem CPF, telefone, conteúdo clínico ou campos legais adicionais.

- Exige sessão clínica humana disponível, assurance e administração ativa da clínica pela autoridade privada já usada nas APIs administrativas. Papéis anon/service, secretária, médico sem administração e admin externo são recusados, inclusive para página vazia.
- Clínica e contato são obrigatórios. O contato deve pertencer à clínica verificada. A leitura cerca a identidade do ator e o contato com `FOR SHARE NOWAIT`; mudança concorrente da autoridade é recusada para nova tentativa, sem aguardar uma operação inversa.
- Limite de 1 a 50, sem clamp silencioso. Ordena por `patient_id` crescente dentro do contato; busca no máximo limite+1 candidatos e devolve cursor do último item somente quando há outra página. O cursor deve identificar um vínculo do mesmo contato/clínica; caso contrário, `22023`.
- Identificadores de vínculo não mudam. Inserções entre páginas não representam um snapshot de exportação; o cliente pode atualizar a lista. Paciente arquivado/médico inativo permanece identificado minimamente com disponibilidade falsa, como no leitor do editor. Essa leitura não autoriza corrigir um vínculo indisponível.
- `42501` para identidade/permissão/contato indisponíveis, `22023` para paginação inválida, `40001` para disputa de autoridade. As validações de autorização precedem o retorno de lista vazia e a análise do cursor.
- Sem escrita de domínio ou auditoria de leitura contendo valores pessoais; escritores e DTOs existentes não mudam. Novo EXECUTE apenas para authenticated, com revogação explícita de todos os grants padrão; catálogo de funções atualizado na mesma entrega.

Verificação: banco descartável sintético com permissões/assurance/inatividade/contato externo, cursor e limites, paginação estável, disponibilidade e projeção mínima; adaptador rejeita resposta extra/inválida. Tipos gerados do schema ensaiado. Sem carga/hosted/push. Migration reservada no ESTADO antes do arquivo.

## Interface entregue em T05b/3d

[Lista na página de contatos](../../reviews/2026-11-05/contact-links-ui/IMPLEMENTATION.md): entrada sob demanda para admin clínico ativo, cache por ator/clínica/contato e leitura fresca antes de revelar dados anteriores. Erros escondem linhas/ações, inclusive em outra página; indisponibilidade impede abrir correção. O editor existente recebe os IDs exatos em modal alternado e retorna à lista. Consulta abortada ao desmontar não é reaproveitada ao reabrir a mesma chave. A entrada visual está implementada; estados/escritores do vínculo continuam fora desta fatia.
