# T31/3b/2c/1 — ordem SQL na definição inicial de senha

05/11/2026. Prova local do protótipo existente, sem alteração no Auth do aplicativo ou em migrations. Base do trabalho: `6a0457c`.

## Resultado

Oito grupos passaram em cada Auth v2.197.0/v2.189.0: [relatório197](v2.197.0.json), [relatório189](v2.189.0.json) e [verificação adicional](VERIFICATION.json). A confirmação SQL reservada aceita senha→metadata, metadata→senha e um único UPDATE combinado. Em cada caso verifica XID da transação, revisão final2/reserva1, confirmação persistida e login nativo com a senha sintética.

Hipótese submetida à revisão adversarial: o predicado deferred existente não depende da ordem dos dois UPDATEs para confirmar a escrita reservada. O teste não modifica esse predicado. O controle com constraint imediata recusa metadata→senha antes da escrita da senha; com a constraint deferred, a mesma ordem passa depois de ambas as gravações.

Nos positivos, `SET CONSTRAINTS auth.lab_confirm_setup_password IMMEDIATE` ocorre **depois** das gravações, para observar o XID/revisão dentro da transação, e só então COMMIT. A leitura nova e o login comprovam persistência. Não alegar que estes positivos ensaiaram exclusivamente o disparo automático no COMMIT. Metadata isolada e senha isolada são recusadas no COMMIT real, com40001. Operação errada também faz rollback; divisão por zero depois das duas gravações, antes do flush, comprova rollback de senha, metadata, registro do XID e remoção das sessões.

Todas as recusas mantêm estado applying/revisão1/XIDnulo, marcador ausente, senha nova recusada pelo Auth e sessão anterior utilizável. Cada positivo chega a password_set/revisão2, elimina as sessões antigas na fixture e autentica a nova senha pelo Auth real.

## Fronteira da prova

O escritor invertido é uma **fixture SQL explícita do dono** no schema criado pelo Auth real. Não altera/recompila o Admin endpoint, nem afirma que o Auth nativo executou seus UPDATEs na ordem inversa. O donor sintético recebe uma senha aleatória pelo Admin create; o hash é copiado apenas entre linhas sintéticas dentro do banco descartável. Não retorna ao runner, não entra no ledger, relatório ou repositório. A fixture também remove explicitamente as sessões na mesma transação; isso não substitui o ensaio do writer nativo já registrado em04/11.

A tabela de controle limitada ao dono devolve uma linha tanto com JWT antigo ainda assinado quanto com a sessão pessoal nova. A tabela guardada devolve zero nos dois casos. Seu `session_ready()` continua deliberadamente false: **password_set não autoriza prontuários**. Não interpretar esse resultado como implementação da conclusão autorizativa ou de uma cerca de sessão/geração.

## Reprodução e revisão

```powershell
node scripts/test-initial-password-auth.mjs --setup-order --all
```

O novo modo reutiliza o harness local de Auth/PostgREST: endpoint Docker local verificado e pinado, imagens em cache/`--pull=never`, rede interna sem portas publicadas/SMTP/rota externa. Captura quatro fontes, executa módulo/SQL congelados e confere hashes antes do relatório. Limpeza de recursos próprios confirmada nas duas versões. Fontes: harness, novo módulo e dois SQLs de protótipo; nenhum SQL de produção é carregado neste ensaio.

Sintaxe dos dois scripts, ESLint recomendado com globalsNode explícitos, três combinações de flags recusadas antes do Docker e hashes das duas versões aprovados. Protótipos SQL e relatórios históricos permanecem intactos. Os modos antigos não foram reexecutados nesta fatia; o diff acrescenta a seleção/destino próprios deste modo. Sem build/frontend, suíte global do aplicativo ou nova corrida entre conexões neste recorte.

Revisão local independente, com contexto isolado e somente leitura, conferiu artefato, protótipos, preservação dos modos, ausência de segredos e evidência197; nenhum achado substantivo. A ressalva sobre flush explícito foi incorporada acima. O revisor não executou testes. Revisão externa dispensada conforme preferência do usuário.

## Pendências

Fecha somente a lacuna da ordem SQL no protótipo. T31/3b/2c e T31 inteiras continuam abertas: geração confiável da sessão, verify/recovery/PKCE já em andamento, MFA/recuperação, manutenção criptográfica, contas existentes/reset e integração RLS/RPC/storage/Edge/frontend ainda precisam de prova. Nenhuma migration, endpoint ou liberação de produção decorre deste teste.
