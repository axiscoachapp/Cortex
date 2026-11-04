# T28/T31 — prova da identidade criada no Auth

04/11/2026. [Contrato](../../../product/clinic-crm/PROVISIONING_AUTH_IDENTITY_CONTRACT.md). **Somente laboratório**: nenhum endpoint, migration, filiação, grant, credencial ou autorização de dados de produção alterado. A intenção é inserida pelo dono da fixture, não por uma sessão humana simulada.

## Resultado

`node scripts/test-initial-password-auth.mjs --provision-identity --all`: **15 grupos em cada versão Auth v2.197.0/v2.189.0**, com cleanup confirmado. Resultados em `v2.197.0.json`/`v2.189.0.json`; três fontes próprias tiveram hashes capturados e conferidos sem alterações durante as execuções.

- UUID reservado antes da chamada nativa e receipt confirmado no mesmo XID da criação;
- resposta nativa descartada e recuperação por GET do UUID + receipt, sem outra escrita ou sessão;
- criação comum preservada e colisões de e-mail/UUID sem adoção ou alteração da conta existente;
- edição de user_metadata e marcador copiado por Admin update não fabricam receipt de nascimento; senha pessoal sintética preservada;
- operação/revisão/origem do marcador divergentes recusam com rollback;
- erro depois do INSERT reverte usuário e as duas fases de confirmação;
- dois INSERTs nativos realmente vistos em espera no mesmo bloqueio de tabela produzem um usuário/receipt;
- reserva ocupada recusa enquanto o holder continua aberto e não deixa usuário parcial;
- exclusão intencional de fixture mantém história, mas não autoriza recriar UUID/reativar receipt;
- schema privado sem acesso por anon/authenticated/service_role e sem exposição na Data API.

Relatório `RED.json`: primeiro ensaio criou o UUID nativo esperado, mas sem a captura a fase ficou `prepared` em vez de `auth_created`. A asserção falhou no receipt, não em conectividade. Depois do finally, confirmei ausência de containers/redes com o rótulo desse runner; nenhum recurso de outro dono foi removido.

A primeira captura imediata que também exigia metadata falhou com HTTP 500. O [Admin nativo v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go) insere o usuário e só depois aplica app_metadata. Corrigido o desenho: o INSERT registra XID/`inserting`; uma constraint deferred relê a linha final e exige esse mesmo evento/transação antes de confirmar. As duas versões passaram com esse protocolo. UPDATE de metadata numa conta preexistente nunca registra o evento de nascimento. O XID/xmin foi comparado somente na fixture recém-criada; xmin não é usado como regra de reconciliação ou autorização.

## Escopo e regressões

O modo novo não carrega o protótipo rejeitado de senha inicial. Os modos antigos continuam com a inicialização anterior. `node scripts/test-initial-password-auth.mjs --setup-cas` foi reexecutado em v2.197.0: **oito grupos anteriores aprovados**, incluindo concorrência e resposta descartada. Não é nova execução nas duas versões desse modo nem conclusão autorizativa T31.

`node --check` e ESLint dos dois scripts alterados passaram. Revisões locais independentes do contrato e da implementação não encontraram novo contraexemplo dentro do recorte; não executaram banco. Revisão externa dispensada pelo usuário/contexto não interativo.

Reusa o laboratório Auth/Data API já existente: imagens explícitas em cache, Docker local fixado, rede interna própria, sem portas publicadas/rota externa. Material de requests e credenciais sintéticas só em memória/stdin; ledger/relatórios guardam IDs, revisão, estados e XID, sem nome/e-mail/senha/token/hash de senha. Cleanup verificado nas execuções concluídas. Nenhum arquivo de Claude, SaaS, PersonalMed ou dos três helpers T33 mudou.

**Não promover o SQL do protótipo.** Não prova sessão humana/MFA/admin/clínica, todos os escritores privilegiados, vínculo confiável de credencial, instalação/custódia ou versão/configuração hospedada. Não libera dados nem escolhe uma senha/link de entrega. Receipt histórico só prova a criação associada; conta atual e autoridade precisam ser revalidadas.

Próxima fatia independente: intenção vinculada ao administrador, clínica e sessão humana validada/MFA; provar revogação/expiração e resposta perdida antes/durante/depois da chamada Auth. Só então integrar filiação sem grants e pedidos privados, com corte do produtor antigo/reconciliação antes de APIs/UI. M2 continua aberta.
