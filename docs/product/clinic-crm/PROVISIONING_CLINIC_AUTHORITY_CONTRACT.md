# T28/M2 — composição da autoridade nativa com a filiação

04/11/2026. Prova local após `2f0a155` e `a8aa43b`, ainda sem migration, fachada, criação de filiação de recepção ou corte do produtor legado.

## Ambiente e fronteira

Instalar snapshot Git congelado das migrations do aplicativo no mesmo PostgreSQL do Auth nativo v2.197.0/v2.189.0, antes de iniciar o PostgREST. Adaptar o bootstrap de testes omitindo somente roles/Auth schema/tabelas/funções já reais; preservar seus donos, estrutura e funções nativas. Não aplicar o GRANT genérico de todas as funções Auth: conceder somente os helpers de identidade utilizados pelo app. Storage continua fixture SQL, sem servidor/arquivo real.

As funções oficiais nativas já leem os claims individuais e o JSON usado pelo PostgREST: [uid/role](https://github.com/supabase/auth/blob/v2.197.0/migrations/20220224000811_update_auth_functions.up.sql), [jwt](https://github.com/supabase/auth/blob/v2.197.0/migrations/20220531120530_add_auth_jwt_function.up.sql). O adaptador deve falhar se o formato esperado do bootstrap mudar, em vez de remover SQL arbitrariamente. Conferir estruturas/donos/ACLs das tabelas Auth e definições dos helpers antes/depois. As concessões explícitas de schema/helpers da fixture não devem abrir leitura das tabelas Auth aos clientes.

Criar administrador via API Auth, login e TOTP/AAL2 reais; validar bearer em `/user` antes de extrair sub/session_id/aal/exp. Criar a clínica pelo RPC autenticado da Data API, não inserindo uma filiação fictícia. O executor proprietário confiável usa contexto de serviço só para os helpers privados; esse contexto não é identidade humana nem substitui o bearer verificado.

## Vínculo composto

A intenção conserva operação, UUID alvo, ator/clínica, sessão, fator inicial, prazo e **geração original da filiação real**. Revalidar o contexto nativo e o guard/T33 reais antes de reservar/despachar/confirmar; comparar a geração capturada, nunca atualizá-la por replay. Manter a verificação de sessão/fator anterior; a fixture mínima daquele protótipo só pode restringir, nunca substituir a filiação real.

Na confirmação exigir também o receipt transacional da identidade Auth reservada. Conferir prazo da intenção, expiração do bearer atual e `auth.sessions.not_after` após as aquisições finais; tempo pode vencer mesmo com a linha da sessão cercada. Não manter locks/transação durante HTTP. Recusar autoridade perdida/ABA, logout/expiração ou contexto divergente, preservando a identidade já criada e sem conceder filiação/grant. Repetição exata válida conserva identidade/prazo; uma nova sessão não adota a intenção antiga.

O receipt precisa cercar também a **linha Auth alvo reservada**, com FOR SHARE NOWAIT antes da sua leitura e do relógio final. DELETE/alteração de marcadores depois de um snapshot RR deve abortar; leitura RC da identidade ausente/divergente também recusa. Essa regra vale para confirmar e para qualquer check/replay de begin que devolva `confirmed`, sem converter histórico em autorização atual. Se a confirmação curta ganhou primeiro, a mutação nativa espera sua conclusão; replay após a mutação deve recusar.

RED: a composição que apenas adiciona clínica/T33, mas continua checando a fixture antiga, aceita uma intenção após ABA da filiação real enquanto a mesma sessão/fator permanecem válidos. GREEN: vínculo de geração fecha esse contraexemplo; testar nascimento em voo realmente observado, atualidade nativa e ausência de concessões. Nenhum dado clínico é usado nos testes.

## Limites explícitos

Esta etapa compõe os produtores/checadores privados do laboratório. Não endurece todos os escritores diretos do ledger, reservas concorrentes de UUIDs/índices, instalação/upgrade da intenção em produção, histórico completo de `account_type`/credencial/eventos MFA, recuperação após prazo/novo login ou criação transacional de equipe/pedidos. A coluna/SQL de geração ainda é experimental. Esses pontos devem preceder a migration/fachada e o corte do serviço, sem contornar limites por e-mail/recriação ou refresh silencioso do prazo.

Sem mudança nos três helpers T33/arquivos do Claude, PersonalMed, esquema de importação, campos legais, API paga, banco hospedado ou deploy. M2/T31 permanecem abertas.
