# T39/3b/2a — conflito de revisão e nova confirmação humana

O cliente integrado passou em [12 estados](delegation-conflict-verified/AUDIT.json), nas larguras 375/1280/1920 px, com escala de 135%. App, AuthContext e parser vêm do snapshot `8fab6335f6004ebf86e72908927c3a81bc3b0a10`, sem overlays. Autenticação e RPCs são sintéticos, em loopback. Nenhuma fonte da aplicação foi alterada.

Em cada largura:

1. Abrir a confirmação da revisão 1 não envia decisão.
2. O controle interno da fixture avança somente a revisão do pedido pendente para 2, depois da leitura pelo navegador. Confirmar o diálogo antigo recebe HTTP 409/código 40001, sem escrita bem-sucedida.
3. Na mesma página montada, o cliente fecha o diálogo, atualiza a lista e mantém o pedido pendente/inativo. O aviso orienta conferir a ação. Nenhuma aprovação é enviada automaticamente.
4. Abrir outra confirmação ainda não envia. O novo clique envia revisão 2 com outra operação UUID; o mock retorna aprovado/revisão 3 e a lista mostra acesso ativo.

São seis tentativas, três recusas e três aprovações sintéticas, com seis operações distintas. Identidade e metadados do alvo e os outros dois pedidos permanecem iguais. A fixture é reiniciada entre larguras. O avanço de revisão é um controle de teste, sem endpoint HTTP e disponível somente quando decisões estão explicitamente habilitadas; não simula um segundo médico ou uma transação PostgreSQL concorrente.

A revisão encontrou uma lacuna do runner: as capturas intermediárias recarregavam a página, podendo mascarar ausência de atualização automática. As três capturas posteriores ao primeiro diálogo agora usam `navigate: false`; o aviso é exigido no DOM e a nova aprovação ocorre na mesma instância montada. A primeira execução ficou preliminar e fora do commit. Repetição final e segunda leitura sem achado acionável. Revisão externa não executada, conforme dispensa anterior e execução automática.

Capturas inspecionadas: [pedido ainda pendente](delegation-conflict-verified/permissions--permissoes-recepcao-conflict-refreshed-375.png) e [nova confirmação com aviso](delegation-conflict-verified/permissions--permissoes-recepcao-conflict-new-confirmation-375.png). O primeiro enquadramento mostra o cartão; a segunda imagem mostra também o aviso. [Validação consolidada](DELEGATION_CONFLICT_VALIDATION.json).

## Verificação e limites

- 20 testes existentes da API/página e dois testes novos da fixture aprovados. Os testes novos falharam antes da implementação do controle e passaram depois: indisponibilidade no modo de leitura, UUID/pedido pendente, recusa da revisão antiga sem escrita e aprovação explícita da revisão atual.
- [12 estados do ciclo positivo](delegation-conflict-positive-regression/AUDIT.json) e [15 estados de leitura](delegation-conflict-read-regression/AUDIT.json) aprovados, sem erro de rede/console; o modo de leitura continua recusando decisões.
- Sintaxe e lint dos três scripts, três combinações inválidas de flags, hashes das fontes/classes, módulos servidos e limpeza aprovados. A validação consolidada corrigiu uma expectativa sobre o campo opcional `failure` ausente no JSON; os resultados dos navegadores não foram alterados.
- Os três HTTP 409 e respectivos eventos de console são esperados e preservados integralmente. O runner exige exatamente caminho/status/texto/origem de recurso conhecidos, sem tolerância genérica a outros erros. Zero pageerrors, requestfailed, recurso inesperado ou destino externo. Ledger completo não-OPTIONS, sem consulta clínica, IA ou escrita de paciente/agenda.

Esse ensaio verifica recuperação do cliente perante o protocolo do mock. Não prova autorização PostgreSQL/RLS, concessão operacional, persistência, concorrência SQL ou idempotência de servidor. O mock continua sem replay idempotente. Resposta perdida/retry e leitura negada na interface seguem em T39/3b/2b; T39/3b e T39 inteiras permanecem abertas. Sem SQL/Native Auth novo, carga, hosted, deploy, push ou edição de arquivos Claude/SaaS/PersonalMed.

## Reexecutar

Use um nome de execução novo:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=8fab6335f6004ebf86e72908927c3a81bc3b0a10 --run=conflict-recheck --only=delegation-conflict
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```
