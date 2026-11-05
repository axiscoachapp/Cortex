# M2 — produtor privado do recibo de nascimento

05/11/2026. Fatia de laboratório após integridade dos vínculos. Não é migration nem gate de produção; autoridade dos INSERT de reservas/intents e da confirmação humana permanece separada.

## Ameaça e garantia

Hoje um escritor com DML no ledger pode reservar um UUID que já existe no Auth, acrescentar metadata pela Admin API e forjar prepared → inserting → auth_created com XID arbitrado pela própria escrita. As guardas de vínculos não autenticam o produtor inicial do XID. Um recibo assim não prova INSERT nativo daquela operação.

O incremento deve restringir mudanças de phase/birth_transaction de operations a um papel privado usado somente por capture_birth/confirm_birth SECURITY DEFINER. O trigger de autorização é SECURITY INVOKER: observa o usuário efetivo que o chamou, sem virar o dono da tabela. Aceita prepared → inserting com XID da transação atual e inserting → auth_created com o mesmo XID; no-op continua possível. As guardas ALWAYS anteriores permanecem e o novo guarda também é ALWAYS. Não usar GUC, sessão JWT alegada ou apenas profundidade de triggers como capacidade.

O papel deve ser NOLOGIN, NOINHERIT, sem superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS e sem membros ou papéis herdados. Só USAGE no schema privado, SELECT em operations e UPDATE de phase/birth_transaction; sem CREATE nos schemas existentes, INSERT, DELETE/TRUNCATE ou acesso direto a Auth.users. Seus produtores são as duas funções de trigger existentes. A checagem de CREATE não pretende vedar TEMP nem ALTER das funções próprias; assumir o papel privado está fora da ameaça.

Auth.users tem RLS no serviço real. A confirmação relê as quatro projeções mínimas necessárias (presença do marcador, tipo de conta, operação e revisão) por leitor privado SECURITY DEFINER do instalador, com EXECUTE só ao produtor. O leitor retorna um conjunto de linhas; UUID ausente não vira uma linha escalar NULL que deixaria FOUND=true. A confirmação preserva a recusa de identidade ausente, de marcador sem reserva e de metadata final divergente. O produtor não recebe BYPASSRLS nem leitura de senha/token.

## Prova exigida

- RED com Auth real: identidade anterior à reserva + metadata alterada por API + DML direto produz receipt verdadeiro no predecessor. Registrar somente booleans/contagens/status e desfazer a escrita forjada.
- GREEN nas duas versões Native: mesmo ataque recusado para owner DML e service_role com grants temporários, sem depender da ACL para esconder a falta do trigger; GUC de papel alegado e modo replica não liberam escrita.
- Native INSERT e confirmação deferred legítimos, metadata final inválida desfazendo usuário/XID e retry válido preservados. Guarda não confunde usuário de Auth com o usuário efetivo do produtor.
- Catálogo/ACL do papel, leitor sem linha para UUID ausente, sequência inválida mesmo sob produtor, no-op e rollback. Controle desabilitando somente o guarda novo deve expor a forja; rollback restaura guarda e recusa.
- Repetir as 23 regressões da composição com ledger em cada Auth, capturar fontes/hashes e verificar cleanup. Não apresentar a matriz SQL/upgrade/frontend anterior como reexecutada.

## Limites

A ameaça é DML sem DDL nem capacidade de assumir o papel privado. Um administrador que possa ALTER/DISABLE/SET ROLE, alterar funções/roles ou escrever fora do protocolo no Auth controla essa fronteira; não afirmar proteção contra ele. O instalador de laboratório continua privilegiado e não é modelo de implantação. Tabelas precisam estar vazias; upgrade, retenção/custódia e reserva concorrente ainda exigem provas próprias.

Não impedir nem considerar autenticados os INSERT prepared de reservations/intents nesta fatia. Não autenticar a transição confirmed humana por herança do recibo. O caminho integrado ainda precisa de contexto validado, consentimento/filiação, credencial inicial, reconciliação/corte do serviço e gate operacional. Sem novos grants clínicos, prontuários compartilhados, agendamento automático, dados reais, PersonalMed ou chamadas externas.

Semântica baseada em [SECURITY DEFINER/INVOKER e permissões](https://www.postgresql.org/docs/16/sql-createfunction.html), [contexto e ordem dos triggers](https://www.postgresql.org/docs/16/trigger-definition.html) e [membros/SET ROLE/INHERIT](https://www.postgresql.org/docs/16/role-membership.html) do PostgreSQL 16. Revisão local do contrato apontou a armadilha do leitor escalar/FOUND; o conjunto de linhas é parte obrigatória do desenho. Revisão externa dispensada pelo usuário.
