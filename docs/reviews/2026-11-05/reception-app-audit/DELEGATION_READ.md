# T39/3a — leitura integrada das permissões da recepção

A passagem inicial da auditoria encontrava apenas o erro de DTO: o mock retornava `[]`, enquanto `delegationApi` exige uma página estrita com `canManage`, `items` e `nextCursor`. A opção nova da fixture oferece três pedidos sintéticos: pendente, aprovado com acesso ativo e aprovado sem acesso ativo.

O ensaio usa a rota `/permissoes-recepcao` e os componentes App/AuthContext e parser Zod da aplicação, congelados no snapshot `d6ff63ed537db8bde71557d1d2ea73cfd29a9fcf`, sem overlays. Os endpoints de autenticação são simulados; não se executa o servidor Native Auth. Nenhum arquivo da aplicação foi alterado.

## Cobertura e resultado

[Quinze estados aprovados](delegation-read-verified/AUDIT.json), cinco cenários em 375/1280/1920 px, com escala de 135%:

1. Página positiva: três pedidos; aprovação e acesso efetivo apresentados separadamente. O formulário administrativo não aparece na visão do médico.
2. Confirmação de aprovação: conta, clínica, médico e aviso sobre prontuários privados; botão explícito de confirmação disponível.
3. Confirmação de revogação: conta correta, perda do acesso delegado e preservação do histórico.
4. Refetch com DTO inválido: erro de validação, pedidos e ações removidos do DOM, sem nomes das linhas em cache.
5. Recuperação pelo botão Tentar novamente: lista fresca restaurada, ações disponíveis e erro removido.

As confirmações são abertas para revisão; nenhuma decisão é enviada. Os dados da fixture permanecem iguais. Os argumentos de todas as leituras são exatamente `p_clinic:null`, `p_after:null`, `p_after_id:null`, `p_limit:50`, sem ator ou papel no payload.

Vinte testes existentes da API/página aprovados, sintaxe/lint dos dois scripts e três combinações inválidas de flags conferidos. O [modo padrão do Início](delegation-read-final-default/AUDIT.json) passou em nove estados e manteve seus seis contadores originais. Não houve mudança de TypeScript da aplicação ou novo build global.

## Registro completo dos recursos acessados

A revisão independente encontrou uma lacuna no primeiro contador parcial: ele não cobria todos os endpoints. O modo opt-in agora registra método/caminho de cada requisição de aplicação, excluindo apenas preflight OPTIONS, e recusa qualquer acesso fora desta lista:

| Método | Caminho |
| --- | --- |
| POST | `/auth/v1/token` |
| GET | `/auth/v1/user` |
| POST | `/rest/v1/rpc/clinic_access` |
| POST | `/rest/v1/rpc/reception_delegation_requests` |

O runner exige o registro completo dentro dessa lista, nenhuma chamada inesperada, zero contadores de IA/escrita e nenhum erro de execução, console, HTTP, requisição ou destino externo. As opções antigas da fixture mantêm o comportamento anterior. A leitura final da revisão não encontrou outro defeito nesse contrato; revisão externa já dispensada pelo usuário.

[Cinco probes independentes](DELEGATION_FIXTURE_GUARDS.json) retornaram 403/`TEST_UNEXPECTED_RESOURCE` e ficaram no registro de recusas: GET consultation_drafts, POST update_user_settings, POST outra função sintética, POST reception_decide_delegation e GET patients. Os dados não mudaram e o servidor descartável foi fechado.

[Validação consolidada](DELEGATION_READ_VALIDATION.json), com hashes, fontes efetivamente servidas e limpeza. Capturas inspecionadas: [confirmação em 375 px](delegation-read-verified/permissions--permissoes-recepcao-approval-confirmation-375.png) e [erro com linhas ocultas](delegation-read-verified/permissions--permissoes-recepcao-invalid-response-375.png). A lista completa usa rolagem vertical; as asserções verificam os três registros no DOM e as ações alcançáveis.

## Limites e continuação

API em loopback com dados sintéticos, Edge isolado, fontes/classes congeladas e cache exclusivo descartado. Os contadores e o registro conferem apenas esse transporte de teste; não provam autorização PostgreSQL/RLS, concessão real, persistência de decisão, CAS ou idempotência no servidor. A distinção entre aprovado e efetivo vem dos DTOs simulados.

T39/3a conclui leitura positiva, revisão do escopo e recuperação de DTO inválido. T39/3b deve integrar envio/decisão humana, CAS, resposta perdida e retry no ambiente sintético; erro de permissão no transporte, MFA e compartilhamento continuam pendentes. T39 inteira, decisão de navegação, M2, corte e piloto permanecem separados. Sem SQL/Auth/API de produção, carga, assinatura, campos legais, Claude/SaaS, banco hospedado, chamada paga, deploy ou push.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=d6ff63ed537db8bde71557d1d2ea73cfd29a9fcf --run=delegation-read-recheck --only=delegation-read
```
