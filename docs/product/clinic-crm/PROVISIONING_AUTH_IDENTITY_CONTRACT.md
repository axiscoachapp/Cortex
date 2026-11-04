# T28/T31 — identidade Auth de uma operação de provisionamento

04/11/2026. Etapa de prova local, anterior à fachada de [pedidos privados](PROVISIONING_REQUESTS_CONTRACT.md). Não implementa criação pública, sessão/MFA, credencial inicial, grant, reconciliação do legado ou carregador PersonalMed. Nenhuma migration de produção reservada.

## Problema e limite da prova

`create-clinic-receptionist` chama Admin createUser sem ID previamente registrado. A resposta pode se perder depois de a identidade existir. Não resolver por busca/adoção de e-mail, novo usuário automático, senha repetida ou exclusão compensatória. E-mail e user_metadata não são identidade/autoria confiável.

Proposta ensaiada: reservar no servidor operação e UUID Auth aleatório antes da chamada nativa. O Admin create recebe esse UUID e marcador de operação/revisão em app_metadata. Um receipt privado de **INSERT real** é confirmado na mesma transação Auth; marcação posterior de metadata não produz receipt. Depois de resposta perdida, consultar somente o UUID reservado e conferir a evidência transacional. O retorno HTTP não é a única prova.

O INSERT apenas registra o XID e o estado intermediário `inserting`. Uma constraint deferred relê o usuário/metadata final e exige esse evento na mesma transação antes de confirmar. A tentativa que exigia metadata já no AFTER INSERT foi recusada pelo Auth nativo: o Admin aplica app_metadata depois do INSERT. Não depender dessa ordem nem confirmar um usuário preexistente por UPDATE de metadata. `inserting` nunca é uma confirmação para o chamador.

O [AdminUserParams do Auth v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go) e a [versão v2.189.0](https://github.com/supabase/auth/blob/v2.189.0/internal/api/admin.go) aceitam `id`; os tipos locais de auth-js também o declaram. Compatibilidade, duplicação e rollback serão provados nas duas versões nativas, sem presumir seu resultado por leitura.

## Invariantes

1. UUID/operação/revisão reservados pelo servidor são imutáveis. Não usar IDs do body como identidade confiável. Operação não é reutilizável para outra identidade; não reciclar uma instância terminal.
2. Receipt identifica somente a criação Auth vinculada à operação. Não prova sessão humana, MFA, papel de admin, senha trocada, filiação ou anuência médica.
3. app_metadata sozinho não basta: Admin update de conta preexistente pode copiar o marcador. user_metadata deve continuar irrelevante.
4. Receipt e INSERT Auth fazem commit/rollback juntos; um erro após o INSERT não pode deixar prova de identidade criada. Contenção da reserva recusa sem espera após adquirir a linha Auth.
5. Criações concorrentes para o mesmo UUID/operação não produzem duas identidades nem dois receipts. Perda da resposta é reconciliada por leitura, sem repetir a escrita ou entregar uma senha antiga.
6. Colisão de UUID/e-mail ou marcador divergente não adota, funde, altera ou exclui a conta existente. Não transformar erro genérico/timeout em confirmação ou em certeza de ausência.
7. Conta ausente após receipt confirmado exige regularização; receipt histórico não autoriza recriar o UUID nem reviver acesso. Não apagar a evidência em CASCADE junto da conta.
8. Nenhum plaintext, senha, token, cópia de hash, nome ou e-mail no ledger/log/relatório. Laboratório usa somente IDs e dados sintéticos; credenciais ficam em memória e na instância Auth descartável.

## Fronteiras ainda obrigatórias

Antes de produção, uma intenção autenticada deve vincular operação/UUID ao administrador, clínica, sessão validada e MFA. Revalidar autoridade e sessão viva no momento de começar/retomar/finalizar; um worker de serviço não herda autoridade de um actor fornecido no body. Escolher e provar política de expiração/revogação da intenção e o tratamento de trabalhador já em voo. O laboratório desta etapa insere intenções como dono, sem simular esse aceite humano.

Somente depois integrar filiação sem grants e pedidos `staff_provisioning`, cortando o produtor antigo e reconciliando legado. A criação Auth não libera dados nem escolhe o protocolo de [credencial inicial](INITIAL_PASSWORD_CONTRACT.md). Marcadores de criação não podem liberar RLS/RPC/storage/Edge.

O ledger real também precisará de custódia/retentiva, validação de todos os escritores, ausência concorrente da conta e instalação segura. O schema `provision_identity_lab` e sua trigger experimental não são migration nem solução pronta de produção. Os três helpers T33 delegados ao Claude não serão alterados.

## Incremento e provas

- Schema somente de laboratório em `supabase/tests/prototypes/provisioning-auth-identity.sql`; executor em `scripts/test-provisioning-auth-identity.mjs`, sob o runner Auth já isolado.
- RED real sem captura transacional; GREEN com criação nativa/receipt, resposta descartada, metadata editada, colisões, concorrência observada, rollback e conta removida.
- Comparar duas versões: `node scripts/test-initial-password-auth.mjs --provision-identity --all`. Uma versão: omitir `--all`. Sem alvo externo, env de backend, porta publicada, envio ou chamada paga.
- Primeiro garantir a identidade. Sessão/autorização humana e integração continuam fatias seguintes; não promover esta prova por presunção de completude.
