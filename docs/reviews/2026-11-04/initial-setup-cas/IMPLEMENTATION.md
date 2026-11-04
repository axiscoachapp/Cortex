# T31/3b/2b — escrita inicial reservada e recuperável

04/11/2026. Prova local sintética, sem endpoint, migration de produção ou autorização de acesso a dados.

## Resultado e fronteira

O laboratório confirmou **oito grupos por versão** em Auth v2.197.0 e v2.189.0. Uma reserva privada por revisão permite confirmar a escrita nativa da senha e reconciliar uma resposta perdida sem repeti-la. Duas chamadas nativas concorrentes não podem sobrescrever a senha vencedora. Os relatórios `v2.197.0.json` e `v2.189.0.json` são emitidos somente após a limpeza dos recursos próprios.

`password_set` comprova somente a escrita reservada. **Não conclui a autorização de setup.** A função de acesso `password_lab.session_ready()` retorna sempre `false`; o prontuário de teste continua inacessível inclusive após login com a nova senha. Uma tabela separada, limitada ao dono, fornece o controle positivo da Data API. Nenhum gate do aplicativo ou política de produção foi alterado.

## Mecanismo ensaiado

Conta criada sem senha fornecida pelo Cortex; recovery link gerado e consumido sem envio. O Auth gera internamente uma credencial aleatória. A operação privada usa usuário, sessão pertencente ao usuário sem `not_after` vencido, UUID e revisão de reserva. A implementação de servidor futura deve obter usuário/sessão da autenticação verificada, validar JWT/MFA e autorizar a operação; o laboratório não fornece esse endpoint.

O único pedido Admin combina senha e identificadores da reserva em `app_metadata`. Uma trigger imediata registra apenas o XID da escrita, sem copiar senha, hash ou token. Uma constraint deferred relê a metadata final e exige operação, revisão e escrita na mesma transação antes de confirmar `password_set`. Metadata isolada, operação substituída ou revisão antiga causam rollback integral. A revisão impede reciclar uma autorização antiga após A→B→A, mesmo reutilizando UUID.

A sessão usada no setup é revogada pelo password write nativo. Ela não pode retomar a operação. A reconciliação demonstrada usa acesso privado do servidor ou nova autenticação com a senha pessoal, sem nova mutação. Replay de uma operação já confirmada não pode sobrescrever a senha nem revogar essa sessão pessoal.

## Evidência executável

Comando: `node scripts/test-initial-password-auth.mjs --setup-cas --all`.

- Escrita sem reserva, metadata editável e sessão de outra conta não confirmam setup.
- Retry da mesma operação não autoriza outra escrita; metadata isolada e revisão incorreta fazem rollback, preservando senha, marcador privado e sessão original.
- Sessão vencida é recusada; reserva concorrente é observada sob lock e rejeitada sem espera.
- A→B→A não revive o ticket original, comprovado por recusa da escrita nativa antiga e login com a senha vencedora.
- Senha fraca recebe `422/weak_password`. Falha posterior à escrita é injetada somente depois de observar o XID ativo e a espera em uma barreira; senha, revogação e confirmação privada voltam juntas.
- O cliente interno consome uma resposta nativa `200` e a descarta para simular perda de resposta. Estado confirmado persiste; login pessoal reconcilia, sessão anterior e segunda escrita são recusadas.
- Duas chamadas Admin da mesma operação: a primeira é observada em uma barreira antes do UPDATE nativo; a segunda confirma, a primeira faz rollback e somente a senha vencedora autentica.
- Worker em andamento de uma reserva substituída é recusado depois de a nova reserva confirmar sua senha.

Os testes usam Auth, PostgreSQL, PostgREST e cliente HTTP reais em rede Docker interna, sem portas publicadas, SMTP ou rota externa. Endpoint local pinado, imagens em cache, identificação e limpeza por propriedade preservam as restrições do harness. Credenciais sintéticas ficam em memória; os relatórios não incluem payloads ou segredos.

## Revisão e limites

Verificação desta rodada: 16 grupos do novo modo, 18 regressões de `--link --all` e execução final dos 24 grupos de `--binding --all`, com cleanup confirmado nos relatórios. O observador de contenção do candidato antigo falhou em duas tentativas e passou após acrescentar diagnóstico seguro; a intermitência permanece registrada no relatório daquele candidato, sem alegação de correção. Sintaxe dos quatro scripts e eslint direcionado aprovados. Frontend e suítes de produção não foram reexecutados: não houve mudança nesses caminhos.

Três leituras adversariais locais corrigiram ABA de UUID, validade da sessão nativa, alegação de retomada com sessão revogada e a posição observada da falha injetada. A leitura final não encontrou outro achado dentro deste escopo restrito; não houve aprovação para produção. Revisão externa dispensada pelo usuário.

Ainda faltam conclusão autorizativa e vínculo confiável da sessão, verify/recovery e PKCE já em andamento, MFA, recuperação de senha esquecida, manutenção criptográfica, contas existentes/reset privilegiado e integração RLS/RPC/storage/Edge/frontend. A ordem inversa das escritas de senha/metadata não foi reproduzida: o ensaio cobre a ordem real das duas versões. Não considerar a leitura da constraint uma prova executada da ordem inversa.

O contrato completo permanece em `docs/product/clinic-crm/INITIAL_PASSWORD_CONTRACT.md`; esta prova não fecha T31 nem autoriza promover o SQL em `supabase/tests/prototypes/` a migrations.
