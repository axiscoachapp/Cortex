# Fixtures de sessões e fatores Auth

05/11/2026. Interface de teste para o contexto verificado do Edge e a cerca SQL proposta em D17 v3.1. Não é uma migration do Auth nem um autenticador.

`supabase/tests/bootstrap.sql` fornece a seguinte projeção de 14 colunas. O runner compara tipo e nulabilidade desta projeção tanto no banco de fixture quanto nos serviços Native Auth v2.197.0 e v2.189.0.

| Tabela | Colunas | Tipo | Aceita NULL |
|---|---|---|---|
| sessions | id, user_id | uuid | não |
| sessions | created_at, updated_at, not_after | timestamp with time zone | sim |
| sessions | refreshed_at | timestamp without time zone | sim |
| sessions | factor_id | uuid | sim |
| sessions | aal | auth.aal_level | sim |
| mfa_factors | id, user_id | uuid | não |
| mfa_factors | created_at, updated_at | timestamp with time zone | não |
| mfa_factors | status | auth.factor_status | não |
| mfa_factors | factor_type | auth.factor_type | não |

O enum `aal_level` contém aal1/aal2/aal3; `factor_status`, unverified/verified. O enum de tipo da fixture é um subconjunto: totp/webauthn/phone. Não modela recovery_code nem todo o schema nativo. UUID e datas padrão de `mfa_factors` são conveniências da fixture, não uma promessa de defaults iguais aos do Auth. Segredos de fatores, desafios, refresh tokens e emissão/verificação de JWT não fazem parte desta fixture.

O DELETE de usuário remove suas sessões e fatores. `sessions.factor_id` não possui FK para fatores: remover o fator deixa a referência antiga na sessão. A cerca precisa conferir a linha viva do fator, seu dono e status; a presença do UUID não prova MFA atual. AAL e prazo nulos também precisam de política explícita do autorizador, sem inventar garantia a partir da fixture.

As duas tabelas da fixture têm RLS ligado e nenhuma concessão de tabela ou coluna a anon/authenticated/service_role. O teste contém um grant de coluna temporário, leitura por contagem sintética e restauração transacional para provar que uma checagem apenas de ACL de tabela é insuficiente.

## Adaptador Native

`nativeApplicationBootstrap` reconhece os perfis exatos antigo e atual, recusando declarações obrigatórias ausentes, duplicadas ou perfis misturados. No serviço nativo omite as tabelas, enums, roles e funções mock; instala somente o bootstrap da aplicação/storage. Mantém a concessão explícita de EXECUTE para auth.uid/auth.role/auth.jwt já usada pelo laboratório.

Antes/depois da instalação verifica colunas/tipos/nulabilidade/donos, ACLs de tabela e coluna e flags RLS das três tabelas users/sessions/mfa_factors; definições/donos dos quatro helpers uid/role/jwt/email; definições/donos/ACL dos três enums. O fingerprint de enums inclui todos os rótulos que cada versão nativa realmente possui. Não afirma igualdade de defaults, constraints, policies, ACLs de funções ou de todo o schema Auth. Um grant temporário SELECT(id) é detectado pelo fingerprint e pela consulta de acesso por coluna, lido sob service_role e revertido antes do tráfego Auth.

## Fontes e limite autorizativo

Tipos/nulabilidade/cascades vêm das migrations oficiais fixadas: [sessões](https://raw.githubusercontent.com/supabase/auth/v2.197.0/migrations/20220811173540_add_sessions_table.up.sql), [MFA](https://raw.githubusercontent.com/supabase/auth/v2.197.0/migrations/20221003041349_add_mfa_schema.up.sql), [AAL/factor_id](https://raw.githubusercontent.com/supabase/auth/v2.189.0/migrations/20221003041400_add_aal_and_factor_id_to_sessions.up.sql), [not_after](https://raw.githubusercontent.com/supabase/auth/v2.197.0/migrations/20221114143122_add_session_not_after_column.up.sql) e [refreshed_at](https://raw.githubusercontent.com/supabase/auth/v2.197.0/migrations/20231027141322_add_session_refresh_columns.up.sql). O Auth novo inclui [recovery_code](https://raw.githubusercontent.com/supabase/auth/v2.197.0/migrations/20260824000000_add_recovery_codes_factor_type.up.sql), fora do subconjunto mock. A checagem de grants segue [PostgreSQL 16: has_any_column_privilege](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE).

O [helper Edge](VERIFIED_AUTH_CONTEXT.md) fornece contexto autenticado. Estas fixtures permitem testar o SQL; não tornam esse contexto atomicamente válido. Cerca viva, relógio final, conta/recursos, CAS/tentativa e replay terminal de D17 continuam com Claude no seu domínio, com provas antes dos handlers. Prontuários, delegações e agenda não ganham acesso novo.
