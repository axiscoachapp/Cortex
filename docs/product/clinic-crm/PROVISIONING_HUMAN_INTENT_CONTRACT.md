# T28 — prova da intenção vinculada à sessão humana

04/11/2026. Incremento de laboratório após a [identidade reservada](PROVISIONING_AUTH_IDENTITY_CONTRACT.md). Sem endpoint, migration, filiação, grants ou alteração da política de MFA do aplicativo.

## Fronteira e política do ensaio

O executor valida o bearer com `/user` do Auth nativo antes de extrair sub/session_id/aal/exp. Confere sub com o usuário retornado, formatos e papel. Os parâmetros privados vêm desse contexto validado, nunca de uma identidade/nível fornecidos no body. SQL não verifica a assinatura JWT por conta própria; a futura fachada precisa conservar essa fronteira. Tokens/segredos TOTP não são persistidos nem impressos.

A fixture de clínica é uma tabela privada mínima de papel/status. Não substitui `clinic_members`, custódia T33 ou validação de todos os escritores do produto. Neste laboratório exigir AAL2 no token **e** na sessão nativa, com o fator indicado por **auth.sessions.factor_id**, pertencente ao ator, tipo TOTP e status verified. Fixar esse ID inicial na intenção: outro fator verificado da conta não o substitui, nem uma troca legítima de fator na mesma sessão. A intenção antiga deve recusar depois dessa troca ou remoção, mesmo se a sessão continuar viva com outro fator verificado. Isso é política estrita da fixture, não alteração da política de MFA do Cortex.

## Intenção e confirmação

- Operação/UUID planejado são do servidor. Intenção vincula administrador, clínica, sessão, fator inicial e prazo; outro ator/sessão/clínica/UUID/fator não reutiliza a operação. Replay exato não estende o prazo original.
- Prazo limitado ao menor entre cinco minutos e a expiração do token inicialmente validado. Não armazenar token, e-mail, nome, senha ou cópia de hash.
- Revalidar usuário atual, sessão viva/dono/not_after/AAL, fator verificado, papel/status e prazo ao iniciar, despachar e confirmar. Ler o relógio depois das travas. Aquisições de linhas sem espera e recusa de snapshot RR velho; não manter transação/trava durante HTTP.
- Na confirmação, exigir também o receipt atual da identidade Auth. Confirmação da intenção é só evidência administrativa; não é autorização de prontuário nem substitui a aprovação médica.
- Cercar a linha Auth alvo reservada antes de ler esse receipt, inclusive nos checks/replays que devolvam `confirmed`. DELETE/alteração depois de snapshot RR deve abortar; prazo/bearer/`session.not_after` são conferidos após a cerca final. O histórico confirmado não vira prova de identidade atual após remoção. A cerca é compartilhada com a composição de clínica real.
- Revogação/expiração durante a chamada nativa pode deixar a identidade criada, mas a confirmação deve recusar. Preservar identidade/receipt para reconciliação; não excluir nem repetir a criação por inferência.
- Revogação que conclui primeiro vence. Se a confirmação curta já cercou a sessão, a mutação nativa espera seu commit. O registro histórico pode persistir; replay depois da revogação precisa falhar.

## Provas e limites

`node scripts/test-initial-password-auth.mjs --provision-intent --all`, em Auth v2.197.0/v2.189.0, banco próprio/rede interna, sem portas publicadas ou envio. Protótipo em `supabase/tests/prototypes/provisioning-human-intent.sql`; executor em `scripts/test-provisioning-human-intent.mjs`. Sem alvo externo/configuração hospedada.

RED: contexto validado em cache não pode confirmar depois do logout nativo. GREEN: sessão/fator vivos, MFA real, identidade divergente, replay, prazo, autoridade atual e concorrência realmente observada. Não simular a posse do segundo fator por UPDATE de aal no banco.

Antes de produção faltam adaptação à clínica real/T33, endurecimento dos escritores/instalação, política de ABA de papel/reentrada e recuperação após prazo/novo login/troca de fator. O ensaio confere autoridade **atual**, não prova invalidação monotônica por toda mudança histórica de papel. Sessões nativas removidas não são recicladas. O pin é da intenção, não prova qual geração de credencial/evento MFA originou cada JWT preexistente; isso continua com T31. Também não prova credential setup/PKCE/recuperação nem o fluxo completo de dados; não promover esse SQL para migration.

Uma nova autorização humana poderá ser necessária para reconciliar identidade já criada após expiração. Essa reparação ainda não está implementada; não contornar por e-mail, novo usuário ou renovação silenciosa do prazo. PersonalMed e os três helpers T33 do Claude permanecem separados.

Provas posteriores: [geração da filiação real](PROVISIONING_MEMBERSHIP_GENERATION_CONTRACT.md) recusa o vínculo antigo depois de ABA/recriação de `clinic_members`, com T33 real. A [composição nativa](PROVISIONING_CLINIC_AUTHORITY_CONTRACT.md) reúne esses primitivos no laboratório, incluindo a cerca da identidade alvo. Isso não remove os limites de produção, histórico do Auth ou recuperação.
