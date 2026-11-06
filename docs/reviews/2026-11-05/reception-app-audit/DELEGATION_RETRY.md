# T39/3b/2b/2 — retry após resposta truncada

Em 06/11, o cliente integrado passou em [12 estados](delegation-retry-verified/AUDIT.json), quatro em 375/1280/1920 px, com escala de 135%. App/AuthContext/parser vêm do snapshot `8522092f5bda462ffab5b3589e4cee10e38eed83`, sem overlays ou alteração de fontes da aplicação. Auth e RPCs são sintéticos, em loopback.

Abrir a confirmação não envia decisão. O primeiro clique aprova o pedido no mock uma vez, mas o servidor fecha um corpo HTTP200 incompleto: o navegador registra `ERR_CONTENT_LENGTH_MISMATCH` e o cliente informa que não conseguiu confirmar a operação. Fechar e reabrir o diálogo também não envia. Outro clique explícito repete exatamente pedido/revisão/decisão/operação; o recibo sintético devolve o snapshot original, sem outra escrita. A lista então mostra aprovado/revisão2/acesso ativo.

São seis tentativas, três operações e três escritas sintéticas. O mesmo documento é conferido por marcador; nomes, clínica, médico, data, estados e ações dos três cartões são verificados antes e depois, além da igualdade dos dados/identidades dos pedidos irmãos. A revisão identificou a falta dessa conferência dos cartões; o runner foi corrigido e repetido. Leitura final sem achado acionável; revisão externa não executada na automação. Primeira execução fora do commit.

## Limites e verificação

`delegationReplay` exige explicitamente permissões e decisões. Só esse modo mantém recibos em memória. Operação igual com rota/pedido/revisão/decisão alterados recebe409; nova operação com revisão antiga também. O controle de truncamento só aceita UUID de pedido pendente. Reiniciar a fixture limpa recibos e dados entre larguras. Os demais modos continuam sem replay.

Vinte testes da aplicação e cinco da fixture aprovados; os dois novos testes falharam antes da implementação. [12 regressões positivas](delegation-retry-positive-regression/AUDIT.json) e [12 de leitura negada](delegation-retry-denied-regression/AUDIT.json) passaram. Sintaxe/lint de três scripts, três flags inválidas, hashes/módulos servidos e limpeza aprovados. A listagem do Vitest revelou que o teste Node anterior entrava em sua descoberta: foi renomeado para `clinic-review-api.node-test.mjs`, executado novamente e sua exclusão da descoberta conferida, sem mudar configuração da aplicação. Comandos de reprodução dos dois documentos anteriores atualizados.

O ensaio exige exatamente três falhas POST/corpo200 e seus eventos de console conhecidos. Não há outros erros, destinos externos ou recursos inesperados; ledger completo não-OPTIONS de cinco rotas, zero consulta clínica/IA/escrita de paciente/agenda. A regressão de leitura negada preserva somente seus seis403/console esperados.

[Resposta não confirmada em375px](delegation-retry-verified/permissions--permissoes-recepcao-retry-unconfirmed-reply-375.png) e [confirmação recuperada](delegation-retry-verified/permissions--permissoes-recepcao-retry-acknowledged-375.png) inspecionadas. [Validação consolidada](DELEGATION_RETRY_VALIDATION.json).

Recibos, escrita e perda parcial da resposta pertencem ao mock. Não provam SQL/RLS, concessão, persistência ou idempotência real do servidor. O recorte cobre retry de aprovação na mesma página antes de outra atualização; reload, reconciliação após polling e Native Auth ficam separados. T39/3b encerra somente sua matriz integrada sintética; T39/3 segue para MFA/compartilhamento. M2/corte/piloto permanecem abertos. Sem migration, carga, hosted, deploy, push ou edição Claude/SaaS/PersonalMed.

## Reexecutar

Use um nome novo:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=8522092f5bda462ffab5b3589e4cee10e38eed83 --run=retry-recheck --only=delegation-retry
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```
