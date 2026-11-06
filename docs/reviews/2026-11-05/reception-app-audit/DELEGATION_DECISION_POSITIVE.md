# T39/3b/1 — aprovação e revogação após confirmação humana

O ciclo positivo passa pela rota `/permissoes-recepcao` e pelo cliente da aplicação, congelados em `e891c678ccea88e4016e42219a3538d70313a51d`, sem overlays. AuthContext e parser são os da aplicação; autenticação e RPCs usam transporte sintético local. Nenhum arquivo da aplicação foi alterado.

## Resultado

[Doze estados aprovados](delegation-decision-verified/AUDIT.json): quatro capturas em 375/1280/1920 px, com escala de 135%:

1. Abrir Aprovar acesso e conferir conta, clínica, médico e escopo privado não registra decisão.
2. Clicar Confirmar aprovação envia o pedido exato, revisão 1 e uma operação UUID. A lista atualizada mostra Aprovado/Acesso ativo e oferece revogação.
3. Abrir Revogar acesso mantém somente a decisão anterior registrada.
4. Clicar Confirmar revogação envia o mesmo pedido, revisão 2 e outra operação UUID. A lista mostra Revogado/Sem acesso ativo e remove essa ação.

O mock registra seis mutações bem-sucedidas, duas por largura, com seis operações distintas. Identidade e metadados do pedido permanecem iguais; apenas estado, revisão e flags operacionais mudam como esperado. Os outros dois pedidos não mudam. Cada largura reinicia a fixture sintética para a mesma condição inicial; isso não representa reinicialização de dados de produção.

Vinte testes existentes da API/página aprovados. A [regressão de leitura](delegation-decision-final-read/AUDIT.json) passa nos 15 estados de T39/3a e mantém o modo de leitura sem decisões. Sintaxe/lint dos scripts, três combinações inválidas de flags, hashes, módulos servidos e limpeza aprovados. A revisão independente exigiu reprovar defeitos visuais registrados nos 12 estados; asserções foram acrescentadas e os cenários repetidos. Leitura final sem outro achado acionável; revisão externa já dispensada pelo usuário.

Capturas inspecionadas: [aprovado em 375 px](delegation-decision-verified/permissions--permissoes-recepcao-decision-approved-375.png) e [revogado em 375 px](delegation-decision-verified/permissions--permissoes-recepcao-decision-revoked-375.png). [Validação consolidada](DELEGATION_DECISION_VALIDATION.json).

## Limites do mock e dos resultados

`delegationDecisions` exige explicitamente a opção `delegationPermissions`. Só esse modo acrescenta POST de `reception_decide_delegation` e `reception_revoke_delegation` à allowlist completa de recursos. O modo T39/3a continua recusando esses endpoints. Todas as requisições não-OPTIONS ficam no ledger; nenhum outro recurso, operação de IA ou escrita de paciente/agenda é permitido.

Os inputs de decisão são estritos: UUIDs, revisão positiva, `approve` no primeiro endpoint e ausência de campos extras. O mock compara pedido/revisão/estado e retorna o snapshot esperado. [Seis probes diretos](DELEGATION_DECISION_GUARDS.json) conferem modo de leitura recusando decisão, ator extra recusado, revogação pendente recusada, aprovação na revisão 1, aprovação antiga recusada sem nova escrita e revogação na revisão 2. A combinação de opções inválida também é recusada; servidores descartáveis fechados.

Esses probes conferem o protocolo do próprio mock. Não provam autorização PostgreSQL/RLS, concessão real, idempotência do servidor, persistência real ou recuperação de conflito/resposta perdida pela interface. O mock positivo ainda não implementa replay idempotente. A apresentação Acesso ativo é derivada do DTO sintético, não de uma autorização operacional real de recepção.

Somente Edge isolado e API em loopback, fontes/classes congeladas e cache exclusivo descartado. Não houve erro de rede, HTTP, console, execução ou destino externo nos dois relatórios finais. Sem fonte da aplicação, SQL/Auth Native/API de produção, build global, carga, chamada paga, assinatura, campos legais, arquivo Claude/SaaS, hosted, deploy ou push.

T39/3b/1 fica concluído. T39/3b/2 continua com conflito, resposta perdida/retry e leitura negada na interface. T39/3, MFA/compartilhamento, M2, corte e piloto permanecem separados.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=e891c678ccea88e4016e42219a3538d70313a51d --run=decision-recheck --only=delegation-decision
node scripts/reception-app-audit-browser.mjs --baseline=e891c678ccea88e4016e42219a3538d70313a51d --run=decision-read-recheck --only=delegation-read
```
