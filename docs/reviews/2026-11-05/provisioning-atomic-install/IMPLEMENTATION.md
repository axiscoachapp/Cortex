# Instalação atômica do laboratório de provisionamento

Recorte M2 sobre a fronteira de confirmação. [Contrato](../../../product/clinic-crm/PROVISIONING_ATOMIC_INSTALL_CONTRACT.md). Nenhuma migration produtiva, API/credencial, concessão, importação ou regra de retenção foi criada.

## Falha e proteção

O [RED](RED-v2.197.0.json) executa seis overlays em transações separadas e injeta P4110 antes dos quatro restantes. O erro encerra a instalação, mas schemas, geração da filiação e produtor de nascimento persistem; confirmação/criação ainda não têm seus produtores. É uma falha do instalador de laboratório, não um incidente observado em produção. O relatório não alega TOTP/fluxo Native nesse RED.

O novo modo compõe os dez overlays numa única transação READ COMMITTED. Antes de DDL do protocolo, toma auth.users em SHARE ROW EXCLUSIVE NOWAIT e clinic_members em ACCESS EXCLUSIVE NOWAIT. Preserva os locks que os DDLs já precisam; uma escrita incompatível recusa a instalação inteira. As fontes têm dez pins SHA-256 normalizados e perfis exatos de transação: não é parser/sandbox genérico de SQL. Chaves/fontes/controle transacional inesperados são recusados. Pins e locks exportados são imutáveis.

Dentro da mesma transação, antes/depois das alterações de proprietário, check_intent precisa manter seu corpo e begin_intent só pode trocar exists(Auth alvo) pelo leitor booleano. Não altera os helpers T33, helpers nativos nem contratos anteriores dos produtores. Bootstrap e69 migrations do app continuam fora da transação experimental: não afirmar instalação atômica do produto inteiro.

## Resultado final

[v2.197.0](v2.197.0.json) e [v2.189.0](v2.189.0.json) passaram **46 grupos por Auth,92 no total**:42 regressões de protocolo mais quatro grupos de instalação em cada ambiente. [Resumo verificável](verification.json).69 migrations congeladas em `1d5eacc6e0d3fdb18f290fa2c257c6fc80be49a4`, overlays próprios capturados, fontes finais idênticas entre RED/GREEN e cleanup conferido.

1. Falha P4110 depois de todos os DDLs e das verificações de corpo, antes do commit, deixa o fingerprint anterior e a fixture sintética intactos. Nenhum DROP de reparação é usado. Fingerprint cobre schemas, objetos/colunas/defaults, owners/ACL, papéis/filiações, funções, triggers, constraints e índices conhecidos; dados da fixture são comparados por digest. Não exige reutilização de OIDs ou ausência de gaps em contadores globais.
2. INSERT real em auth.users numa conexão aberta: a instalação recebe55P03 com mensagem de NOWAIT, excluindo lock/statement timeout. O holder continua aberto. Remover só o NOWAIT do cabeçalho faz o controle esperar, observado pelo PID bloqueador, relação/modo/query. Ao liberar, o controle chega à falha tardia e reverte tudo.
3. UPDATE real de uma filiação sintética existente recebe a mesma prova, com ACCESS EXCLUSIVE na relação correta. As duas escritas são fixtures SQL em tabelas reais, não HTTP Native em voo. A fixture Auth/clínica/filiação foi criada no banco descartável antes das tentativas e é preservada após os rollbacks.
4. Instalação quiescente completa passa, seguida das42 regressões Native genuínas. Repetição sobre namespace existente, agora com histórico do protocolo, recusa42P06 e preserva catálogo/ledgers. Isso não é upgrade, adoção ou migração de histórico.

As regressões incluem Auth/TOTP e criação da clínica por Data API, produtores privados, identidade alvo removida/alterada, RC/RR, reservas concorrentes, confirmação pelo servidor, B autorizado com positivo próprio e logout entre autenticação/SQL. Permanecem os limites de SDKshim/EdgeHTTP e produção já descritos na fronteira anterior. Nenhum alvo recebe filiação, prontuário, consulta ou escopo.

## Verificação e revisão

[Verificações locais](local-checks.json):15 testes do montador,35 da fronteira e34 Auth passaram (84/três arquivos). A seleção com assinatura teve190 aprovados/um ignorado/oito arquivos, sem somar execuções repetidas. Sintaxe/ESLint e typecheck global passaram. TS2550 do teste novo, que usava replaceAll fora do lib ES2020, foi reproduzido e corrigido com regex. Não houve teste global do app, matriz SQL48, build ou navegador novos.

Revisão de contrato sem achado; revisões de código/prova identificaram prefixo RED ausente (sobrescreveria evidência), possível confusão55P03/timeout e assert de ordem vacuamente verdadeiro com índice-1. O RED inicial foi preservado antes da sobrescrita, o nome corrigido, os asserts apertados e RED/GREEN finais repetidos. Os relatórios finais usam somente as fontes corrigidas; intermediários não entram nas92 verificações. Segunda leitura sem questão concreta remanescente. Revisão externa dispensada pelo usuário.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --confirmation-boundary --atomic-install --atomic-red --source=1d5eacc6e0d3fdb18f290fa2c257c6fc80be49a4
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --confirmation-boundary --atomic-install --all --source=1d5eacc6e0d3fdb18f290fa2c257c6fc80be49a4
```

M2 permanece aberta: custódia/retenção, instalação/upgrade com histórico, recuperação, adaptador/endpoint, integração/corte/reconciliação/gate e UI. Nenhuma duração jurídica ou remoção de histórico foi escolhida. Docker local, rede interna/sem portas, imagens existentes sem pull, labels próprios e remoção conferida. Somente sintéticos; sem hosted, PersonalMed, provedor pago, mensagens externas, emissão, deploy, push ou alteração de arquivos Claude/SaaS.
