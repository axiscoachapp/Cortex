# M2 — produtor do recibo de nascimento

05/11/2026. Somente laboratório privado. [Contrato, fontes e ameaça delimitada](../../../product/clinic-crm/PROVISIONING_BIRTH_PRODUCER_CONTRACT.md). Nenhuma migration, handler ou autorização de produção foi acrescentada.

## Defeito reproduzido antes da correção

O teste criou uma identidade pelo Auth antes de reservar seu UUID no ledger. Um PUT nativo de metadata respondeu 200; o recibo continuava falso. Depois, DML direto fez prepared → inserting com XID corrente → auth_created e o mesmo recibo passou a verdadeiro, sem INSERT Auth daquela operação. O ensaio desfez a escrita forjada e verificou cleanup. [RED-v2.197.0.json](RED-v2.197.0.json) conserva booleans/status, sem identidades/metadata/credenciais.

## Mudança e controles

`provisioning-birth-producer.sql` instala papel NOLOGIN/NOINHERIT sem membros, CREATE em schemas existentes ou BYPASSRLS. Somente capture_birth/confirm_birth usam esse produtor SECURITY DEFINER, com SELECT de operations e UPDATE das duas colunas de transição. O guarda ALWAYS SECURITY INVOKER exige o usuário efetivo desse produtor e a sequência/XID corretos; guarda de vínculos anterior permanece. Nenhum GUC concede autoridade.

A confirmação deferred relê quatro campos finais por função privada do instalador. O produtor não recebe leitura direta de Auth.users nem privilégios globais para atravessar RLS. O leitor RETURNS TABLE preserva zero linhas quando o usuário desapareceu; a confirmação conserva NOT FOUND e a recusa de marcador sem reserva. Não expõe senha, token nem todo raw_app_meta_data.

Quatro grupos novos cobrem:

1. Forja/refação de phase recusada P4105 a owner DML e service_role com grants temporários reais; prepared/XID NULL, recibo falso e no-op preservados.
2. Metadata final divergente ou marcador sem reserva recusados pelo Auth; usuário/XID fazem rollback, retry válido confirma normalmente.
3. Flags/membros/ACL do papel, leitor sem linha para UUID ausente, ausência de acesso Auth/DDL e recusa P4106 ao tentar pular uma etapa mesmo sob produtor.
4. Replica e GUC de papel forjado negados; desabilitar só o guarda novo permite a mesma forja, rollback restaura ALWAYS e a recusa.

## Resultado final

| Execução | Resultado | Evidência |
|---|---|---|
| Predecessor sem produtor, Auth v2.197.0 | Identidade anterior + PUT 200 + DML forjam recibo; rollback/cleanup | [RED-v2.197.0.json](RED-v2.197.0.json) |
| Auth v2.197.0 com produtor | 27 grupos aprovados: 23 regressões + quatro novos; 69 migrations; cleanup | [v2.197.0.json](v2.197.0.json) |
| Auth v2.189.0 com produtor | Mesmos 27 grupos aprovados; 69 migrations; cleanup | [v2.189.0.json](v2.189.0.json) |

As duas versões completaram **54 grupos**, com TOTP/AAL2 e criação de clínica por Data API reais. O RED foi observado antes da implementação e repetido com o exercitador final para conferir os hashes. As fontes finais e os três relatórios foram conferidos; sintaxe/ESLint dos dois scripts e diff aprovados. A revisão local não encontrou defeito concreto remanescente no contrato delimitado. Nenhum gate de produção foi promovido por estes resultados.

O controle SET ROLE do instalador é somente uma prova de sequência. A checagem rotulada DDL no JSON cobre CREATE nos schemas existentes, sem afirmar vedação de TEMP ou ALTER das funções próprias. Administradores capazes de assumir esse papel, remover triggers ou alterar funções estão fora da ameaça DML; não afirmar proteção contra eles. INSERT prepared de reservas/intents e confirmação humana não ganham autenticação por esta fatia.

## Reprodutibilidade e limites

Baseline Git congelado: `4ea274c13fa952de39623601f01bf1c3f6098a53`. As 69 migrations vêm desse snapshot, incluindo o D17 anterior; as mudanças paralelas do Claude no worktree não entram. Bootstrap, protótipos e runners próprios são overlays capturados, importados e conferidos por hashes. O RED omite só o overlay produtor e usa o mesmo exercitador; os modos novos gravam nesta pasta, sem substituir relatórios anteriores.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --birth-producer-red --source=4ea274c13fa952de39623601f01bf1c3f6098a53
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --all --source=4ea274c13fa952de39623601f01bf1c3f6098a53
```

Sem execução das 48 suítes SQL raiz, ensaio D17, upgrade, frontend, typecheck Edge ou navegador nesta fatia de overlay privado. Evidências recentes das fixtures/Deno em `4ea274c` continuam históricas. Docker usa pipe local, imagens locais sem pull, rede interna sem portas publicadas e remoção verificada dos próprios recursos. Somente dados sintéticos, sem hosted, certificados, envios, chamadas pagas, PersonalMed ou push.

Revisão local do desenho identificou a armadilha do leitor escalar (FOUND verdadeiro com retorno NULL); o conjunto de linhas foi adotado antes da implementação. Leitura adversarial do SQL e testes não encontrou outro defeito concreto. Revisão externa dispensada pelo usuário. Uma seleção inicial de snapshot inexistente foi recusada antes do Docker; a primeira tentativa GREEN encontrou terminador SQL duplicado no helper de recusa, corrigido com normalização do comando. Essas falhas de harness não contam como aprovação; os recursos próprios foram limpos antes da repetição final.

Autoridade de INSERT de reservas/intents, confirmação humana, reservas concorrentes de UUID, custódia/retenção/instalação/upgrade e histórico/recuperação Auth permanecem pendentes. Depois vêm filiação/pedidos sem concessão automática, serviço/reconciliação/legado/gate e APIs/UI. Este papel privado e a instalação em tabelas vazias não são plano de produção nem política de retenção.
