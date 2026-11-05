# T31/3b/2c/2 — recuperação em andamento durante a troca de senha

05/11/2026. Laboratório sintético; base `bdd0e8c`. Nenhuma mudança no login, em prontuários ou em migrations do aplicativo.

## Resultado

Nas duas versões locais do Auth, uma verificação de recovery iniciada antes da troca de senha criou uma sessão OTP **depois** do commit da nova senha. Essa sessão e seu refresh passaram pela fixture de comparação que exige apenas pendência concluída e sessão viva. O instante de criação da sessão também passou pelo predicado de corte posterior ao commit. Essa estratégia simples continua rejeitada para a conclusão do setup.

Quatro grupos por versão: [Auth197](v2.197.0.json), [Auth189](v2.189.0.json), [hashes e checks adicionais](VERIFICATION.json). O ensaio é um contraexemplo executado para a proposta simples, sem afirmar exposição de dados do aplicativo atual. A fixture contém somente uma linha sintética de teste.

| Observação nas duas versões | Resultado |
|---|---|
| Verify observado aguardando antes e depois do password commit | 1 backend Auth na barreira |
| Troca nativa de senha, sessões anteriores armazenadas | 200, depois 0 sessões |
| Nova tentativa sequencial com o mesmo link | 403 / otp_expired |
| JWT inicial ainda válido após conclusão da fixture | 0 linhas guardadas; controle de dono 1 |
| Login com a senha pessoal após conclusão da fixture | 1 linha guardada |
| Verify antigo liberado depois | 200, AMR otp, sessão criada após o checkpoint |
| Sessão tardia e seu refresh nativo | 1 linha guardada, refresh 200 / 1 linha |

O predicado de `created_at` é consultado separadamente sobre a sessão realmente emitida e o checkpoint gravado após o password commit; o gate de comparação original não foi reescrito para incluir esse predicado. O resultado mostra que acrescentar somente esse corte também aceitaria a sessão tardia. Nenhuma conclusão depende apenas de disparar duas Promises ou inferir concorrência por tempo.

## Barreira e fonte

O código oficial valida o token e chama recovery antes de emitir a sessão OTP: [verify197](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go), [verify189](https://github.com/supabase/auth/blob/v2.189.0/internal/api/verify.go). `Recover` atualiza `recovery_token`: [modelo197](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go).

O teste instala somente no banco descartável uma trigger BEFORE UPDATE OF recovery_token FOR EACH STATEMENT. Ela pausa a verificação antes do lock da linha do usuário. Uma segunda chave advisory transacional faz a requisição Admin concorrente passar pela barreira e concluir sua escrita nativa. `pg_locks` ligado ao backend Auth comprova a espera antes e depois dessa resposta200; o verify permanece parado enquanto as sessões anteriores são revogadas.

A conclusão da pendência é uma alteração explícita pelo dono da fixture, sem endpoint ou alegação de atomicidade. O controle positivo com a senha pessoal comprova que o gate está aberto. Após liberar a barreira, os resultados nativos e a linha em `auth.sessions` comprovam a sessão tardia; a Data API e o refresh demonstram o contraexemplo. Os JWTs são conferidos com margem de expiração; não usar expiração acidental como recusa.

## Reprodução, revisão e limites

```powershell
node scripts/test-initial-password-auth.mjs --setup-verify --all
```

O modo novo reutiliza o harness local com imagens em cache/`--pull=never`, endpoint Docker local verificado e pinado, rede interna, sem portas publicadas, SMTP ou rota externa. Módulo e dois SQLs são executados de fontes congeladas; os quatro hashes incluem o harness e são conferidos ao final. As duas versões registram limpeza dos recursos próprios. Segredos sintéticos ficam em memória/entrada padrão; os relatórios contêm somente resultados, métodos e hashes de fonte.

Sintaxe de dois scripts, ESLint recomendado com globals Node explícitos, três combinações de flags recusadas antes do Docker, hashes, diff e limpeza aprovados. Protótipos SQL e evidências históricas intactos. Modos anteriores, build/frontend e suítes de produção não foram reexecutados neste incremento. Revisão local independente, somente leitura/contexto isolado, conferiu scripts, protótipos e os dois relatórios sem achado material. Revisão externa dispensada conforme preferência do usuário.

O ensaio usa Admin password write nativo sem compor o ledger CAS de senha reservada. Não prova a aceitação ou recusa da sessão tardia pelo protótipo CAS, pelo hook candidato anterior ou pelo aplicativo atual. Não implementa vínculo confiável de propósito/geração, PKCE, MFA, recuperação completa, política de contas existentes/reset ou integração. T31 e a conclusão autorizativa continuam abertas. Próxima fatia: ensaiar uma cerca confiável de propósito/geração composta com a reserva antes de qualquer liberação ou migration de produção.
